import { transformSync } from "esbuild";

/**
 * TS -> JS for one content-package script file, ahead of ever handing it
 * to a sandbox (Stage 8: isolated-vm on the dedicated server; Stage 9:
 * a Worker/iframe in the browser). Deliberately transpile-only, never
 * bundle: a script's imports (if any) are a sandbox-time concern - what
 * "import" even resolves to depends on the bridge API surface the
 * sandbox host provides, which doesn't exist yet at this stage. This
 * function only strips TypeScript syntax down to plain JS; it doesn't
 * know or care what the code actually does.
 *
 * Runs server-side only (Node's real esbuild, not esbuild-wasm) - the
 * browser client never transpiles a mod's script itself, it receives
 * already-transpiled JS the same way it already receives blocks/items/
 * mobs from a server's datapack (see @flatcraft/dedicated's server.ts).
 * A future singleplayer flow transpiles at content-package-install time
 * for the same reason: whichever host reads the package's raw scripts/
 * off a filesystem is where this runs, never a sandbox itself.
 */
export interface TranspileError {
  message: string;
  /** 1-based line/column, when esbuild could pinpoint one. */
  line?: number;
  column?: number;
}

export type TranspileResult = { ok: true; code: string } | { ok: false; errors: TranspileError[] };

export interface TranspileOptions {
  /** "esm" (default) keeps import/export syntax, for a future real module
   * loader. "iife" wraps the output in a self-invoking function instead -
   * Stage 8's sandbox runs a script as a classic (non-module) script via
   * isolated-vm's Context.eval, which can't parse a top-level `export`;
   * a side-effecting registration script (calls bridge.registerX(...),
   * exports nothing a host needs to read back) wants "iife" so esbuild
   * never emits that keyword in the first place. */
  format?: "esm" | "iife";
}

export function transpileScript(source: string, filename: string, options: TranspileOptions = {}): TranspileResult {
  try {
    const result = transformSync(source, {
      loader: "ts",
      format: options.format ?? "esm",
      target: "es2022",
      sourcefile: filename,
    });
    return { ok: true, code: result.code };
  } catch (err) {
    const errors = (err as { errors?: Array<{ text: string; location?: { line: number; column: number } }> }).errors;
    if (!errors) throw err;
    return {
      ok: false,
      errors: errors.map((e) => ({
        message: e.text,
        ...(e.location ? { line: e.location.line, column: e.location.column } : {}),
      })),
    };
  }
}
