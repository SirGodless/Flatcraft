import { Texture } from "pixi.js";
import { BlockId } from "@flatcraft/sim";

/** On-screen size of one tile at zoom 1, and texture resolution per block. */
export const TILE_PX = 16;

interface BlockStyle {
  base: [number, number, number];
  /** Optional differently-colored strip at the top (e.g. grass). */
  top?: { color: [number, number, number]; rows: number };
  /** Per-pixel brightness jitter, 0..1. */
  noise: number;
}

const STYLES: Partial<Record<BlockId, BlockStyle>> = {
  [BlockId.Stone]: { base: [122, 122, 128], noise: 0.12 },
  [BlockId.Dirt]: { base: [134, 96, 60], noise: 0.14 },
  [BlockId.Grass]: { base: [134, 96, 60], top: { color: [92, 168, 73], rows: 4 }, noise: 0.14 },
  [BlockId.Bedrock]: { base: [58, 58, 62], noise: 0.25 },
};

/** Tiny deterministic PRNG so textures look identical on every load. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeBlockTexture(id: BlockId, style: BlockStyle): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = TILE_PX;
  canvas.height = TILE_PX;
  const ctx = canvas.getContext("2d")!;
  const rand = lcg(0xf1a7 + id * 7919);

  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const inTop = style.top !== undefined && y < style.top.rows;
      const [r, g, b] = inTop ? style.top!.color : style.base;
      const jitter = 1 - style.noise + rand() * style.noise * 2;
      ctx.fillStyle = `rgb(${Math.round(r * jitter)},${Math.round(g * jitter)},${Math.round(b * jitter)})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }

  const texture = Texture.from(canvas);
  texture.source.scaleMode = "nearest";
  return texture;
}

export function createBlockTextures(): Map<BlockId, Texture> {
  const textures = new Map<BlockId, Texture>();
  for (const [id, style] of Object.entries(STYLES)) {
    textures.set(Number(id) as BlockId, makeBlockTexture(Number(id) as BlockId, style));
  }
  return textures;
}
