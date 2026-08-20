import { parseMultiblock, registerMultiblock, type MultiblockJson } from "../../multiblock.js";

import netherPortal from "./nether_portal.json";

/**
 * To add a multiblock: drop a .json file next to this index (see
 * multiblock.ts for the format) and register it here, plus a matching
 * registerMultiblockHandler(id, ...) call somewhere (portal.ts for this
 * one) implementing what "handler" actually does. The key here becomes
 * the def's id - keep it namespaced (see multiblock.ts's doc comment),
 * built-in content uses "flatcraft:".
 */
const sources: Record<string, MultiblockJson> = {
  "flatcraft:multiblock:nether_portal": netherPortal,
};

for (const [id, json] of Object.entries(sources)) {
  registerMultiblock(parseMultiblock(id, json));
}
