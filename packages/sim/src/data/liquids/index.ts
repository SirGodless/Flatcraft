import { parseLiquid, registerLiquid, type LiquidJson } from "../../liquids.js";

import water from "./water.json";
import lava from "./lava.json";

/**
 * To add a liquid's tuning: drop a .json file next to this index (see
 * liquids.ts for the format) and register it here. Note this only
 * covers swim physics/bucket-melt/tint - see liquids.ts's doc comment
 * for why that's not the same as a mod being able to add a new liquid
 * outright.
 */
const sources: Record<string, LiquidJson> = {
  "flatcraft:liquid:water": water,
  "flatcraft:liquid:lava": lava,
};

for (const [id, json] of Object.entries(sources)) {
  registerLiquid(parseLiquid(id, json));
}
