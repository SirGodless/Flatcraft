import { Texture } from "pixi.js";
import { mobDef } from "@flatcraft/sim";
import { spriteKey, SPRITE_OVERRIDES } from "./sprites.js";

/**
 * Mob sprites: a datapack PNG (the mob def's `sprite` field, or the
 * convention path sprites/mob/<kind>.png) beats the procedural fallback
 * shapes in renderer.ts's buildEntityGfx - same "PNG first, art second"
 * rule as itemTexture() in icons.ts. No override found simply means:
 * draw the procedural shape, nothing is ever invisible.
 */
export function mobTexture(kind: string): Texture | undefined {
  return SPRITE_OVERRIDES.get(spriteKey(mobDef(kind)?.sprite) ?? `mob/${kind}`);
}
