import { Texture } from "pixi.js";
import { BlockId, itemDef } from "@flatcraft/sim";
import { spriteKey, SPRITE_OVERRIDES } from "./sprites.js";
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
const iron = toolArts("#d8d8dc");
const golden = toolArts("#f5d442");
const diamond = toolArts("#5fd8d2");

const ingot = (color: string): Art => ({
  rows: [
    "........",
    "........",
    "..XXXX..",
    ".XXXXXX.",
    ".XXXXX..",
    "........",
    "........",
    "........",
  ],
  palette: { X: color },
});

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

const flask = (liquid: string): Art => ({
  rows: [
    "...CC...",
    "...CC...",
    "..GLLG..",
    ".GLLLLG.",
    ".GLLLLG.",
    ".GLLLLG.",
    "..GGGG..",
    "........",
  ],
  palette: { C: "#c8c8d0", G: "#dce8f0", L: liquid },
});

const ARTS: Record<string, Art> = {
  glass_bottle: flask("#e8f4fa"),
  potion_speed: flask("#58c2e8"),
  potion_regeneration: flask("#e85890"),
  potion_strength: flask("#c83030"),
  potion_miner: flask("#f0b040"),
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
  iron_pickaxe: iron.pickaxe!,
  iron_axe: iron.axe!,
  iron_shovel: iron.shovel!,
  iron_sword: iron.sword!,
  golden_pickaxe: golden.pickaxe!,
  golden_axe: golden.axe!,
  golden_shovel: golden.shovel!,
  golden_sword: golden.sword!,
  diamond_pickaxe: diamond.pickaxe!,
  diamond_axe: diamond.axe!,
  diamond_shovel: diamond.shovel!,
  diamond_sword: diamond.sword!,
  iron_ingot: ingot("#d8d8dc"),
  gold_ingot: ingot("#f5d442"),
  rotten_flesh: blob("#6b7d3a"),
  porkchop: blob("#e88a94"),
  bone: gem("#e8e8d8"),
  arrow: {
    rows: [
      "........",
      "......F.",
      ".....S..",
      "....S...",
      "...S....",
      "..S.....",
      ".H......",
      "........",
    ],
    palette: { S: "#8a6234", H: "#c8c8cc", F: "#e8e8e8" },
  },
  gunpowder: blob("#5a5a5e"),
  leather: blob("#8a5a30"),
  beef: blob("#b04040"),
  cooked_beef: blob("#7a4a2a"),
  cooked_porkchop: blob("#d8a878"),
  cooked_chicken: blob("#d8a050"),
  wool: blob("#ececec"),
  chicken: blob("#e8c890"),
  string: {
    rows: [
      "........",
      ".S......",
      "..S.....",
      "..S.....",
      "...S....",
      "....S...",
      ".....S..",
      "........",
    ],
    palette: { S: "#e8e8e0" },
  },
  bow: {
    rows: [
      "..WW....",
      ".W..W...",
      "W....W..",
      "S.....W.",
      "S.....W.",
      "W....W..",
      ".W..W...",
      "..WW....",
    ],
    palette: { W: "#8a6234", S: "#e8e8e0" },
  },
  feather: gem("#f0f0ec"),
  gold_nugget: gem("#f5d442"),
  elytra: {
    rows: [
      "........",
      "W......W",
      "WW....WW",
      "WWW..WWW",
      "WWW..WWW",
      ".WW..WW.",
      ".W....W.",
      "........",
    ],
    palette: { W: "#b8b8c8" },
  },
  flint: gem("#3c3c40"),
  backpack: {
    rows: [
      "........",
      ".BBBBBB.",
      "BBLLLLBB",
      "B.LBBL.B",
      "B.BBBB.B",
      "B.BBBB.B",
      ".BBBBBB.",
      "........",
    ],
    palette: { B: "#8a5a30", L: "#6b4522" },
  },
  glowstone_dust: blob("#f0cf5e"),
  flint_and_steel: {
    rows: [
      "........",
      ".SS.....",
      "S..S..Y.",
      "S....Y..",
      ".S..Y...",
      "..SS....",
      "........",
      "........",
    ],
    palette: { S: "#b0b0b8", Y: "#f5d442" },
  },
};

// Tier gear (hammers, armor, shields, grappling hooks) share silhouettes
// with per-tier head colors.
const TIER_COLORS: Record<string, string> = {
  wooden: WOOD,
  stone: COBBLE,
  copper: "#d87a4e",
  iron: "#d8d8dc",
  golden: "#f5d442",
  diamond: "#5fd8d2",
  emerald: "#30c85e",
  netherite: "#4a4048",
  leather: "#8a5a30",
};

const hammer = (head: string): Art => ({
  rows: [
    ".HHHHH..",
    ".HHHHH..",
    ".HHHHH..",
    "....S...",
    "....S...",
    "....S...",
    "....S...",
    "........",
  ],
  palette: { H: head, S: STICK },
});

const armorArt = (color: string): Art => ({
  rows: [
    "XX....XX",
    "XXXXXXXX",
    "XXXXXXXX",
    ".XXXXXX.",
    ".XXXXXX.",
    ".XXXXXX.",
    "........",
    "........",
  ],
  palette: { X: color },
});

const shieldArt = (color: string): Art => ({
  rows: [
    ".XXXXXX.",
    ".XXXXXX.",
    ".XXXXXX.",
    ".XXXXXX.",
    "..XXXX..",
    "...XX...",
    "........",
    "........",
  ],
  palette: { X: color },
});

const hookArt = (color: string): Art => ({
  rows: [
    "......S.",
    "......S.",
    "......S.",
    "..HHH.S.",
    ".H...HS.",
    ".H....H.",
    "..HH.H..",
    "........",
  ],
  palette: { H: color, S: "#e8e8e0" },
});

for (const [tier, color] of Object.entries(TIER_COLORS)) {
  if (tier !== "leather") {
    ARTS[`${tier}_hammer`] = hammer(color);
    ARTS[`${tier}_shield`] = shieldArt(color);
    ARTS[`${tier}_grappling_hook`] = hookArt(color);
  }
  ARTS[`${tier}_armor`] = armorArt(color);
}

const bucketArt = (color: string): Art => ({
  rows: [
    "..HHHH..",
    ".H....H.",
    ".H....H.",
    ".H....H.",
    "..H..H..",
    "..HHHH..",
    "........",
    "........",
  ],
  palette: { H: color },
});

// Buckets: clay through netherite, matching the datapack's bucket tiers
// (no wooden/stone bucket exists).
const BUCKET_TIER_COLORS: Record<string, string> = {
  clay: "#c17a4a",
  copper: TIER_COLORS["copper"]!,
  iron: TIER_COLORS["iron"]!,
  golden: TIER_COLORS["golden"]!,
  diamond: TIER_COLORS["diamond"]!,
  emerald: TIER_COLORS["emerald"]!,
  netherite: TIER_COLORS["netherite"]!,
};
for (const [tier, color] of Object.entries(BUCKET_TIER_COLORS)) {
  ARTS[`${tier}_bucket`] = bucketArt(color);
}
ARTS["copper_ingot"] = ingot("#d87a4e");
ARTS["netherite_ingot"] = ingot("#4a4048");
ARTS["netherite_scrap"] = blob("#5a4a44");
ARTS["copper_ore"] = blob("#d87a4e");

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
  // Sprite files beat everything (datapack override or convention path).
  let texture: Texture | undefined =
    SPRITE_OVERRIDES.get(spriteKey(def?.sprite) ?? `item/${item}`);
  if (!texture) {
    if (def?.block !== undefined) {
      texture = blockTextures.get(def.block);
    } else {
      const art = ARTS[item];
      if (art) texture = artTexture(item, art);
    }
  }
  if (texture) cache.set(item, texture);
  return texture;
}
