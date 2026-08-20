import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseMultiblock, registerMultiblock } from "@flatcraft/sim";
import { startDedicatedServer, type DedicatedServer } from "../src/server.js";

/**
 * Boot-time content validation (see @flatcraft/sim's validateAllContent):
 * a server must refuse to start rather than silently run with broken
 * content. Own file because registerMultiblock is a process-global
 * registry - registering a deliberately-broken def here must not leak
 * into other test files' assertions.
 */

let server: DedicatedServer | null = null;
let dataDir: string | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  dataDir = null;
});

describe("boot-time content validation", () => {
  it("refuses to start when a multiblock references an unregistered handler", async () => {
    registerMultiblock(
      parseMultiblock("flatcraft:multiblock:test_boot_missing_handler", {
        id: "flatcraft:multiblock:test_boot_missing_handler",
        handler: "flatcraft:multiblock_handler:nobody_registered_this_handler",
        trigger_on: { type: "place_block", item: "flatcraft:item:coal" },
      }),
    );
    dataDir = mkdtempSync(join(tmpdir(), "flatcraft-contentvalidation-"));

    await expect(
      startDedicatedServer({ port: 0, dataDir, seed: 1337, log: () => {} }),
    ).rejects.toThrow(/nobody_registered_this_handler/);
  });
});
