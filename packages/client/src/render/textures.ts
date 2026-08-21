import { Texture } from "pixi.js";
import { allBlocks, blockDef, BlockId, hash01, localName, type BlockFallbackJson } from "@flatcraft/sim";
import { spriteKey, SPRITE_OVERRIDES } from "./sprites.js";
import { renderBlockPixels, TILE_PX } from "./blockPixels.js";

export { TILE_PX };

/** Solid magenta, the classic "missing texture" convention - shown (with
 * a console warning) for any content instance with neither a real
 * sprite file nor a declared procedural fallback, across every content
 * type that can reach this state (blocks here; items in icons.ts; mobs
 * already drew their own literal magenta rect in renderer.ts's
 * buildEntityGfx before this constant existed - not migrated onto it,
 * since that path draws with pixi's Graphics API directly rather than a
 * canvas, but same color, same intent). */
export const MISSING_TEXTURE_STYLE: BlockFallbackJson = { base: [255, 0, 255], noise: 0 };

/** `variant` picks a distinct-but-still-deterministic noise seed, so a
 * block with declared visual.variants gets free procedural variety
 * even without any sprite files (createBlockTextureVariants below). The
 * actual pixel math lives in blockPixels.ts (no DOM dependency), shared
 * verbatim with scripts/bake-block-sprites.ts so a baked PNG is always
 * pixel-identical to what this would draw live. */
function makeBlockTexture(id: BlockId, style: BlockFallbackJson, variant = 0): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = TILE_PX;
  canvas.height = TILE_PX;
  const ctx = canvas.getContext("2d")!;
  const pixels = renderBlockPixels(id, style, variant);
  ctx.putImageData(new ImageData(pixels, TILE_PX, TILE_PX), 0, 0);
  const texture = Texture.from(canvas);
  texture.source.scaleMode = "nearest";
  return texture;
}

export function createBlockTextures(): Map<BlockId, Texture> {
  const textures = new Map<BlockId, Texture>();
  // Sprite files beat a declared procedural fallback; a block with
  // neither is genuinely broken content (a mod block that shipped no
  // visual at all), not a case to quietly paper over - it gets the same
  // loud magenta missing-texture placeholder + console warning every
  // other content type uses for the same situation (see icons.ts's
  // itemTexture, renderer.ts's buildEntityGfx).
  for (const def of allBlocks()) {
    if (def.id === BlockId.Air) continue;
    const key = def.sprite
      ? def.sprite.replace(/^sprites\//, "").replace(/\.[a-z0-9]+$/i, "")
      : `block/${localName(def.name)}`;
    const sprite = SPRITE_OVERRIDES.get(key);
    if (sprite) {
      textures.set(def.id, sprite);
    } else if (def.visual?.fallback) {
      textures.set(def.id, makeBlockTexture(def.id, def.visual.fallback));
    } else {
      console.warn(`block "${def.name}" has no sprite and no declared visual.fallback - showing a missing-texture placeholder`);
      textures.set(def.id, makeBlockTexture(def.id, MISSING_TEXTURE_STYLE));
    }
  }
  return textures;
}

/** Distinguishes this hash use from icons.ts's/entitySprites.ts's own
 * VARIANT_SALT (each only needs to be internally consistent). */
const VARIANT_SALT = 0x2;

/**
 * Per-tile texture variants for blocks whose def declares
 * `visual.variants > 1` (e.g. an ore that shouldn't look identical
 * every tile) - sparse, only block ids that opt in get an entry.
 * Blocks with a declared procedural fallback get distinctly-seeded
 * variants for free, no sprite files required; sprite-backed blocks look
 * for numbered files (block/<name>_0.png, _1.png, ...), falling back to
 * the block's single base texture for any variant whose file is missing
 * - never invisible, same rule every other sprite lookup here follows.
 */
export function createBlockTextureVariants(base: Map<BlockId, Texture>): Map<BlockId, Texture[]> {
  const variants = new Map<BlockId, Texture[]>();
  for (const def of allBlocks()) {
    const count = def.visual?.variants ?? 1;
    if (count <= 1) continue;
    const style = def.visual?.fallback;
    const key = spriteKey(def.sprite) ?? `block/${localName(def.name)}`;
    const textures: Texture[] = [];
    for (let i = 0; i < count; i++) {
      const sprite = SPRITE_OVERRIDES.get(`${key}_${i}`);
      textures.push(sprite ?? (style ? makeBlockTexture(def.id, style, i) : base.get(def.id)!));
    }
    variants.set(def.id, textures);
  }
  return variants;
}

/** The texture for one specific tile: a deterministic variant pick when
 * the block id has any (every client computes the same index from the
 * same world position, no sync needed), else the block's single base
 * texture - identical behavior to before variants existed. */
/** A block's single continuously-looping ambient clip - unlike mobs, blocks
 * have no event-driven states (hurt/death/attack), just idle motion, so
 * there's no state machine here, only the frame set to play. */
export interface BlockAnimationClip {
  frames: number;
  frameWidth: number;
  fps: number;
  loop: boolean;
  sheet: Texture;
}

/** The block's default animation clip (preferring a state named "idle",
 * else whichever comes first in visual.animation.states), if its sprite
 * sheet file (block/<name>_<state>.png) is actually present - missing file
 * or no declared animation both simply mean: no clip, caller falls back to
 * the plain per-tile texture from pickBlockTexture(). */
export function blockAnimationClip(id: BlockId): BlockAnimationClip | undefined {
  const def = blockDef(id);
  const states = def?.visual?.animation?.states;
  if (!states) return undefined;
  const baseKey = spriteKey(def!.sprite) ?? `block/${localName(def!.name)}`;
  const preferred = states["idle"] ? "idle" : Object.keys(states)[0];
  if (preferred === undefined) return undefined;
  const clip = states[preferred]!;
  const sheet = SPRITE_OVERRIDES.get(`${baseKey}_${preferred}`);
  if (!sheet) return undefined;
  return { frames: clip.frames, frameWidth: clip.frame_width, fps: clip.fps, loop: clip.loop ?? true, sheet };
}

export function pickBlockTexture(
  base: Map<BlockId, Texture>,
  variants: Map<BlockId, Texture[]>,
  id: BlockId,
  worldX: number,
  worldY: number,
): Texture | undefined {
  const textures = variants.get(id);
  if (!textures || textures.length <= 1) return base.get(id);
  const index = Math.floor(hash01(id, worldX, worldY, VARIANT_SALT) * textures.length);
  return textures[index];
}
