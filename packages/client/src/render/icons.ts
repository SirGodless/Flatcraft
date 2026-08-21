import { Texture } from "pixi.js";
import { BlockId, hash01, itemDef, localName, type ItemFallbackJson } from "@flatcraft/sim";
import { spriteKey, SPRITE_OVERRIDES } from "./sprites.js";
import { TILE_PX } from "./textures.js";

/**
 * Item icons. Block items reuse their block texture; everything else
 * looks for a declared visual.fallback (data/items/*.json) - hand-drawn
 * 8x8 pixel art (scaled x2), original basic-style graphics.
 */

const cache = new Map<string, Texture>();

/** Solid magenta, the classic "missing texture" convention - same intent
 * and color as textures.ts's MISSING_TEXTURE_STYLE (blocks) and
 * renderer.ts's buildEntityGfx (mobs), expressed as rows+palette here
 * since that's this file's own fallback-art format. */
const MISSING_TEXTURE_ART: ItemFallbackJson = { rows: Array(8).fill("MMMMMMMM"), palette: { M: "#ff00ff" } };

function artTexture(art: ItemFallbackJson): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = TILE_PX;
  canvas.height = TILE_PX;
  const ctx = canvas.getContext("2d")!;
  art.rows.forEach((row, y) => {
    [...row].forEach((char, x) => {
      const color = art.palette[char];
      if (!color) return;
      ctx.fillStyle = color;
      ctx.fillRect(x * 2, y * 2, 2, 2);
    });
  });
  const texture = Texture.from(canvas);
  texture.source.scaleMode = "nearest";
  return texture;
}

/** Distinguishes this hash use from any other cosmetic roll that might
 * someday also hash the same seed (item variant vs. e.g. a future
 * particle-color roll), so they never accidentally correlate. */
const VARIANT_SALT = 0x1;

/**
 * @param variantSeed World-stable id (e.g. the dropped ItemEntity's id)
 * to deterministically pick one of the item's declared sprite variants
 * - every client picks the same one without any sync. Omit for UI
 * contexts (hotbar, cursor, crafting grid, held-item icon): those stay
 * pinned to variant 0 so inventory icons don't flicker/vary.
 */
export function itemTexture(item: string, blockTextures: Map<BlockId, Texture>, variantSeed?: number): Texture | undefined {
  const def = itemDef(item);
  const variantCount = def?.visual?.variants ?? 1;
  const hasVariants = variantCount > 1;
  const variantIndex = hasVariants && variantSeed !== undefined ? Math.floor(hash01(variantSeed, VARIANT_SALT) * variantCount) : 0;
  const cacheKey = hasVariants ? `${item}#${variantIndex}` : item;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  // Sprite files beat everything (datapack override or convention path).
  const baseKey = spriteKey(def?.sprite) ?? `item/${localName(item)}`;
  let texture: Texture | undefined = SPRITE_OVERRIDES.get(hasVariants ? `${baseKey}_${variantIndex}` : baseKey);
  if (!texture) {
    if (def?.block !== undefined) {
      texture = blockTextures.get(def.block);
    } else if (def?.visual?.fallback) {
      texture = artTexture(def.visual.fallback);
    } else {
      // No sprite, no block texture to reuse, no declared fallback (or
      // not even a registered item at all) - the same loud magenta
      // missing-texture placeholder + console warning every other
      // content type uses for the same situation (see textures.ts's
      // MISSING_TEXTURE_STYLE, renderer.ts's buildEntityGfx).
      console.warn(`item "${item}" has no sprite and no declared visual.fallback - showing a missing-texture placeholder`);
      texture = artTexture(MISSING_TEXTURE_ART);
    }
  }
  if (texture) cache.set(cacheKey, texture);
  return texture;
}
