import { parseDimension, registerDimension, type DimensionJson } from "../../world/dimension.js";

import overworld from "./overworld.json";
import nether from "./nether.json";

/**
 * To add a dimension: drop a .json file next to this index (see
 * world/dimension.ts for the format) and register it here, plus a
 * matching registerDimensionGenerator(id, ...) call somewhere
 * (world/gen.ts and world/nether.ts for these two) implementing what
 * "generator" actually produces.
 */
const sources: Record<string, DimensionJson> = {
  overworld,
  nether,
};

for (const [id, json] of Object.entries(sources)) {
  registerDimension(parseDimension(id, json));
}
