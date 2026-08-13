import { Texture } from "pixi.js";
import { mobDef } from "@flatcraft/sim";
import { spriteKey, SPRITE_OVERRIDES } from "./sprites.js";

/**
 * Sprites for any non-item entity kind (mobs, arrows, ...): a datapack
 * PNG beats the procedural fallback shapes in renderer.ts's
 * buildEntityGfx - same "PNG first, art second" rule as itemTexture()
 * in icons.ts. No override found simply means: draw the procedural
 * shape, nothing is ever invisible.
 *
 * Registered mobs use the mob def's own `sprite` field, or the
 * convention path sprites/mob/<kind>.png. Everything else (arrows
 * today; any future non-mob entity kind) uses sprites/entity/<kind>.png
 * - there's no per-kind def to hold an override path for those.
 */
export function entityTexture(kind: string): Texture | undefined {
  const def = mobDef(kind);
  if (def) return SPRITE_OVERRIDES.get(spriteKey(def.sprite) ?? `mob/${kind}`);
  return SPRITE_OVERRIDES.get(`entity/${kind}`);
}
