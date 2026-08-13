import { Texture } from "pixi.js";
import { allBlocks, BlockId } from "@flatcraft/sim";
import { SPRITE_OVERRIDES } from "./sprites.js";

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
  /** Draw only the bottom N pixel rows (slabs, partial liquids). */
  fillRows?: number;
  /** Partial-tile silhouettes (stairs, fences, opened doors). */
  shape?: "stairs" | "fence" | "doorOpen" | "trapdoorOpen";
}

function shapeMask(shape: NonNullable<BlockStyle["shape"]>, x: number, y: number): boolean {
  switch (shape) {
    case "stairs": {
      // Steps descending to the left, 4px each.
      const step = Math.floor(x / 4);
      return y >= TILE_PX - (step + 1) * 4;
    }
    case "fence":
      return (x >= 2 && x <= 4) || (x >= 11 && x <= 13) || y === 4 || y === 5 || y === 10 || y === 11;
    case "doorOpen":
      return x <= 3; // swung against the left edge
    case "trapdoorOpen":
      return x >= TILE_PX - 4; // folded against the right edge
  }
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
  [BlockId.Clay]: { base: [156, 160, 172], noise: 0.06 },
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
  [BlockId.Netherrack]: { base: [122, 48, 48], noise: 0.2 },
  [BlockId.SoulSand]: { base: [90, 70, 54], noise: 0.18, specks: { color: [40, 30, 24], count: 4 } },
  [BlockId.Glowstone]: { base: [244, 208, 96], noise: 0.15, specks: { color: [255, 240, 180], count: 6 } },
  [BlockId.Obsidian]: { base: [26, 16, 38], noise: 0.15, specks: { color: [80, 50, 120], count: 3 } },
  [BlockId.NetherPortal]: { base: [138, 48, 200], noise: 0.25, alpha: 0.75 },
  [BlockId.Lava]: { base: [224, 80, 16], noise: 0.2, specks: { color: [255, 200, 60], count: 5 } },
  [BlockId.Basalt]: { base: [74, 74, 82], noise: 0.08, stripe: true },
  [BlockId.BrewingStand]: {
    base: [96, 96, 100],
    top: { color: [74, 74, 82], rows: 6 },
    noise: 0.1,
    specks: { color: [230, 140, 40], count: 3 },
  },
  [BlockId.EnchantingTable]: {
    base: [40, 30, 60],
    top: { color: [180, 60, 80], rows: 3 },
    noise: 0.12,
    specks: { color: [120, 200, 255], count: 4 },
  },
  [BlockId.Chest]: {
    base: [158, 110, 54],
    top: { color: [130, 90, 44], rows: 5 },
    noise: 0.08,
    frame: [96, 66, 32],
  },
  [BlockId.CoalOre]: ore([44, 44, 46]),
  [BlockId.IronOre]: ore([215, 172, 140]),
  [BlockId.GoldOre]: ore([250, 212, 80]),
  [BlockId.LapisOre]: ore([42, 84, 184]),
  [BlockId.RedstoneOre]: ore([214, 48, 40]),
  [BlockId.DiamondOre]: ore([96, 219, 213], 4),
  [BlockId.EmeraldOre]: ore([48, 200, 94], 3),
  [BlockId.CopperOre]: ore([214, 122, 78]),
  [BlockId.AncientDebris]: { base: [72, 50, 42], noise: 0.16, specks: { color: [182, 124, 92], count: 4 } },
  [BlockId.PortalFrame]: { base: [30, 20, 46], noise: 0.15, specks: { color: [150, 92, 220], count: 4 } },
  [BlockId.BirchLog]: { base: [204, 202, 190], noise: 0.1, stripe: true },
  [BlockId.BirchLeaves]: { base: [96, 152, 72], noise: 0.22, holes: 0.16 },
  [BlockId.BirchPlanks]: { base: [198, 180, 130], noise: 0.07, stripe: true },
  [BlockId.SpruceLog]: { base: [70, 52, 32], noise: 0.1, stripe: true },
  [BlockId.SpruceLeaves]: { base: [40, 88, 50], noise: 0.22, holes: 0.16 },
  [BlockId.SprucePlanks]: { base: [116, 86, 50], noise: 0.07, stripe: true },
};

// Wood building sets share their planks' color with distinctive shapes.
const WOOD_SET_STYLES: Array<{
  planks: [number, number, number];
  ids: { stairs: BlockId; slab: BlockId; fence: BlockId; door: BlockId; doorOpen: BlockId; trapdoor: BlockId; trapdoorOpen: BlockId };
}> = [
  {
    planks: [166, 130, 78],
    ids: { stairs: BlockId.OakStairs, slab: BlockId.OakSlab, fence: BlockId.OakFence, door: BlockId.OakDoor, doorOpen: BlockId.OakDoorOpen, trapdoor: BlockId.OakTrapdoor, trapdoorOpen: BlockId.OakTrapdoorOpen },
  },
  {
    planks: [198, 180, 130],
    ids: { stairs: BlockId.BirchStairs, slab: BlockId.BirchSlab, fence: BlockId.BirchFence, door: BlockId.BirchDoor, doorOpen: BlockId.BirchDoorOpen, trapdoor: BlockId.BirchTrapdoor, trapdoorOpen: BlockId.BirchTrapdoorOpen },
  },
  {
    planks: [116, 86, 50],
    ids: { stairs: BlockId.SpruceStairs, slab: BlockId.SpruceSlab, fence: BlockId.SpruceFence, door: BlockId.SpruceDoor, doorOpen: BlockId.SpruceDoorOpen, trapdoor: BlockId.SpruceTrapdoor, trapdoorOpen: BlockId.SpruceTrapdoorOpen },
  },
];
for (const { planks, ids } of WOOD_SET_STYLES) {
  STYLES[ids.stairs] = { base: planks, noise: 0.07, shape: "stairs" };
  STYLES[ids.slab] = { base: planks, noise: 0.07, fillRows: 8 };
  STYLES[ids.fence] = { base: planks, noise: 0.07, shape: "fence" };
  STYLES[ids.door] = { base: planks, noise: 0.07, stripe: true, frame: [planks[0] * 0.6, planks[1] * 0.6, planks[2] * 0.6] as [number, number, number] };
  STYLES[ids.doorOpen] = { base: planks, noise: 0.07, shape: "doorOpen" };
  STYLES[ids.trapdoor] = { base: planks, noise: 0.07, frame: [planks[0] * 0.6, planks[1] * 0.6, planks[2] * 0.6] as [number, number, number] };
  STYLES[ids.trapdoorOpen] = { base: planks, noise: 0.07, shape: "trapdoorOpen" };
}

// Partial liquid levels: the same look, filled from the bottom.
for (let level = 1; level <= 7; level++) {
  STYLES[(BlockId.Water1 + level - 1) as BlockId] = {
    base: [58, 118, 196],
    noise: 0.05,
    alpha: 0.65,
    fillRows: level * 2,
  };
  STYLES[(BlockId.Lava1 + level - 1) as BlockId] = {
    base: [224, 80, 16],
    noise: 0.2,
    fillRows: level * 2,
  };
}

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
      if (style.fillRows !== undefined && y < TILE_PX - style.fillRows) continue;
      if (style.shape !== undefined && !shapeMask(style.shape, x, y)) continue;
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
  // Sprite files beat procedural styles; blocks without either (e.g.
  // datapack blocks from a server mod) get a generic texture colored
  // from their name, so nothing ever renders invisible.
  for (const def of allBlocks()) {
    if (def.id === BlockId.Air) continue;
    const key = def.sprite
      ? def.sprite.replace(/^sprites\//, "").replace(/\.[a-z0-9]+$/i, "")
      : `block/${def.name}`;
    const sprite = SPRITE_OVERRIDES.get(key);
    if (sprite) {
      textures.set(def.id, sprite);
    } else if (!textures.has(def.id)) {
      let hash = 0;
      for (const ch of def.name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
      const base: [number, number, number] = [80 + (hash % 120), 80 + ((hash >> 7) % 120), 80 + ((hash >> 14) % 120)];
      textures.set(def.id, makeBlockTexture(def.id, { base, noise: 0.12 }));
    }
  }
  return textures;
}
