import type { ItemFallbackJson } from "@flatcraft/sim";
import { hexToNumber } from "./color.js";
import { TILE_PX } from "./blockPixels.js";

/**
 * The pure pixel math behind an item's procedural fallback look (8x8
 * hand-drawn art, rendered at 2x - see ItemFallbackJson's doc comment),
 * with no canvas/DOM dependency. Mirrors blockPixels.ts's split: shared
 * verbatim by icons.ts's artTexture (drawn onto a Pixi canvas texture at
 * runtime) and scripts/bake-sprites.ts (baked once into a real PNG under
 * Node).
 */
export function renderItemPixels(art: ItemFallbackJson): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(TILE_PX * TILE_PX * 4);
  art.rows.forEach((row, y) => {
    [...row].forEach((char, x) => {
      const color = art.palette[char];
      if (!color) return;
      const num = hexToNumber(color);
      const r = (num >> 16) & 0xff;
      const g = (num >> 8) & 0xff;
      const b = num & 0xff;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const i = ((y * 2 + dy) * TILE_PX + (x * 2 + dx)) * 4;
          pixels[i] = r;
          pixels[i + 1] = g;
          pixels[i + 2] = b;
          pixels[i + 3] = 255;
        }
      }
    });
  });
  return pixels;
}
