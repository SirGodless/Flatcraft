import type { BlockFallbackJson } from "@flatcraft/sim";

/** On-screen size of one tile at zoom 1, and texture resolution per block.
 * Lives here (not textures.ts, which re-exports it) so this file stays
 * free of any Pixi/DOM dependency - the block-baking script (see
 * scripts/bake-block-sprites.ts) imports only this file under plain
 * Node, no browser globals involved. */
export const TILE_PX = 16;

/** [r,g,b] triples come from BlockFallbackJson as `number[]` (JSON has no
 * fixed-length array type) but are validated to have exactly 3 entries at
 * content-load time (registry/schema.ts's validateColorTriple) - safe to
 * assert here rather than re-check on every pixel. */
function rgb(triple: number[]): [number, number, number] {
  return [triple[0]!, triple[1]!, triple[2]!];
}

function shapeMask(shape: NonNullable<BlockFallbackJson["shape"]>, x: number, y: number): boolean {
  switch (shape) {
    case "stairs": {
      // Steps descending to the left, 4px each.
      const step = Math.floor(x / 4);
      return y >= TILE_PX - (step + 1) * 4;
    }
    case "fence":
      return (x >= 2 && x <= 4) || (x >= 11 && x <= 13) || y === 4 || y === 5 || y === 10 || y === 11;
    case "door_open":
      return x <= 3; // swung against the left edge
    case "trapdoor_open":
      return x >= TILE_PX - 4; // folded against the right edge
  }
}

/** Tiny deterministic PRNG so textures look identical on every load. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * The pure pixel math behind a block's procedural fallback look, with no
 * canvas/DOM dependency - a flat RGBA byte buffer (row-major, 4 bytes per
 * pixel), used both by textures.ts's makeBlockTexture (drawn onto a Pixi
 * canvas texture at runtime) and by scripts/bake-block-sprites.ts (baked
 * once into a real PNG under Node, no browser involved). `variant` picks
 * a distinct-but-still-deterministic noise seed, so a block with declared
 * visual.variants gets free procedural variety even without any sprite
 * files (see textures.ts's createBlockTextureVariants).
 */
export function renderBlockPixels(id: number, style: BlockFallbackJson, variant = 0): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(TILE_PX * TILE_PX * 4);
  const rand = lcg(0xf1a7 + id * 7919 + variant * 104729);
  const alpha = Math.round((style.alpha ?? 1) * 255);

  const setPixel = (x: number, y: number, r: number, g: number, b: number): void => {
    const i = (y * TILE_PX + x) * 4;
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
    pixels[i + 3] = alpha;
  };

  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      if (style.holes !== undefined && rand() < style.holes) continue;
      if (style.fill_rows !== undefined && y < TILE_PX - style.fill_rows) continue;
      if (style.shape !== undefined && !shapeMask(style.shape, x, y)) continue;
      const inTop = style.top !== undefined && y < style.top.rows;
      let [r, g, b] = inTop ? rgb(style.top!.color) : rgb(style.base);
      if (style.stripe && x % 4 < 2) {
        r *= 0.82;
        g *= 0.82;
        b *= 0.82;
      }
      const jitter = 1 - style.noise + rand() * style.noise * 2;
      setPixel(x, y, Math.round(r * jitter), Math.round(g * jitter), Math.round(b * jitter));
    }
  }

  if (style.specks) {
    const [r, g, b] = rgb(style.specks.color);
    for (let i = 0; i < style.specks.count; i++) {
      const sx = 1 + Math.floor(rand() * (TILE_PX - 3));
      const sy = 1 + Math.floor(rand() * (TILE_PX - 3));
      const jitter = 0.9 + rand() * 0.2;
      const rr = Math.round(r * jitter);
      const gg = Math.round(g * jitter);
      const bb = Math.round(b * jitter);
      setPixel(sx, sy, rr, gg, bb);
      setPixel(sx + 1, sy, rr, gg, bb);
      setPixel(sx, sy + 1, rr, gg, bb);
      setPixel(sx + 1, sy + 1, rr, gg, bb);
    }
  }

  if (style.opening) {
    for (let y = 9; y < 14; y++) for (let x = 4; x < 12; x++) setPixel(x, y, 24, 22, 20);
    for (let y = 12; y < 14; y++) for (let x = 6; x < 10; x++) setPixel(x, y, 230, 140, 40);
  }

  if (style.frame) {
    const [r, g, b] = rgb(style.frame);
    for (let x = 0; x < TILE_PX; x++) {
      setPixel(x, 0, r, g, b);
      setPixel(x, TILE_PX - 1, r, g, b);
    }
    for (let y = 0; y < TILE_PX; y++) {
      setPixel(0, y, r, g, b);
      setPixel(TILE_PX - 1, y, r, g, b);
    }
  }

  return pixels;
}
