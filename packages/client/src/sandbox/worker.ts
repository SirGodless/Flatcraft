import type { SandboxInbound, SandboxOutbound } from "./protocol.js";

/**
 * Runs inside a Worker spawned by host.ts, which itself only ever runs
 * inside sandbox.html's `sandbox="allow-scripts"` (no allow-same-origin)
 * iframe - so this realm has an opaque origin (no parent cookies/
 * storage reachable even if it tried) and no network (connect-src
 * 'none' in sandbox.html's CSP, inherited by this worker). No DOM ever
 * existed here in the first place - Workers never get `document`.
 *
 * Scope (Stage 9 v1, deliberately narrower than the server-side Stage 8
 * bridge): a content-package script running here may register content
 * instances and a tick hook that can call bridge.rng() - nothing that
 * touches the live world. The server's Simulation is the only
 * authoritative sim state in multiplayer; a client-side script trying to
 * mutate it wouldn't mean anything real anyway, so there's no
 * world()/spawnItem()/multiblock-handler surface here at all, unlike the
 * server-side bridge. bridge.rng() uses real Math.random(), not the
 * engine's deterministic rng - intentional, matching the plan's own
 * split between sim-changing hooks (deterministic rng only) and
 * cosmetic/client-only hooks (real randomness allowed); this worker only
 * ever runs the latter kind.
 */

const tickHooks = new Map<string, () => void>();

function post(message: SandboxOutbound): void {
  self.postMessage(message);
}

(globalThis as { bridge?: unknown }).bridge = {
  rng: (): number => Math.random(),
  registerContentInstance: (typeId: string, instance: Record<string, unknown>): void => {
    post({ type: "register", typeId, instance });
  },
  registerTickHook: (id: string, fn: () => void): void => {
    if (tickHooks.has(id)) throw new Error(`tick hook "${id}" is already registered`);
    tickHooks.set(id, fn);
  },
};

function runTick(): void {
  for (const [id, fn] of tickHooks) {
    try {
      fn();
    } catch (err) {
      post({ type: "hookError", hookId: id, message: (err as Error).message });
    }
  }
}

function loadPackage(packageId: string, scripts: string[]): void {
  try {
    for (const code of scripts) {
      // Same execution mechanism as the server's isolated-vm sandbox
      // running a compiled ("iife" format) script - just Function()
      // instead of a V8 isolate, since this worker's own thread/opaque-
      // origin/no-network sandboxing already provides the isolation an
      // isolate gives Node. A throw here is reported, not fatal to the
      // whole worker - other packages' scripts still get a chance to
      // load (unlike the server, which hard-stops boot entirely; a
      // client that already joined a game shouldn't lose the whole
      // session over one mod's client-side script failing after the
      // server already validated and ran it successfully itself).
      new Function(code)();
    }
  } catch (err) {
    post({ type: "loadError", packageId, message: (err as Error).message });
  }
}

self.addEventListener("message", (event: MessageEvent<SandboxInbound>) => {
  const message = event.data;
  if (message.type === "load") {
    loadPackage(message.packageId, message.scripts);
  } else if (message.type === "tick") {
    runTick();
  }
});

// The main app waits for this before posting anything - see main.ts's
// createScriptSandbox.
post({ type: "ready" });
