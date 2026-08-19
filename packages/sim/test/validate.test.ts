import { describe, expect, it } from "vitest";
import {
  allBiomeIds,
  allDimensionIds,
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
      parseMultiblock("test_validate_missing_1", {
        id: "test_validate_missing_1",
        handler: "nobody_registered_this_1",
        trigger_on: { type: "place_block", item: "coal" },
      }),
    );
    registerMultiblock(
      parseMultiblock("test_validate_missing_2", {
        id: "test_validate_missing_2",
        handler: "nobody_registered_this_2",
        trigger_on: { type: "place_block", item: "bone" },
      }),
    );

    const problems = validateMultiblockHandlers();
    expect(problems).toContain('multiblock "test_validate_missing_1" references unknown behavior "nobody_registered_this_1"');
    expect(problems).toContain('multiblock "test_validate_missing_2" references unknown behavior "nobody_registered_this_2"');
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
    expect(allDimensionIds()).toEqual(expect.arrayContaining(["overworld", "nether"]));
    expect(validateDimensionGenerators()).toEqual([]);
  });

  it("reports a dimension referencing an unregistered generator", () => {
    registerDimension(
      parseDimension("test_validate_dim_missing", {
        id: "test_validate_dim_missing",
        generator: "nobody_registered_this_generator",
        spawns: "flatcraft:overworld_spawns",
        arrival: "flatcraft:overworld_arrival",
        has_sky: true,
      }),
    );
    expect(validateDimensionGenerators()).toContain(
      'dimension "test_validate_dim_missing" references unknown generator "nobody_registered_this_generator"',
    );
  });

  it("rejects registering a dimension id that's already taken", () => {
    expect(() =>
      registerDimension(
        parseDimension("overworld", {
          id: "overworld",
          generator: "flatcraft:overworld",
          spawns: "flatcraft:overworld_spawns",
          arrival: "flatcraft:overworld_arrival",
          has_sky: true,
        }),
      ),
    ).toThrow(/already registered/);
  });

  it("the default respawn dimension is exactly one, with a working spawn point", () => {
    expect(validateDefaultDimension()).toEqual([]);
    expect(defaultDimensionId()).toBe("overworld");
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
    expect(allBiomeIds()).toEqual(expect.arrayContaining(["desert", "plains", "forest", "mountains"]));
    expect(validateBiomeReferences()).toEqual([]);
  });

  it("reports a biome referencing an unregistered wood or vein", () => {
    registerBiome(
      parseBiome("test_validate_biome_missing", {
        id: "test_validate_biome_missing",
        noise_max: 0.01,
        layers: [],
        floor: "stone",
        tree_chance: 0.1,
        tree_woods: [{ wood: "nobody_registered_this_wood", weight: 1 }],
        extra_veins: ["nobody_registered_this_vein"],
      }),
    );
    const problems = validateBiomeReferences();
    expect(problems).toContain('biome "test_validate_biome_missing" references unknown wood "nobody_registered_this_wood"');
    expect(problems).toContain('biome "test_validate_biome_missing" references unknown vein "nobody_registered_this_vein"');
    expect(validateAllContent().length).toBeGreaterThanOrEqual(2);
  });

  it("rejects registering a biome id that's already taken", () => {
    expect(() =>
      registerBiome(parseBiome("plains", { id: "plains", noise_max: 0.55, layers: [], floor: "stone", tree_chance: 0 })),
    ).toThrow(/already registered/);
  });

  it("rejects a biome layer/floor/wall/snow block name that doesn't exist", () => {
    expect(() =>
      parseBiome("test_validate_biome_badblock", {
        id: "test_validate_biome_badblock",
        noise_max: 0.01,
        layers: [],
        floor: "not_a_real_block",
        tree_chance: 0,
      }),
    ).toThrow(/unknown floor block/);
  });
});
