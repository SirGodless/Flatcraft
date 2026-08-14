import { describe, expect, it } from "vitest";
import {
  blockByName,
  blockDef,
  itemDef,
  mobDef,
  registerBlockJson,
  registerItemJson,
  registerMobJson,
  resolveBlockLinks,
} from "../src/index.js";

/**
 * Unified visual system, stage a: items/blocks/mobs can all declare an
 * optional `visual` component (sprite variants, sprite-sheet animation,
 * a named shader effect) through the same shared schema. This is
 * presentation-only - no simulation behavior depends on it - so these
 * tests assert directly on the resulting *Def shape rather than on
 * simulated effects (unlike e.g. mob-equipment.test.ts, which tests
 * equipment's behavioral consequences). Registration is a process-global
 * singleton, so this lives in its own test file (matches
 * custom-container.test.ts's convention).
 */

describe("visual component (datapack)", () => {
  it("registers item variants/animation/shader and round-trips them onto ItemDef", () => {
    registerItemJson({
      id: "glimmering_gem",
      name: "Glimmering Gem",
      visual: {
        variants: 3,
        animation: { states: { idle: { frames: 4, frame_width: 16, fps: 6, loop: true } } },
        shader: { id: "shimmer", params: { speed: 1.2, color: "#fff2a0" } },
      },
    });
    const def = itemDef("glimmering_gem");
    expect(def?.visual?.variants).toBe(3);
    expect(def?.visual?.animation?.states["idle"]).toEqual({ frames: 4, frame_width: 16, fps: 6, loop: true });
    expect(def?.visual?.shader).toEqual({ id: "shimmer", params: { speed: 1.2, color: "#fff2a0" } });
  });

  it("registers block variants and round-trips them onto BlockDef", () => {
    registerBlockJson({
      id: "sparkling_ore",
      name: "Sparkling Ore",
      solid: true,
      hardness: 30,
      visual: { variants: 4 },
    });
    resolveBlockLinks();
    const id = blockByName("sparkling_ore");
    expect(id).toBeDefined();
    expect(blockDef(id!).visual).toEqual({ variants: 4 });
  });

  it("registers mob animation states and round-trips them onto MobDef", () => {
    registerMobJson({
      id: "dancing_slime",
      name: "Dancing Slime",
      health: 10,
      speed: 0.05,
      size: { width: 0.6, height: 0.6 },
      visual: {
        animation: {
          states: {
            idle: { frames: 2, frame_width: 16, fps: 2 },
            walk: { frames: 4, frame_width: 16, fps: 8, loop: true },
            death: { frames: 3, frame_width: 16, fps: 10, loop: false },
          },
        },
      },
    });
    const def = mobDef("dancing_slime");
    expect(Object.keys(def?.visual?.animation?.states ?? {})).toEqual(["idle", "walk", "death"]);
    expect(def?.visual?.animation?.states["death"]).toEqual({ frames: 3, frame_width: 16, fps: 10, loop: false });
  });

  it("rejects unknown fields and out-of-range values with the field path named", () => {
    expect(() => registerItemJson({ id: "bad_item_1", visual: { made_up_field: true } })).toThrow(
      /visual\.made_up_field/,
    );
    expect(() => registerItemJson({ id: "bad_item_2", visual: { variants: 0 } })).toThrow(/visual\.variants/);
    expect(() =>
      registerMobJson({
        id: "bad_mob",
        health: 10,
        speed: 0.1,
        size: { width: 1, height: 1 },
        visual: { animation: { states: { idle: { frames: 4, frame_width: 16 } } } }, // missing fps
      }),
    ).toThrow(/fps/);
    expect(() =>
      registerItemJson({ id: "bad_item_3", visual: { shader: { id: "shimmer", params: { bad: {} } } } }),
    ).toThrow(/visual\.shader\.params\.bad/);
  });
});
