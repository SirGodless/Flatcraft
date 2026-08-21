import { describe, expect, it } from "vitest";
import {
  allBiomeIds,
  allDimensionIds,
  defaultDimensionId,
  registerBiomeJson,
  registerCommandHandler,
  registerDimensionJson,
  registerMultiblockJson,
  validateAllContent,
  validateAllRefs,
  validateCommandHandlers,
  validateDefaultDimension,
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
 *
 * validateMultiblockHandlers/validateDimensionGenerators/validatePortalLinks/
 * validateSpawnGenerators/validateStructureDimensions/
 * validateBiomeReferences/validateItemEnchants no longer exist as bespoke
 * functions - every one of them was a hand-written "does this `ref` field's
 * value actually resolve" check duplicating what registry/generic.ts's
 * `ref` field declarations already describe. They're all exercised here
 * through validateAllRefs()/validateAllContent() instead (see validate.ts
 * and registry/generic.ts's own doc comments for the full story of why
 * that consolidation happened).
 */

describe("content dependency validation (ref fields)", () => {
  it("the real, built-in content has no dangling ref", () => {
    // Runs first in this file, before any synthetic bad def below is
    // registered into the same shared (per-file) module instance.
    expect(validateAllRefs()).toEqual([]);
    expect(validateAllContent()).toEqual([]);
  });

  it("reports every multiblock with a missing handler, not just the first", () => {
    registerMultiblockJson({
      id: "flatcraft:multiblock:test_validate_missing_1",
      handler: "flatcraft:multiblock_handler:nobody_registered_this_1",
      trigger_on: { type: "place_block", item: "flatcraft:item:coal" },
    });
    registerMultiblockJson({
      id: "flatcraft:multiblock:test_validate_missing_2",
      handler: "flatcraft:multiblock_handler:nobody_registered_this_2",
      trigger_on: { type: "place_block", item: "flatcraft:item:bone" },
    });

    const problems = validateAllRefs();
    expect(problems.some((p) => p.includes("flatcraft:multiblock_handler:nobody_registered_this_1"))).toBe(true);
    expect(problems.some((p) => p.includes("flatcraft:multiblock_handler:nobody_registered_this_2"))).toBe(true);
    // validateAllContent must surface the same problems, not swallow them.
    expect(validateAllContent().length).toBeGreaterThanOrEqual(2);
  });

  it("reports a dimension referencing an unregistered generator", () => {
    registerDimensionJson({
      id: "flatcraft:dimension:test_validate_dim_missing",
      generator: "flatcraft:dimension_generator:nobody_registered_this_generator",
      spawns: "flatcraft:spawn_generator:overworld_spawns",
      arrival: "flatcraft:arrival_generator:overworld_arrival",
      has_sky: true,
    });
    expect(
      validateAllRefs().some((p) => p.includes("flatcraft:dimension_generator:nobody_registered_this_generator")),
    ).toBe(true);
  });

  it("rejects registering a dimension id that's already taken", () => {
    expect(() =>
      registerDimensionJson({
        id: "flatcraft:dimension:overworld",
        generator: "flatcraft:dimension_generator:overworld",
        spawns: "flatcraft:spawn_generator:overworld_spawns",
        arrival: "flatcraft:arrival_generator:overworld_arrival",
        has_sky: true,
      }),
    ).toThrow(/already registered/);
  });

  it("reports a dimension's portal pointing at an unregistered dimension", () => {
    registerDimensionJson({
      id: "flatcraft:dimension:test_validate_dim_badportal",
      generator: "flatcraft:dimension_generator:overworld",
      spawns: "flatcraft:spawn_generator:overworld_spawns",
      arrival: "flatcraft:arrival_generator:overworld_arrival",
      has_sky: true,
      portal: { to: "flatcraft:dimension:nobody_registered_this_dimension", scale: 8 },
    });
    expect(
      validateAllRefs().some((p) => p.includes("flatcraft:dimension:nobody_registered_this_dimension")),
    ).toBe(true);
  });

  it("reports a dimension referencing an unregistered spawn generator", () => {
    registerDimensionJson({
      id: "flatcraft:dimension:test_validate_dim_badspawns",
      generator: "flatcraft:dimension_generator:overworld",
      spawns: "flatcraft:spawn_generator:nobody_registered_this_spawn_generator",
      arrival: "flatcraft:arrival_generator:overworld_arrival",
      has_sky: true,
    });
    expect(
      validateAllRefs().some((p) => p.includes("flatcraft:spawn_generator:nobody_registered_this_spawn_generator")),
    ).toBe(true);
  });

  it("reports a biome referencing an unregistered wood or vein", () => {
    registerBiomeJson({
      id: "flatcraft:biome:test_validate_biome_missing",
      noise_max: 0.01,
      layers: [],
      floor: "flatcraft:block:stone",
      tree_chance: 0.1,
      tree_woods: [{ wood: "flatcraft:wood:nobody_registered_this_wood", weight: 1 }],
      extra_veins: ["flatcraft:vein:nobody_registered_this_vein"],
    });
    const problems = validateAllRefs();
    expect(problems.some((p) => p.includes("flatcraft:wood:nobody_registered_this_wood"))).toBe(true);
    expect(problems.some((p) => p.includes("flatcraft:vein:nobody_registered_this_vein"))).toBe(true);
    expect(validateAllContent().length).toBeGreaterThanOrEqual(2);
  });

  it("rejects registering a biome id that's already taken", () => {
    expect(() =>
      registerBiomeJson({
        id: "flatcraft:biome:plains",
        noise_max: 0.55,
        layers: [],
        floor: "flatcraft:block:stone",
        tree_chance: 0,
      }),
    ).toThrow(/already registered/);
  });

  it("rejects a biome layer/floor/wall/snow block name that doesn't exist", () => {
    expect(() =>
      registerBiomeJson({
        id: "flatcraft:biome:test_validate_biome_badblock",
        noise_max: 0.01,
        layers: [],
        floor: "flatcraft:block:not_a_real_block",
        tree_chance: 0,
      }),
    ).toThrow(/unknown floor block/);
  });

  it("the built-in biomes are registered", () => {
    expect(allBiomeIds()).toEqual(
      expect.arrayContaining([
        "flatcraft:biome:desert",
        "flatcraft:biome:plains",
        "flatcraft:biome:forest",
        "flatcraft:biome:mountains",
      ]),
    );
  });

  it("the built-in overworld and nether are registered", () => {
    expect(allDimensionIds()).toEqual(expect.arrayContaining(["flatcraft:dimension:overworld", "flatcraft:dimension:nether"]));
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

describe("default dimension validation", () => {
  it("the default respawn dimension is exactly one, with a working spawn point", () => {
    expect(validateDefaultDimension()).toEqual([]);
    expect(defaultDimensionId()).toBe("flatcraft:dimension:overworld");
  });
});
