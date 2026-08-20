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
  "flatcraft:vein:obsidian": obsidian,
  "flatcraft:vein:clay": clay,
  "flatcraft:vein:gravel": gravel,
  "flatcraft:vein:coal_ore": coalOre,
  "flatcraft:vein:copper_ore": copperOre,
  "flatcraft:vein:iron_ore": ironOre,
  "flatcraft:vein:lapis_ore": lapisOre,
  "flatcraft:vein:gold_ore": goldOre,
  "flatcraft:vein:redstone_ore": redstoneOre,
  "flatcraft:vein:diamond_ore": diamondOre,
  "flatcraft:vein:emerald_ore": emeraldOre,
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
  "flatcraft:vein:obsidian",
  "flatcraft:vein:clay",
  "flatcraft:vein:gravel",
  "flatcraft:vein:coal_ore",
  "flatcraft:vein:copper_ore",
  "flatcraft:vein:iron_ore",
  "flatcraft:vein:lapis_ore",
  "flatcraft:vein:gold_ore",
  "flatcraft:vein:redstone_ore",
  "flatcraft:vein:diamond_ore",
];
