import { Texture } from "pixi.js";
import { BlockId, itemDef } from "@flatcraft/sim";
import { TILE_PX } from "./textures.js";

/**
 * Item icons. Block items reuse their block texture; everything else is
 * hand-drawn 8x8 pixel art (scaled x2), original basic-style graphics.
 */

interface Art {
  rows: string[];
  palette: Record<string, string>;
}

const STICK = "#6b4f2e";
const WOOD = "#8a6234";
const COBBLE = "#7a7a80";

const toolArts = (head: string): Record<string, Art> => ({
  pickaxe: {
    rows: [
      ".HHHHHH.",
      "H..S...H",
      "...S....",
      "...S....",
      "...S....",
      "...S....",
      "...S....",
      "........",
    ],
    palette: { H: head, S: STICK },
  },
  axe: {
    rows: [
      "..HHH...",
      "..HHS...",
      "...HS...",
      "....S...",
      "....S...",
      "....S...",
      "....S...",
      "........",
    ],
    palette: { H: head, S: STICK },
  },
  shovel: {
    rows: [
      "...HH...",
      "...HH...",
      "...HH...",
      "....S...",
      "....S...",
      "....S...",
      "....S...",
      "........",
    ],
    palette: { H: head, S: STICK },
  },
  sword: {
    rows: [
      "......H.",
      ".....H..",
      "....H...",
      "...H....",
      "..H.....",
      ".S......",
      "S.......",
      "........",
    ],
    palette: { H: head, S: STICK },
  },
});

const wooden = toolArts(WOOD);
const stone = toolArts(COBBLE);

const blob = (color: string): Art => ({
  rows: [
    "........",
    "..XXX...",
    ".XXXXX..",
    ".XXXXX..",
    "..XXXX..",
    "...XX...",
    "........",
    "........",
  ],
  palette: { X: color },
});

const gem = (color: string): Art => ({
  rows: [
    "........",
    "...X....",
    "..XXX...",
    ".XXXXX..",
    "..XXX...",
    "...X....",
    "........",
    "........",
  ],
  palette: { X: color },
});

const ARTS: Record<string, Art> = {
  stick: {
    rows: [
      "........",
      ".....S..",
      "....S...",
      "...S....",
      "..S.....",
      ".S......",
      "........",
      "........",
    ],
    palette: { S: STICK },
  },
  coal: blob("#2c2c2e"),
  lapis_lazuli: gem("#2a54b8"),
  redstone: blob("#d63028"),
  diamond: gem("#60dbd5"),
  emerald: gem("#30c85e"),
  wooden_pickaxe: wooden.pickaxe!,
  wooden_axe: wooden.axe!,
  wooden_shovel: wooden.shovel!,
  wooden_sword: wooden.sword!,
  stone_pickaxe: stone.pickaxe!,
  stone_axe: stone.axe!,
  stone_shovel: stone.shovel!,
  stone_sword: stone.sword!,
};

const cache = new Map<string, Texture>();

function artTexture(id: string, art: Art): Texture {
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

export function itemTexture(item: string, blockTextures: Map<BlockId, Texture>): Texture | undefined {
  const cached = cache.get(item);
  if (cached) return cached;
  const def = itemDef(item);
  let texture: Texture | undefined;
  if (def?.block !== undefined) {
    texture = blockTextures.get(def.block);
  } else {
    const art = ARTS[item];
    if (art) texture = artTexture(item, art);
  }
  if (texture) cache.set(item, texture);
  return texture;
}
