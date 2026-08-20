import { parseWood, registerWood, type WoodJson } from "../../world/wood.js";

import oak from "./oak.json";
import birch from "./birch.json";
import spruce from "./spruce.json";

/**
 * To add a wood type: drop a .json file next to this index (see
 * world/wood.ts for the format) and register it here, then reference
 * its id from a biome's tree_woods list (data/biomes/*.json).
 */
const sources: Record<string, WoodJson> = {
  "flatcraft:wood:oak": oak,
  "flatcraft:wood:birch": birch,
  "flatcraft:wood:spruce": spruce,
};

for (const [id, json] of Object.entries(sources)) {
  registerWood(parseWood(id, json));
}
