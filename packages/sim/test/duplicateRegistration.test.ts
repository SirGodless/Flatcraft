import { describe, expect, it } from "vitest";
import { registerBlockJson, registerItemJson, registerMobJson } from "../src/index.js";

/**
 * Own file, not items/mobs/block-adjacent test files: registerBlockJson/
 * registerItemJson/registerMobJson are process-global registries shared
 * by every test in one file - registering a throwaway id here must not
 * leak into another test file's assertions about what's registered.
 *
 * Regression test for a real gap found during a full-codebase philosophy
 * audit: every other content-type registry (dimension, biome, vein,
 * wood, nether_layer, multiblock, enchant, liquid, structure) throws on
 * a duplicate id, but block/item/mob's registerXJson functions used to
 * silently overwrite the existing def instead - worse for blocks
 * specifically, since a re-registration reused the existing numeric id,
 * silently replacing a live BlockDef's storage slot underneath any code
 * still holding the old one.
 */
describe("registerBlockJson/registerItemJson/registerMobJson reject duplicate ids", () => {
  it("rejects a duplicate block id", () => {
    registerBlockJson({ id: "test_dupe:block:widget", solid: true, hardness: 1 });
    expect(() => registerBlockJson({ id: "test_dupe:block:widget", solid: true, hardness: 1 })).toThrow(
      /already registered/,
    );
  });

  it("rejects a duplicate item id", () => {
    registerItemJson({ id: "test_dupe:item:widget" });
    expect(() => registerItemJson({ id: "test_dupe:item:widget" })).toThrow(/already registered/);
  });

  it("rejects a duplicate mob id", () => {
    const mob = { id: "test_dupe:mob:widget", health: 10, speed: 1, size: { width: 1, height: 1 } };
    registerMobJson(mob);
    expect(() => registerMobJson(mob)).toThrow(/already registered/);
  });
});
