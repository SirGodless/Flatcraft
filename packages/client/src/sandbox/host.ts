import type { SandboxInbound, SandboxOutbound } from "./protocol.js";

/**
 * Runs as sandbox.html's own top-level script, inside a
 * `sandbox="allow-scripts"` (no allow-same-origin) iframe embedded by
 * the main app (see main.ts's createScriptSandbox) - this document's
 * origin is opaque, and sandbox.html's CSP cuts network access outright.
 * Its only job is to build the real worker.ts sandbox from the source
 * text the main app hands it (see protocol.ts's "init" for why it's
 * text, not a URL) and relay messages between it and the main app 1:1;
 * it never interprets a message's contents itself, so a change to the
 * wire protocol never needs a change here.
 */

let worker: Worker | undefined;

window.addEventListener("message", (event: MessageEvent<SandboxInbound>) => {
  // Only ever trust messages from the frame that embedded this page -
  // this iframe has no other legitimate message source.
  if (event.source !== window.parent) return;
  const message = event.data;
  if (message.type === "init") {
    if (worker) return; // already initialized - ignore a stray repeat.
    const blob = new Blob([message.workerSource], { type: "text/javascript" });
    worker = new Worker(URL.createObjectURL(blob));
    worker.addEventListener("message", (workerEvent: MessageEvent<SandboxOutbound>) => {
      // Opaque origin, so this document has no meaningful origin string
      // of its own to assert as the target - "*" is safe here because
      // every message the worker can ever send is already meant to
      // leave the sandbox (see protocol.ts's SandboxOutbound), never a
      // secret.
      window.parent.postMessage(workerEvent.data, "*");
    });
    return;
  }
  worker?.postMessage(message);
});
