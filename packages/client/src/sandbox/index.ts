import type { SandboxInbound, SandboxOutbound } from "./protocol.js";
// The compiled worker script's public URL (Vite's special `?worker&url`
// import - see https://vite.dev/guide/features.html#web-workers).
// Fetched here, on the ordinary top-level page (an unrestricted fetch -
// nothing sandboxed about this module), then handed to host.ts as text
// via the "init" message - see protocol.ts for why a URL alone can't
// cross into the sandboxed iframe.
import workerUrl from "./worker.ts?worker&url";

/**
 * Main-thread side of the Stage 9 script sandbox: embeds sandbox.html
 * (see that file's own doc comment, and worker.ts/host.ts) in a hidden,
 * `sandbox="allow-scripts"` iframe with no `allow-same-origin` - the
 * whole point of createScriptSandbox is that a server-provided script
 * runs somewhere that can't reach this page's DOM, cookies, storage, or
 * network, while still executing at real JIT speed (a Worker inside a
 * sandboxed iframe, not an interpreter). See main.ts's loadServerScripts
 * for the only caller.
 */

export interface ScriptSandbox {
  /** Runs one content package's already-compiled ("iife" format, from
   * the server's /api/scripts) scripts in filename order, same as the
   * server's own isolated-vm execution. */
  loadPackage(packageId: string, scripts: string[]): void;
  /** Runs every registered tick hook, across every loaded package. */
  tick(): void;
}

export interface ScriptSandboxCallbacks {
  onRegister(typeId: string, instance: Record<string, unknown>): void;
  onLoadError(packageId: string, message: string): void;
  onHookError(hookId: string, message: string): void;
}

export async function createScriptSandbox(callbacks: ScriptSandboxCallbacks): Promise<ScriptSandbox> {
  const workerSource = await fetch(workerUrl).then((r) => r.text());

  return new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.style.display = "none";
    iframe.src = "/sandbox.html";

    const send = (message: SandboxInbound): void => {
      iframe.contentWindow?.postMessage(message, "*");
    };

    window.addEventListener("message", (event: MessageEvent<SandboxOutbound>) => {
      // Only ever trust messages from our own sandbox iframe - this page
      // embeds exactly one, so identity, not origin (which is opaque
      // anyway), is the right check.
      if (event.source !== iframe.contentWindow) return;
      const message = event.data;
      if (message.type === "ready") {
        resolve({
          loadPackage: (packageId, scripts) => send({ type: "load", packageId, scripts }),
          tick: () => send({ type: "tick" }),
        });
      } else if (message.type === "register") {
        callbacks.onRegister(message.typeId, message.instance);
      } else if (message.type === "loadError") {
        callbacks.onLoadError(message.packageId, message.message);
      } else if (message.type === "hookError") {
        callbacks.onHookError(message.hookId, message.message);
      }
    });

    // The iframe's own "load" DOM event fires once host.ts's top-level
    // code (which installs the message listener that "init" needs to
    // land on) has run - posting "init" any earlier would be a message
    // with nobody listening yet, silently dropped.
    iframe.addEventListener("load", () => send({ type: "init", workerSource }), { once: true });
    document.body.appendChild(iframe);
  });
}
