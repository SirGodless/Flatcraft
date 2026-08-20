import { parseBiome, registerBiome, type BiomeJson } from "../../world/biome.js";

import desert from "./desert.json";
import plains from "./plains.json";
import forest from "./forest.json";
import mountains from "./mountains.json";

/**
 * To add a biome: drop a .json file next to this index (see
 * world/biome.ts for the format) and register it here. It's picked up
 * by noise_max automatically - no other wiring needed unless it needs
 * generation unlike anything an existing biome offers (in which case
 * that's a new dimension generator instead, see world/dimension.ts).
 */
const sources: Record<string, BiomeJson> = {
  "flatcraft:biome:desert": desert,
  "flatcraft:biome:plains": plains,
  "flatcraft:biome:forest": forest,
  "flatcraft:biome:mountains": mountains,
};

for (const [id, json] of Object.entries(sources)) {
  registerBiome(parseBiome(id, json));
}
