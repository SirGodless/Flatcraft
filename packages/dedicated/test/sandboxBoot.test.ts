import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { itemDef } from "@flatcraft/sim";
import { startDedicatedServer, type DedicatedServer } from "../src/server.js";

/**
 * End-to-end check that a real, on-disk content package with a scripts/
 * directory is discovered (discoverContentDir), loaded, and its scripts
 * actually run as part of startDedicatedServer's own boot sequence - not
 * just via a direct runContentScripts() call with hand-built in-memory
 * ContentPackages (see sandbox.test.ts for that finer-grained coverage).
 * Own file, not part of sandbox.test.ts: server.ts caches its discovered
 * base content package list per process (module-level, see
 * ensureBaseContentLoaded) - a second startDedicatedServer() call in the
 * same test file with a *different* custom contentDir would silently
 * reuse the first call's cached package list instead of actually
 * re-discovering anything, which is exactly wrong for two tests that
 * each want their own on-disk content layout. Vitest's default
 * `isolate: true` gives every test *file* a fresh module registry, so a
 * single test per file sidesteps that entirely.
 */

let server: DedicatedServer | null = null;
let dataDir: string | null = null;
let contentDir: string | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  if (contentDir) rmSync(contentDir, { recursive: true, force: true });
  dataDir = null;
  contentDir = null;
});

describe("startDedicatedServer + content-package scripts", () => {
  it("discovers a content package's scripts/ directory on disk and runs it during boot", async () => {
    contentDir = mkdtempSync(join(tmpdir(), "flatcraft-content-"));
    mkdirSync(join(contentDir, "flatcraft"), { recursive: true });
    writeFileSync(join(contentDir, "flatcraft/content.json"), JSON.stringify({ id: "flatcraft", version: "0.1.0" }));
    mkdirSync(join(contentDir, "e2e_testmod/scripts"), { recursive: true });
    writeFileSync(
      join(contentDir, "e2e_testmod/content.json"),
      JSON.stringify({ id: "e2e_testmod", version: "0.1.0" }),
    );
    writeFileSync(
      join(contentDir, "e2e_testmod/scripts/main.ts"),
      `bridge.registerContentInstance("item", { id: "e2e_testmod:item:widget", name: "E2E Widget" });\n`,
    );
    dataDir = mkdtempSync(join(tmpdir(), "flatcraft-data-"));

    server = await startDedicatedServer({ port: 0, dataDir, contentDir, seed: 1, log: () => {} });

    expect(itemDef("e2e_testmod:item:widget")?.name).toBe("E2E Widget");
  });
});
