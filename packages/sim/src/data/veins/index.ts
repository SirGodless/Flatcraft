import { parseVein, registerVein, type VeinJson } from "../../world/vein.js";

import obsidian from "./obsidian.json";
import clay from "./clay.json";
import gravel from "./gravel.json";
import coalOre from "./coal_ore.json";
import copperOre from "./copper_ore.json";
import ironOre from "./iron_ore.json";
import lapisOre from "./lapis_ore.json";
import goldOre from "./gold_ore.json";
import redstoneOre from "./redstone_ore.json";
import diamondOre from "./diamond_ore.json";
import emeraldOre from "./emerald_ore.json";

/**
 * To add a vein: drop a .json file next to this index (see world/vein.ts
 * for the format) and register it here. List its id in GLOBAL_VEIN_IDS
 * to place it in every chunk regardless of biome, or leave it out and
 * reference the id from a specific biome's extra_veins instead (see
 * data/biomes/mountains.json's emerald_ore).
 */
const sources: Record<string, VeinJson> = {
  obsidian,
  clay,
  gravel,
  coal_ore: coalOre,
  copper_ore: copperOre,
  iron_ore: ironOre,
  lapis_ore: lapisOre,
  gold_ore: goldOre,
  redstone_ore: redstoneOre,
  diamond_ore: diamondOre,
  emerald_ore: emeraldOre,
};

for (const [id, json] of Object.entries(sources)) {
  registerVein(parseVein(id, json));
}

/** Veins placed in every chunk, in placement order - this order is part
 * of world generation determinism (each vein's placement consumes a
 * fixed slice of the per-chunk rng stream, see world/gen.ts placeOres),
 * so it must stay exactly this order for existing worlds to keep
 * generating identically. */
export const GLOBAL_VEIN_IDS: readonly string[] = [
  "obsidian",
  "clay",
  "gravel",
  "coal_ore",
  "copper_ore",
  "iron_ore",
  "lapis_ore",
  "gold_ore",
  "redstone_ore",
  "diamond_ore",
];
