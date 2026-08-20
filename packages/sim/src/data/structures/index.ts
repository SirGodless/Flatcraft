import { parseStructure, type Structure, type StructureJson } from "../../structures/structure.js";
import { allDimensionIds } from "../../world/dimension.js";

import dungeon from "./dungeon.json";
import house from "./house.json";
import netherRuin from "./nether_ruin.json";
import well from "./well.json";

/**
 * To add a structure: drop a .json file next to this index (see
 * structures/structure.ts for the format) and register it here.
 */
const sources: Record<string, StructureJson> = {
  "flatcraft:structure:dungeon": dungeon,
  "flatcraft:structure:well": well,
  "flatcraft:structure:house": house,
  "flatcraft:structure:nether_ruin": netherRuin,
};

export const STRUCTURES: readonly Structure[] = Object.entries(sources).map(([id, json]) =>
  parseStructure(id, json),
);

/** Every structure's `dimension` must name an actually registered
 * dimension - checked here rather than at parse time (see
 * parseStructure), since data/dimensions/index.ts isn't guaranteed to
 * have run yet at the point any one content file gets parsed. Feeds
 * into validateAllContent, same exhaustive-collect-all pattern as
 * validateMultiblockHandlers. */
export function validateStructureDimensions(): string[] {
  const known = new Set(allDimensionIds());
  return STRUCTURES.filter((s) => !known.has(s.dimension)).map(
    (s) => `structure "${s.id}" references unknown dimension "${s.dimension}"`,
  );
}
