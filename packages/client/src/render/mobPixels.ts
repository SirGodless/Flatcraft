import type { MobFallbackJson } from "@flatcraft/sim";
import { hexToNumber } from "./color.js";

/**
 * A raster approximation of a mob's procedural fallback look (a handful
 * of colored rects, positioned in tile units - see MobFallbackJson's doc
 * comment), used only by scripts/bake-sprites.ts. Unlike blocks/items,
 * the live fallback (renderer.ts's buildEntityGfx) draws these rects
 * with Pixi's vector Graphics API straight onto the scene, not a canvas,
 * so there's no shared per-pixel draw path to extract here the way
 * blockPixels.ts/itemPixels.ts do - this is a fresh (integer-rounded)
 * rasterization for baking to a real image file, not a byte-identical
 * reproduction of the live vector rendering. At this size (rect edges a
 * fraction of a 16px tile) the rounding is imperceptible in play.
 */
export function renderMobPixels(fallback: MobFallbackJson, tilePx: number, widthPx: number, heightPx: number): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(widthPx * heightPx * 4);
  for (const rect of fallback.rects) {
    const num = hexToNumber(rect.color);
    const r = (num >> 16) & 0xff;
    const g = (num >> 8) & 0xff;
    const b = num & 0xff;
    const x0 = Math.max(0, Math.round(rect.x * tilePx));
    const y0 = Math.max(0, Math.round(rect.y * tilePx));
    const x1 = Math.min(widthPx, Math.round((rect.x + rect.w) * tilePx));
    const y1 = Math.min(heightPx, Math.round((rect.y + rect.h) * tilePx));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * widthPx + x) * 4;
        pixels[i] = r;
        pixels[i + 1] = g;
        pixels[i + 2] = b;
        pixels[i + 3] = 255;
      }
    }
  }
  return pixels;
}
