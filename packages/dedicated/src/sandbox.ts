import ivm from "isolated-vm";
import { transpileScript, type ContentPackage } from "@flatcraft/content";
import {
  blockByName,
  blockDef,
  registerContentInstanceByType,
  registerHandler,
  registerTickSystem,
  Simulation,
  type OutboundEvent,
} from "@flatcraft/sim";

/**
 * Stage 8: real script execution for a content package's scripts/*.ts,
 * inside a real V8 isolate (isolated-vm) - the server-side half of the
 * Stage 7 bridge contract (packages/sim/src/scripting/bridge.ts). Every
 * registration call a script makes (registerContentInstance,
 * registerTickHook, registerMultiblockHandler) lands in the exact same
 * registries a compiled-in TS handler or a JSON content file uses (see
 * registry/load.ts, registry/handlers.ts, systems/registry.ts) - a
 * sandboxed script is not a second, parallel content system.
 *
 * Scope of this delivery (see the module's own doc comments below for
 * why): content-instance registration, tick hooks, multiblock handlers,
 * deterministic RNG, curated block/wall read-write, spawnItem. Dimension/
 * arrival/spawn-point generators and command-handler-body overrides are
 * declared on the bridge *type* (Stage 7) but not wired to a real
 * implementation here - a real dimension generator returns a whole
 * populated Chunk (typed tile/wall arrays), which needs its own
 * marshaling design this stage doesn't attempt, and a command-handler
 * override needs a replace/wrap/chain decision Stage 7 explicitly left
 * open. Both are real follow-up work, not silently abandoned.
 *
 * One Isolate (memory-limited) and one Context per content package, not
 * per script file - every script in a package's scripts/ directory
 * shares that isolate's global scope (registration order = filename
 * sort order, same deterministic-ordering rule the JSON loader already
 * follows), so a package can split code across files the way a
 * non-module script bundle would expect. A script that throws at
 * top-level load time is a hard boot failure (see runContentScripts),
 * matching validateAllContent's existing "broken content stops the
 * server, never runs half-loaded" rule; a hook that throws *after* boot
 * (a later tick, a later multiblock trigger) is caught and logged
 * instead, so one broken mod hook doesn't take the whole server down on
 * every subsequent tick.
 */

const ISOLATE_MEMORY_LIMIT_MB = 128;
const SCRIPT_LOAD_TIMEOUT_MS = 5000;
const HOOK_CALL_TIMEOUT_MS = 500;

function blockNameToId(name: string): number {
  const id = blockByName(name);
  if (id === undefined) throw new Error(`unknown block "${name}"`);
  return id;
}

function blockIdToName(id: number): string {
  return blockDef(id as never).name;
}

/** Bridge functions that don't need to see "the current tick's event
 * sink" - built once per sandboxed package, closing over a `getSim`
 * thunk rather than a live Simulation directly. Scripts must load (and
 * register their content/handlers) before validateAllContent runs, so a
 * multiblock JSON referencing a script-provided handler id validates
 * correctly - but the actual Simulation instance isn't constructed until
 * later in boot (it depends on world-load/reset options resolved after
 * content validation). Deferring the sim lookup to call time - which
 * only ever happens once a hook actually fires, well after boot
 * completes - avoids requiring a chicken-and-egg "construct Simulation
 * before its own content package finishes loading". */
function stableBridgeFns(getSim: () => Simulation, log: (message: string) => void) {
  const worldOrThrow = (dimension: string) => {
    try {
      return getSim().worldOf(dimension);
    } catch {
      return undefined;
    }
  };
  return {
    __getBlock: (dimension: string, x: number, y: number): string | undefined => {
      const world = worldOrThrow(dimension);
      return world ? blockIdToName(world.getBlock(x, y)) : undefined;
    },
    __setBlock: (dimension: string, x: number, y: number, block: string): boolean => {
      const world = worldOrThrow(dimension);
      return world ? world.setBlock(x, y, blockNameToId(block) as never) : false;
    },
    __getWall: (dimension: string, x: number, y: number): string | undefined => {
      const world = worldOrThrow(dimension);
      return world ? blockIdToName(world.getWall(x, y)) : undefined;
    },
    __setWall: (dimension: string, x: number, y: number, block: string): boolean => {
      const world = worldOrThrow(dimension);
      return world ? world.setWall(x, y, blockNameToId(block) as never) : false;
    },
    __rng: (): number => getSim().rng(),
    __spawnItem: (dimension: string, x: number, y: number, item: string, count: number): void => {
      const world = worldOrThrow(dimension);
      if (!world) throw new Error(`unknown dimension "${dimension}"`);
      // spawnItem needs somewhere to put its entity_spawned event; a
      // boot-time or hook-invocation call with nowhere live to route it
      // still has to happen (a script may legitimately spawn an item as
      // a side effect), so a throwaway sink is fine when there's no
      // real per-tick `out` array to append to (see HookInvocation below
      // for the case where one does exist).
      getSim().spawnItem(dimension, x, y, { item, count }, currentOut ?? []);
    },
    __registerContentInstance: (typeId: string, instance: Record<string, unknown>, source: string): void => {
      registerContentInstanceByType(typeId, instance, source);
    },
  };
}

/** The `out` array for whichever hook invocation is currently in
 * progress, so a script's bridge.spawnItem() call during a tick hook
 * actually reaches that tick's real event batch instead of a private
 * sink nobody broadcasts. Module-level rather than threaded through
 * every bridge function because the bridge object itself is built once
 * per isolate and captured by every script's closures - there is no
 * per-call argument path back into it without re-marshaling the whole
 * bridge on every single call, which defeats the point of building it
 * once. Single-threaded (Node has no real concurrency here), so this is
 * safe: every hook invocation fully completes, exception or not, before
 * the next one starts. */
let currentOut: OutboundEvent[] | undefined;

function withCurrentOut<T>(out: OutboundEvent[], fn: () => T): T {
  const previous = currentOut;
  currentOut = out;
  try {
    return fn();
  } finally {
    currentOut = previous;
  }
}

/** Bootstrap JS, run once per isolate before any of the package's own
 * scripts - assembles the ergonomic `bridge.*` global mod authors call
 * from the low-level host callbacks installed by installBridge(). Not a
 * mod's own code: this is engine-authored glue, trusted by construction. */
const BOOTSTRAP_SOURCE = `
  globalThis.bridge = {
    world(dimension) {
      return {
        getBlock: (x, y) => __getBlock(dimension, x, y),
        setBlock: (x, y, block) => __setBlock(dimension, x, y, block),
        getWall: (x, y) => __getWall(dimension, x, y),
        setWall: (x, y, block) => __setWall(dimension, x, y, block),
      };
    },
    rng: () => __rng(),
    spawnItem: (dimension, x, y, item, count) => __spawnItem(dimension, x, y, item, count),
    registerContentInstance: (typeId, instance) =>
      __registerContentInstance(typeId, instance, "script"),
    registerTickHook: (id, fn) =>
      __registerTickHook.applySync(undefined, [id, fn], { arguments: { reference: true } }),
    registerMultiblockHandler: (id, fn) =>
      __registerMultiblockHandler.applySync(undefined, [id, fn], { arguments: { reference: true } }),
  };
`;

function installBridge(
  context: ivm.Context,
  getSim: () => Simulation,
  packageId: string,
  log: (message: string) => void,
): void {
  const jail = context.global;
  jail.setSync("global", jail.derefInto());
  for (const [name, fn] of Object.entries(stableBridgeFns(getSim, log))) {
    jail.setSync(name, fn);
  }

  jail.setSync(
    "__registerTickHook",
    new ivm.Reference((idRef: ivm.Reference<string>, fnRef: ivm.Reference<() => void>) => {
      const id = idRef.copySync();
      registerTickSystem({
        id,
        step(_sim, out) {
          withCurrentOut(out, () => {
            try {
              fnRef.applySync(undefined, [], { timeout: HOOK_CALL_TIMEOUT_MS });
            } catch (err) {
              log(`content package "${packageId}": tick hook "${id}" failed: ${(err as Error).message}`);
            }
          });
        },
      });
    }),
  );

  jail.setSync(
    "__registerMultiblockHandler",
    new ivm.Reference((idRef: ivm.Reference<string>, fnRef: ivm.Reference<(dim: string, x: number, y: number) => boolean>) => {
      const id = idRef.copySync();
      registerHandler("multiblock_handler", id, {
        activate(ctx: { dimension: string; x: number; y: number; broadcast: (event: unknown) => void }) {
          const out: OutboundEvent[] = [];
          const activated = withCurrentOut(out, () => {
            try {
              return Boolean(fnRef.applySync(undefined, [ctx.dimension, ctx.x, ctx.y], { timeout: HOOK_CALL_TIMEOUT_MS }));
            } catch (err) {
              log(`content package "${packageId}": multiblock handler "${id}" failed: ${(err as Error).message}`);
              return false;
            }
          });
          for (const entry of out) ctx.broadcast(entry.event);
          return activated;
        },
      });
    }),
  );
}

/** Runs every scripts/*.ts file in every discovered content package that
 * has one, in filename-sorted (deterministic) order, sharing one isolate
 * per package. A script throwing at top-level load is a hard boot
 * failure (thrown onward, same "refuse to start rather than run with
 * broken content" rule validateAllContent already enforces for JSON) -
 * never a swallowed warning, so a broken mod script is caught at boot,
 * not discovered later by a player watching something silently not
 * work. */
export function runContentScripts(
  packages: readonly ContentPackage[],
  getSim: () => Simulation,
  log: (message: string) => void,
): void {
  for (const pkg of packages) {
    const scriptFiles = [...pkg.files.entries()]
      .filter(([path]) => path.startsWith("scripts/") && path.endsWith(".ts"))
      .sort(([a], [b]) => a.localeCompare(b));
    if (scriptFiles.length === 0) continue;

    const isolate = new ivm.Isolate({ memoryLimit: ISOLATE_MEMORY_LIMIT_MB });
    const context = isolate.createContextSync();
    installBridge(context, getSim, pkg.id, log);
    context.evalSync(BOOTSTRAP_SOURCE);

    const decoder = new TextDecoder();
    for (const [path, bytes] of scriptFiles) {
      const source = decoder.decode(bytes);
      const transpiled = transpileScript(source, `${pkg.id}/${path}`, { format: "iife" });
      if (!transpiled.ok) {
        const detail = transpiled.errors.map((e) => e.message).join("; ");
        throw new Error(`content package "${pkg.id}": ${path} failed to compile: ${detail}`);
      }
      isolate.compileScriptSync(transpiled.code, { filename: `${pkg.id}/${path}` }).runSync(context, { timeout: SCRIPT_LOAD_TIMEOUT_MS });
    }
    log(`content package "${pkg.id}": loaded ${scriptFiles.length} script${scriptFiles.length === 1 ? "" : "s"}`);
  }
}
