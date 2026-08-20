import { describe, expect, it } from "vitest";
import {
  allBiomeIds,
  allDimensionIds,
  allItems,
  defaultDimensionId,
  parseBiome,
  parseDimension,
  parseMultiblock,
  registerBiome,
  registerCommandHandler,
  registerDimension,
  registerMultiblock,
  validateAllContent,
  validateBiomeReferences,
  validateCommandHandlers,
  validateDefaultDimension,
  validateDimensionGenerators,
  validateItemEnchants,
  validateMultiblockHandlers,
  validatePortalLinks,
  validateSpawnGenerators,
  allDimensions,
} from "../src/index.js";

/**
 * Own file, not multiblock.test.ts: registerMultiblock/registerMultiblockHandler
 * are process-global registries shared by every test in one file (see
 * multiblock.test.ts's own doc comment), and other tests there deliberately
 * register defs with missing handlers to prove tryActivateMultiblock skips
 * them safely - which would pollute a "real content validates cleanly"
 * assertion if it lived in the same file. A fresh test file gets its own
 * module instance, so this one only ever sees the real, built-in content
 * plus whatever it registers itself.
 */

describe("content dependency validation", () => {
  it("the real, built-in multiblock content has no missing handler references", () => {
    // Runs first in this file, before any synthetic bad def below is
    // registered into the same shared (per-file) module instance.
    expect(validateMultiblockHandlers()).toEqual([]);
    expect(validateAllContent()).toEqual([]);
  });

  it("reports every multiblock with a missing handler, not just the first", () => {
    registerMultiblock(
      parseMultiblock("flatcraft:multiblock:test_validate_missing_1", {
        id: "flatcraft:multiblock:test_validate_missing_1",
        handler: "flatcraft:multiblock_handler:nobody_registered_this_1",
        trigger_on: { type: "place_block", item: "flatcraft:item:coal" },
      }),
    );
    registerMultiblock(
      parseMultiblock("flatcraft:multiblock:test_validate_missing_2", {
        id: "flatcraft:multiblock:test_validate_missing_2",
        handler: "flatcraft:multiblock_handler:nobody_registered_this_2",
        trigger_on: { type: "place_block", item: "flatcraft:item:bone" },
      }),
    );

    const problems = validateMultiblockHandlers();
    expect(problems).toContain(
      'multiblock "flatcraft:multiblock:test_validate_missing_1" references unknown behavior "flatcraft:multiblock_handler:nobody_registered_this_1"',
    );
    expect(problems).toContain(
      'multiblock "flatcraft:multiblock:test_validate_missing_2" references unknown behavior "flatcraft:multiblock_handler:nobody_registered_this_2"',
    );
    // validateAllContent must surface the same problems, not swallow them.
    expect(validateAllContent().length).toBeGreaterThanOrEqual(2);
  });
});

describe("command handler validation", () => {
  it("every literal Command.type has a registered handler - none were forgotten", () => {
    expect(validateCommandHandlers()).toEqual([]);
  });

  it("rejects registering a second handler for a command type that already has one", () => {
    expect(() => registerCommandHandler("leave", { handle: () => {} })).toThrow(/already registered/);
  });
});

describe("dimension registry", () => {
  it("the built-in overworld and nether are registered, with real generators", () => {
    expect(allDimensionIds()).toEqual(expect.arrayContaining(["flatcraft:dimension:overworld", "flatcraft:dimension:nether"]));
    expect(validateDimensionGenerators()).toEqual([]);
  });

  it("reports a dimension referencing an unregistered generator", () => {
    registerDimension(
      parseDimension("flatcraft:dimension:test_validate_dim_missing", {
        id: "flatcraft:dimension:test_validate_dim_missing",
        generator: "flatcraft:dimension_generator:nobody_registered_this_generator",
        spawns: "flatcraft:spawn_generator:overworld_spawns",
        arrival: "flatcraft:arrival_generator:overworld_arrival",
        has_sky: true,
      }),
    );
    expect(validateDimensionGenerators()).toContain(
      'dimension "flatcraft:dimension:test_validate_dim_missing" references unknown generator "flatcraft:dimension_generator:nobody_registered_this_generator"',
    );
  });

  it("rejects registering a dimension id that's already taken", () => {
    expect(() =>
      registerDimension(
        parseDimension("flatcraft:dimension:overworld", {
          id: "flatcraft:dimension:overworld",
          generator: "flatcraft:dimension_generator:overworld",
          spawns: "flatcraft:spawn_generator:overworld_spawns",
          arrival: "flatcraft:arrival_generator:overworld_arrival",
          has_sky: true,
        }),
      ),
    ).toThrow(/already registered/);
  });

  it("the default respawn dimension is exactly one, with a working spawn point", () => {
    expect(validateDefaultDimension()).toEqual([]);
    expect(defaultDimensionId()).toBe("flatcraft:dimension:overworld");
  });

  it("every dimension's portal, if any, links to a registered dimension", () => {
    expect(validatePortalLinks()).toEqual([]);
  });

  it("every registered dimension's spawn generator resolves to something registered", () => {
    expect(validateSpawnGenerators(allDimensions())).toEqual([]);
  });
});

describe("biome registry", () => {
  it("the built-in biomes are registered, with every wood/vein reference resolving", () => {
    expect(allBiomeIds()).toEqual(
      expect.arrayContaining([
        "flatcraft:biome:desert",
        "flatcraft:biome:plains",
        "flatcraft:biome:forest",
        "flatcraft:biome:mountains",
      ]),
    );
    expect(validateBiomeReferences()).toEqual([]);
  });

  it("reports a biome referencing an unregistered wood or vein", () => {
    registerBiome(
      parseBiome("flatcraft:biome:test_validate_biome_missing", {
        id: "flatcraft:biome:test_validate_biome_missing",
        noise_max: 0.01,
        layers: [],
        floor: "flatcraft:block:stone",
        tree_chance: 0.1,
        tree_woods: [{ wood: "flatcraft:wood:nobody_registered_this_wood", weight: 1 }],
        extra_veins: ["flatcraft:vein:nobody_registered_this_vein"],
      }),
    );
    const problems = validateBiomeReferences();
    expect(problems).toContain(
      'biome "flatcraft:biome:test_validate_biome_missing" references unknown wood "flatcraft:wood:nobody_registered_this_wood"',
    );
    expect(problems).toContain(
      'biome "flatcraft:biome:test_validate_biome_missing" references unknown vein "flatcraft:vein:nobody_registered_this_vein"',
    );
    expect(validateAllContent().length).toBeGreaterThanOrEqual(2);
  });

  it("rejects registering a biome id that's already taken", () => {
    expect(() =>
      registerBiome(
        parseBiome("flatcraft:biome:plains", {
          id: "flatcraft:biome:plains",
          noise_max: 0.55,
          layers: [],
          floor: "flatcraft:block:stone",
          tree_chance: 0,
        }),
      ),
    ).toThrow(/already registered/);
  });

  it("rejects a biome layer/floor/wall/snow block name that doesn't exist", () => {
    expect(() =>
      parseBiome("flatcraft:biome:test_validate_biome_badblock", {
        id: "flatcraft:biome:test_validate_biome_badblock",
        noise_max: 0.01,
        layers: [],
        floor: "flatcraft:block:not_a_real_block",
        tree_chance: 0,
      }),
    ).toThrow(/unknown floor block/);
  });
});

describe("enchant references", () => {
  it("every built-in item's enchants list resolves to a registered enchant", () => {
    expect(validateItemEnchants(allItems())).toEqual([]);
  });

  it("reports an item referencing an unregistered enchant", () => {
    const problems = validateItemEnchants([
      { id: "flatcraft:item:test_validate_item", enchants: ["flatcraft:enchant:nobody_registered_this_enchant"] },
    ]);
    expect(problems).toEqual([
      'item "flatcraft:item:test_validate_item" references unknown enchant "flatcraft:enchant:nobody_registered_this_enchant"',
    ]);
  });
});
