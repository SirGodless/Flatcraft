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
  /** Overall opacity (water). */
  alpha?: number;
  /** Probability per pixel of being fully transparent (leaves). */
  holes?: number;
  /** Darken vertical bands (logs' bark look). */
  stripe?: boolean;
  /** Colored 2x2 speckles on top of the base (ores). */
  specks?: { color: [number, number, number]; count: number };
  /** Dark opening at the bottom center (furnace mouth). */
  opening?: boolean;
  /** 1px border in this color (glass pane look). */
  frame?: [number, number, number];
}

const STONE: [number, number, number] = [122, 122, 128];
const DIRT: [number, number, number] = [134, 96, 60];

function ore(color: [number, number, number], count = 5): BlockStyle {
  return { base: STONE, noise: 0.12, specks: { color, count } };
}

const STYLES: Partial<Record<BlockId, BlockStyle>> = {
  [BlockId.Stone]: { base: STONE, noise: 0.12 },
  [BlockId.Dirt]: { base: DIRT, noise: 0.14 },
  [BlockId.Grass]: { base: DIRT, top: { color: [92, 168, 73], rows: 4 }, noise: 0.14 },
  [BlockId.Bedrock]: { base: [58, 58, 62], noise: 0.25 },
  [BlockId.Sand]: { base: [218, 203, 152], noise: 0.08 },
  [BlockId.Sandstone]: { base: [206, 189, 136], top: { color: [214, 198, 146], rows: 3 }, noise: 0.06 },
  [BlockId.Gravel]: { base: [127, 124, 122], noise: 0.3 },
  [BlockId.Water]: { base: [58, 118, 196], noise: 0.05, alpha: 0.65 },
  [BlockId.OakLog]: { base: [104, 80, 48], noise: 0.1, stripe: true },
  [BlockId.OakLeaves]: { base: [64, 138, 52], noise: 0.22, holes: 0.16 },
  [BlockId.Snow]: { base: [238, 242, 248], noise: 0.04 },
  [BlockId.OakPlanks]: { base: [166, 130, 78], noise: 0.07, stripe: true },
  [BlockId.CraftingTable]: {
    base: [150, 116, 68],
    top: { color: [120, 92, 56], rows: 3 },
    noise: 0.1,
  },
  [BlockId.Cobblestone]: { base: [110, 110, 114], noise: 0.22 },
  [BlockId.Furnace]: {
    base: [98, 98, 102],
    top: { color: [72, 72, 76], rows: 3 },
    noise: 0.1,
    opening: true,
  },
  [BlockId.Glass]: { base: [205, 228, 238], noise: 0.03, alpha: 0.4, frame: [235, 244, 248] },
  [BlockId.CoalOre]: ore([44, 44, 46]),
  [BlockId.IronOre]: ore([215, 172, 140]),
  [BlockId.GoldOre]: ore([250, 212, 80]),
  [BlockId.LapisOre]: ore([42, 84, 184]),
  [BlockId.RedstoneOre]: ore([214, 48, 40]),
  [BlockId.DiamondOre]: ore([96, 219, 213], 4),
  [BlockId.EmeraldOre]: ore([48, 200, 94], 3),
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
  ctx.globalAlpha = style.alpha ?? 1;

  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      if (style.holes !== undefined && rand() < style.holes) continue;
      const inTop = style.top !== undefined && y < style.top.rows;
      let [r, g, b] = inTop ? style.top!.color : style.base;
      if (style.stripe && x % 4 < 2) {
        r *= 0.82;
        g *= 0.82;
        b *= 0.82;
      }
      const jitter = 1 - style.noise + rand() * style.noise * 2;
      ctx.fillStyle = `rgb(${Math.round(r * jitter)},${Math.round(g * jitter)},${Math.round(b * jitter)})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }

  if (style.specks) {
    const [r, g, b] = style.specks.color;
    for (let i = 0; i < style.specks.count; i++) {
      const sx = 1 + Math.floor(rand() * (TILE_PX - 3));
      const sy = 1 + Math.floor(rand() * (TILE_PX - 3));
      const jitter = 0.9 + rand() * 0.2;
      ctx.fillStyle = `rgb(${Math.round(r * jitter)},${Math.round(g * jitter)},${Math.round(b * jitter)})`;
      ctx.fillRect(sx, sy, 2, 2);
    }
  }

  if (style.opening) {
    ctx.fillStyle = "rgb(24,22,20)";
    ctx.fillRect(4, 9, 8, 5);
    ctx.fillStyle = "rgb(230,140,40)";
    ctx.fillRect(6, 12, 4, 2);
  }

  if (style.frame) {
    const [r, g, b] = style.frame;
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, TILE_PX, 1);
    ctx.fillRect(0, TILE_PX - 1, TILE_PX, 1);
    ctx.fillRect(0, 0, 1, TILE_PX);
    ctx.fillRect(TILE_PX - 1, 0, 1, TILE_PX);
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
