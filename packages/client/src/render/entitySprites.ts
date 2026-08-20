import { Texture } from "pixi.js";
import { hash01, localName, mobDef } from "@flatcraft/sim";
import { spriteKey, SPRITE_OVERRIDES } from "./sprites.js";

/** Same salt-distinguishing rationale as icons.ts's VARIANT_SALT - kept
 * as its own constant since the two never need to agree on a value,
 * only each be internally consistent. */
const VARIANT_SALT = 0x1;

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
 *
 * @param variantSeed World-stable id (the spawned entity's own id) to
 * deterministically pick one of the mob's declared sprite variants -
 * every client picks the same one without any sync. Omit to pin to
 * variant 0 (e.g. no stable id exists for the caller's context).
 */
export function entityTexture(kind: string, variantSeed?: number): Texture | undefined {
  const def = mobDef(kind);
  const variantCount = def?.visual?.variants ?? 1;
  const hasVariants = variantCount > 1;
  const variantIndex = hasVariants && variantSeed !== undefined ? Math.floor(hash01(variantSeed, VARIANT_SALT) * variantCount) : 0;
  const suffix = hasVariants ? `_${variantIndex}` : "";
  if (def) return SPRITE_OVERRIDES.get((spriteKey(def.sprite) ?? `mob/${localName(kind)}`) + suffix);
  return SPRITE_OVERRIDES.get(`entity/${kind}${suffix}`);
}

export interface AnimationClip {
  frames: number;
  frameWidth: number;
  fps: number;
  loop: boolean;
  sheet: Texture;
}

/**
 * Every named animation state a mob kind declares, for whichever ones
 * actually have their sprite-sheet file present
 * (sprites/mob/<kind>_<state>.png) - a state without a file simply
 * doesn't appear here (not fatal; the state machine just can't play
 * it, same "missing sprite -> no crash" rule as everywhere else). Empty
 * / undefined means: no animation, caller falls back to
 * entityTexture()'s single-frame path.
 */
export function entityAnimationStates(kind: string): Record<string, AnimationClip> | undefined {
  const def = mobDef(kind);
  const states = def?.visual?.animation?.states;
  if (!states) return undefined;
  const baseKey = spriteKey(def!.sprite) ?? `mob/${localName(kind)}`;
  const result: Record<string, AnimationClip> = {};
  for (const [name, clip] of Object.entries(states)) {
    const sheet = SPRITE_OVERRIDES.get(`${baseKey}_${name}`);
    if (!sheet) continue;
    result[name] = { frames: clip.frames, frameWidth: clip.frame_width, fps: clip.fps, loop: clip.loop ?? true, sheet };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
