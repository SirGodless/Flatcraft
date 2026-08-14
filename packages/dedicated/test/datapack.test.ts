import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { blockByName, blockDef, itemDef, mobDef, RECIPES } from "@flatcraft/sim";
import { startDedicatedServer, type DedicatedServer } from "../src/server.js";

/**
 * Server datapack (modding): JSON files dropped into
 * DATA_DIR/datapack/{blocks,items} are loaded at boot, get dynamic
 * block ids, work in the recipe registry, and are served to clients
 * via /api/datapack. Runs in its own test file because registries are
 * process-global.
 */

let server: DedicatedServer | null = null;
let dataDir: string | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  dataDir = null;
});

describe("server datapack", () => {
  it("loads mod blocks and items and serves them to clients", async () => {
    dataDir = mkdtempSync(join(tmpdir(), "flatcraft-datapack-"));
    mkdirSync(join(dataDir, "datapack/blocks"), { recursive: true });
    mkdirSync(join(dataDir, "datapack/items"), { recursive: true });
    mkdirSync(join(dataDir, "datapack/mobs"), { recursive: true });
    writeFileSync(
      join(dataDir, "datapack/blocks/ruby_block.json"),
      JSON.stringify({
        id: "ruby_block",
        name: "Ruby Block",
        solid: true,
        hardness: 40,
        tool: "pickaxe",
        required_tier: 3,
        drops: { item: "ruby", amount: 1 },
        visual: { variants: 3, shader: { id: "shimmer" } },
      }),
    );
    writeFileSync(
      join(dataDir, "datapack/items/ruby.json"),
      JSON.stringify({
        id: "ruby",
        name: "Ruby",
        recipes: [
          {
            station: "crafting_table",
            style: "shapeless",
            ingredients: ["item:diamond", "item:redstone"],
          },
        ],
      }),
    );
    writeFileSync(
      join(dataDir, "datapack/items/ruby_block_item.json"),
      JSON.stringify({ id: "ruby_block_item", name: "Ruby Block", places_block: "ruby_block" }),
    );
    writeFileSync(
      join(dataDir, "datapack/mobs/ruby_golem.json"),
      JSON.stringify({
        id: "ruby_golem",
        name: "Ruby Golem",
        health: 40,
        speed: 0.05,
        size: { width: 1, height: 2 },
        melee: { damage: 5, cooldown: 20, follow_range: 10 },
        loot: [{ item: "ruby", max: 1, chance: 1 }],
      }),
    );

    server = await startDedicatedServer({ port: 0, dataDir, seed: 1, log: () => {} });

    // The server process registries know the mod content.
    const blockId = blockByName("ruby_block");
    expect(blockId).toBeDefined();
    expect(blockId!).toBeGreaterThanOrEqual(78); // dynamic id range
    expect(blockDef(blockId!).displayName).toBe("Ruby Block");
    expect(blockDef(blockId!).visual).toEqual({ variants: 3, shader: { id: "shimmer" } });
    expect(itemDef("ruby")?.name).toBe("Ruby");
    expect(itemDef("ruby_block_item")?.block).toBe(blockId);
    expect(RECIPES.get("ruby")?.kind).toBe("crafting");
    expect(mobDef("ruby_golem")?.health).toBe(40);
    expect(mobDef("ruby_golem")?.melee?.damage).toBe(5);
    expect(mobDef("ruby_golem")?.loot?.[0]?.item).toBe("ruby");

    // Clients get the raw datapack to register the same content.
    const response = await fetch(`http://localhost:${server.port}/api/datapack`);
    expect(response.ok).toBe(true);
    const pack = (await response.json()) as { blocks: unknown[]; items: unknown[]; mobs: unknown[]; sprites: string[] };
    expect(pack.blocks).toHaveLength(1);
    expect(pack.items).toHaveLength(2);
    expect(pack.mobs).toHaveLength(1);
    expect((pack.blocks[0] as { visual?: unknown }).visual).toEqual({ variants: 3, shader: { id: "shimmer" } });

    // The world save's palette carries the mod block by name.
    server.gameServer.simulation.world.ensureChunk(0, 0);
    server.gameServer.simulation.world.setBlock(1, 1, blockId!);
    const save = server.gameServer.simulation.serialize();
    expect(save.blockPalette![blockId!]).toBe("ruby_block");

    // Mod mobs work in the live simulation exactly like built-in ones.
    const golem = server.gameServer.simulation.spawnMob("ruby_golem", 5, 5, []);
    expect(golem.health).toBe(40);
    expect(server.gameServer.simulation.entities.get(golem.id)?.kind).toBe("ruby_golem");
  });
});
