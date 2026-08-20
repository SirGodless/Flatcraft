/**
 * Message shapes crossing the main app <-> sandbox iframe (host.ts) <->
 * sandbox worker (worker.ts) boundary - see main.ts's createScriptSandbox
 * for the full picture. Kept in one file so a change to the wire format
 * updates all three call sites' types together; the values themselves
 * cross via postMessage (structured clone), never shared references.
 */

/** Main app -> host -> worker. "init" is host-only (never forwarded to
 * the worker - it's what *creates* the worker in the first place, see
 * host.ts) - everything else is a pure relay down to the worker.
 * "init" carries the worker's compiled JS as a source *string*, not a
 * URL: host.ts's document has an opaque origin (sandbox="allow-scripts",
 * no allow-same-origin), and browsers refuse `new Worker(url)` for any
 * real http(s) URL from an opaque-origin context regardless of CORS
 * headers - only a blob: URL (which inherits the creating document's
 * own, already-opaque origin) is allowed. The main app fetches the
 * compiled worker script itself (an unrestricted, ordinary top-level
 * page fetch - see index.ts's createScriptSandbox) and hands the text
 * over; host.ts turns it into a Blob + Worker(URL.createObjectURL(...))
 * locally. */
export type SandboxInbound =
  | { type: "init"; workerSource: string }
  | { type: "load"; packageId: string; scripts: string[] }
  | { type: "tick" };

/** Worker -> host -> main app; host.ts is a pure relay in this direction
 * (no message here is synthesized by host.ts itself). "ready" is the
 * worker's own first message, sent right after it installs its message
 * listener - the main app waits for it before posting any "load". */
export type SandboxOutbound =
  | { type: "ready" }
  | { type: "register"; typeId: string; instance: Record<string, unknown> }
  | { type: "loadError"; packageId: string; message: string }
  | { type: "hookError"; hookId: string; message: string };
