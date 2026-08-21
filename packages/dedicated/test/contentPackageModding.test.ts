import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { blockByName, blockDef, itemDef, mobDef, RECIPES } from "@flatcraft/sim";
import { startDedicatedServer, type DedicatedServer } from "../src/server.js";

/**
 * Content-package modding end to end: a real content package placed
 * under a custom contentDir gets discovered (discoverContentDir), loaded
 * through the exact same loadContentPackage() flatcraft's own content
 * uses, gets dynamic block ids, and is served to connecting clients via
 * /api/content (JSON) and /sprites/ (its own sprites/ directory, in
 * memory - see server.ts's contentSprites) - the content-package
 * replacement for the old server-datapack mechanism (DATA_DIR/datapack/
 * {blocks,items,mobs,sprites} + /api/datapack), which only ever covered
 * three content types and bypassed loadContentPackage entirely. Runs in
 * its own test file because registries are process-global.
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

describe("content-package modding", () => {
  it("loads mod blocks/items/mobs/sprites and serves them to clients", async () => {
    contentDir = mkdtempSync(join(tmpdir(), "flatcraft-content-"));
    // Minimal placeholder - already loaded for real by test/setup.ts into
    // this file's own module registry, so loadContentPackage no-ops on
    // this copy's id (see registry/load.ts's LOADED set) without ever
    // reading its (nonexistent) type directories.
    mkdirSync(join(contentDir, "flatcraft"), { recursive: true });
    writeFileSync(join(contentDir, "flatcraft/content.json"), JSON.stringify({ id: "flatcraft", version: "0.1.0" }));

    const modDir = join(contentDir, "testmod");
    mkdirSync(join(modDir, "blocks"), { recursive: true });
    mkdirSync(join(modDir, "items"), { recursive: true });
    mkdirSync(join(modDir, "mobs"), { recursive: true });
    mkdirSync(join(modDir, "sprites/block"), { recursive: true });
    writeFileSync(join(modDir, "content.json"), JSON.stringify({ id: "testmod", version: "0.1.0" }));
    writeFileSync(
      join(modDir, "blocks/ruby_block.json"),
      JSON.stringify({
        id: "testmod:block:ruby_block",
        name: "Ruby Block",
        solid: true,
        hardness: 40,
        tool: "pickaxe",
        required_tier: 3,
        drops: { item: "testmod:item:ruby", amount: 1 },
        visual: { variants: 3, shader: { id: "shimmer" } },
      }),
    );
    writeFileSync(
      join(modDir, "items/ruby.json"),
      JSON.stringify({
        id: "testmod:item:ruby",
        name: "Ruby",
        recipes: [
          {
            station: "crafting_table",
            style: "shapeless",
            ingredients: ["item:flatcraft:item:diamond", "item:flatcraft:item:redstone"],
          },
        ],
      }),
    );
    writeFileSync(
      join(modDir, "items/ruby_block_item.json"),
      JSON.stringify({ id: "testmod:item:ruby_block_item", name: "Ruby Block", places_block: "testmod:block:ruby_block" }),
    );
    writeFileSync(
      join(modDir, "mobs/ruby_golem.json"),
      JSON.stringify({
        id: "testmod:mob:ruby_golem",
        name: "Ruby Golem",
        health: 40,
        speed: 0.05,
        size: { width: 1, height: 2 },
        melee: { damage: 5, cooldown: 20, follow_range: 10 },
        loot: [{ item: "testmod:item:ruby", max: 1, chance: 1 }],
      }),
    );
    // Not a real PNG - the server just serves bytes by extension, never
    // decodes them; only the (browser) client would ever need this to be
    // a real image.
    writeFileSync(join(modDir, "sprites/block/ruby_block.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    dataDir = mkdtempSync(join(tmpdir(), "flatcraft-data-"));
    server = await startDedicatedServer({ port: 0, dataDir, contentDir, seed: 1, log: () => {} });

    // The server process registries know the mod content.
    const blockId = blockByName("testmod:block:ruby_block");
    expect(blockId).toBeDefined();
    expect(blockId!).toBeGreaterThanOrEqual(78); // dynamic id range
    expect(blockDef(blockId!).displayName).toBe("Ruby Block");
    expect(blockDef(blockId!).visual).toEqual({ variants: 3, shader: { id: "shimmer" } });
    expect(itemDef("testmod:item:ruby")?.name).toBe("Ruby");
    expect(itemDef("testmod:item:ruby_block_item")?.block).toBe(blockId);
    expect(RECIPES.get("testmod:item:ruby")?.kind).toBe("crafting");
    expect(mobDef("testmod:mob:ruby_golem")?.health).toBe(40);
    expect(mobDef("testmod:mob:ruby_golem")?.melee?.damage).toBe(5);
    expect(mobDef("testmod:mob:ruby_golem")?.loot?.[0]?.item).toBe("testmod:item:ruby");

    // Clients get the raw content-package JSON to register the same
    // content - every discovered package except flatcraft, already
    // bundled into the client build (see client/src/content.ts).
    const contentResponse = await fetch(`http://localhost:${server.port}/api/content`);
    expect(contentResponse.ok).toBe(true);
    const packages = (await contentResponse.json()) as Record<string, Record<string, unknown>>;
    expect(packages["flatcraft"]).toBeUndefined();
    const modFiles = packages["testmod"]!;
    expect(Object.keys(modFiles).sort()).toEqual([
      "blocks/ruby_block.json",
      "items/ruby.json",
      "items/ruby_block_item.json",
      "mobs/ruby_golem.json",
    ]);
    expect((modFiles["blocks/ruby_block.json"] as { visual?: unknown }).visual).toEqual({
      variants: 3,
      shader: { id: "shimmer" },
    });

    // Clients get its sprites too, via the sprite manifest + /sprites/.
    const manifestResponse = await fetch(`http://localhost:${server.port}/sprites/manifest.json`);
    const manifest = (await manifestResponse.json()) as string[];
    expect(manifest).toContain("block/ruby_block.png");
    const spriteResponse = await fetch(`http://localhost:${server.port}/sprites/block/ruby_block.png`);
    expect(spriteResponse.ok).toBe(true);
    expect(new Uint8Array(await spriteResponse.arrayBuffer())).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));

    // The world save's palette carries the mod block by name.
    server.gameServer.simulation.world.ensureChunk(0, 0);
    server.gameServer.simulation.world.setBlock(1, 1, blockId!);
    const save = server.gameServer.simulation.serialize();
    expect(save.blockPalette![blockId!]).toBe("testmod:block:ruby_block");

    // Mod mobs work in the live simulation exactly like built-in ones.
    const golem = server.gameServer.simulation.spawnMob("testmod:mob:ruby_golem", 5, 5, []);
    expect(golem.health).toBe(40);
    expect(server.gameServer.simulation.entities.get(golem.id)?.kind).toBe("testmod:mob:ruby_golem");
  });
});
