import { describe, expect, it } from "vitest";
import type { ContentPackage } from "@flatcraft/content";
import {
  getHandler,
  itemDef,
  registeredTickSystemIds,
  runTickSystems,
  Simulation,
  type MultiblockActivateContext,
  type MultiblockHandler,
} from "@flatcraft/sim";
import { runContentScripts } from "../src/sandbox.js";

/**
 * Stage 8's own verification checklist (content-architecture plan):
 * content-instance registration, tick hooks and multiblock handlers all
 * land in the real engine registries via a script running inside a real
 * isolated-vm isolate; a determinism regression check (two independent
 * runs of the same hook must produce identical results); and a
 * deliberately-broken script must hard-stop rather than boot half-loaded.
 *
 * Exercises runContentScripts() directly rather than going through a full
 * startDedicatedServer() boot - server.ts's own wiring (content
 * discovery -> loadContentPackage -> runContentScripts -> validateAllContent)
 * is a separate, thinner concern already covered by every other
 * server.ts test booting successfully with flatcraft's own (script-free)
 * content package.
 */

const encoder = new TextEncoder();

function pkg(id: string, scripts: Record<string, string>): ContentPackage {
  const files = new Map<string, Uint8Array>();
  files.set("content.json", encoder.encode(JSON.stringify({ id, version: "0.0.1" })));
  for (const [path, source] of Object.entries(scripts)) {
    files.set(`scripts/${path}`, encoder.encode(source));
  }
  return { id, version: "0.0.1", source: `test:${id}`, files };
}

let sim: Simulation;
const getSim = (): Simulation => sim;

// registeredTickSystemIds()/getHandler() are process-global registries
// (not per-Simulation) - nothing resets them between tests, same as every
// other test file in this suite that registers content (e.g.
// contentValidation.test.ts). Each test below uses a unique package id
// per hook/handler it registers to avoid collisions.
describe("runContentScripts", () => {
  it("registers a content instance through the real item registry", () => {
    sim = new Simulation(1);
    runContentScripts(
      [pkg("sandboxtest_items", { "main.ts": `bridge.registerContentInstance("item", { id: "sandboxtest_items:item:widget", name: "Widget" });` })],
      getSim,
      () => {},
    );
    expect(itemDef("sandboxtest_items:item:widget")?.name).toBe("Widget");
  });

  it("registers a tick hook that runs through the real tick-system dispatch", () => {
    sim = new Simulation(2);
    runContentScripts(
      [
        pkg("sandboxtest_tick", {
          "main.ts": `
            globalThis.__ticks = 0;
            bridge.registerTickHook("sandboxtest_tick:tick:counter", () => {
              globalThis.__ticks++;
            });
          `,
        }),
      ],
      getSim,
      () => {},
    );
    expect(registeredTickSystemIds()).toContain("sandboxtest_tick:tick:counter");
    // The hook itself runs inside its own isolate and can't leak a
    // JS-visible counter back out - what's observable from here is that
    // dispatching a tick doesn't throw and the hook is wired into the
    // real dispatch list, not a private one.
    expect(() => runTickSystems(sim, [])).not.toThrow();
  });

  it("registers a tick hook that spawns an item visible to the real simulation", () => {
    sim = new Simulation(3);
    runContentScripts(
      [
        pkg("sandboxtest_spawn", {
          "main.ts": `
            bridge.registerTickHook("sandboxtest_spawn:tick:spawner", () => {
              bridge.spawnItem("flatcraft:dimension:overworld", 5, 5, "flatcraft:item:stick", 1);
            });
          `,
        }),
      ],
      getSim,
      () => {},
    );
    const before = sim.entities.size;
    runTickSystems(sim, []);
    const after = sim.entities.size;
    expect(after).toBe(before + 1);
  });

  it("registers a multiblock handler through the real handler registry", () => {
    sim = new Simulation(4);
    runContentScripts(
      [
        pkg("sandboxtest_mb", {
          "main.ts": `
            bridge.registerMultiblockHandler("sandboxtest_mb:multiblock_handler:always_true", (dimension, x, y) => {
              bridge.spawnItem(dimension, x, y, "flatcraft:item:stick", 1);
              return true;
            });
          `,
        }),
      ],
      getSim,
      () => {},
    );
    const handler = getHandler<MultiblockHandler>("multiblock_handler", "sandboxtest_mb:multiblock_handler:always_true");
    expect(handler).toBeDefined();
    const broadcast: unknown[] = [];
    const world = sim.worldOf("flatcraft:dimension:overworld");
    const before = sim.entities.size;
    const activated = handler!.activate({
      world,
      def: undefined as never,
      match: undefined,
      x: 1,
      y: 1,
      dimension: "flatcraft:dimension:overworld",
      sim,
      broadcast: (event) => broadcast.push(event),
    } satisfies MultiblockActivateContext);
    expect(activated).toBe(true);
    expect(sim.entities.size).toBe(before + 1);
    expect(broadcast.length).toBeGreaterThan(0);
  });

  it("hard-stops when a script throws at top-level load", () => {
    sim = new Simulation(5);
    expect(() =>
      runContentScripts(
        [pkg("sandboxtest_broken", { "main.ts": `throw new Error("deliberately broken mod script");` })],
        getSim,
        () => {},
      ),
    ).toThrow(/deliberately broken mod script/);
  });

  it("hard-stops when a script fails to compile", () => {
    sim = new Simulation(6);
    expect(() =>
      runContentScripts(
        [pkg("sandboxtest_syntax", { "main.ts": `this is not valid typescript at all (((` })],
        getSim,
        () => {},
      ),
    ).toThrow(/failed to compile/);
  });

  it("is deterministic: two independent runs of the same rng-driven hook produce identical results", () => {
    // registerTickSystem() is a process-global registry that rejects a
    // duplicate id - two calls in the same test process need distinct
    // package/hook ids even though they're meant to model two fully
    // independent runs (e.g. two players' clients replaying the same
    // mod), so the id itself is parameterized per call.
    const runOnce = (runId: number): number[] => {
      const localSim = new Simulation(42);
      const rolls: number[] = [];
      const localGetSim = (): Simulation => localSim;
      runContentScripts(
        [
          pkg(`sandboxtest_determinism_${runId}`, {
            "main.ts": `
              bridge.registerTickHook("sandboxtest_determinism_${runId}:tick:roll", () => {
                for (let i = 0; i < 5; i++) bridge.rng();
              });
            `,
          }),
        ],
        localGetSim,
        () => {},
      );
      for (let t = 0; t < 3; t++) {
        rolls.push(localSim.rng());
        runTickSystems(localSim, []);
      }
      return rolls;
    };
    // Same seed, two fully independent Simulation + isolate pairs - a
    // script hook driving the engine's own deterministic rng (never
    // Math.random/Date.now) must not introduce any drift between them.
    const first = runOnce(1);
    const second = runOnce(2);
    expect(second).toEqual(first);
  });
});
