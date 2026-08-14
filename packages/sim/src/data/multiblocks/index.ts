import { parseMultiblock, registerMultiblock, type MultiblockJson } from "../../multiblock.js";

import netherPortal from "./nether_portal.json";

/**
 * To add a multiblock: drop a .json file next to this index (see
 * multiblock.ts for the format) and register it here, plus a matching
 * registerMultiblockHandler(id, ...) call somewhere (portal.ts for this
 * one) implementing what "handler" actually does.
 */
const sources: Record<string, MultiblockJson> = {
  nether_portal: netherPortal,
};

for (const [id, json] of Object.entries(sources)) {
  registerMultiblock(parseMultiblock(id, json));
}
