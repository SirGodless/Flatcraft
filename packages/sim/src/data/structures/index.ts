import { parseStructure, type Structure, type StructureJson } from "../../structures/structure.js";

import dungeon from "./dungeon.json";
import house from "./house.json";
import netherRuin from "./nether_ruin.json";
import well from "./well.json";

/**
 * To add a structure: drop a .json file next to this index (see
 * structures/structure.ts for the format) and register it here.
 */
const sources: Record<string, StructureJson> = {
  dungeon: dungeon,
  well: well,
  house: house,
  nether_ruin: netherRuin,
};

export const STRUCTURES: readonly Structure[] = Object.entries(sources).map(([id, json]) =>
  parseStructure(id, json),
);
