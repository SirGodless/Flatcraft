import { parseNetherLayer, registerNetherLayer, type NetherLayerJson } from "../../world/netherLayer.js";

import glowstone from "./glowstone.json";
import soulSand from "./soul_sand.json";
import basalt from "./basalt.json";
import ancientDebris from "./ancient_debris.json";

/**
 * To add a nether material layer: drop a .json file next to this index
 * (see world/netherLayer.ts for the format) and register it here.
 * Registration order is placement priority (first match wins), matching
 * the original hardcoded if/else-if chain's order exactly - do not
 * reorder the existing four without checking whether that matters for
 * existing worlds' generated terrain.
 */
const layers: Array<[string, NetherLayerJson]> = [
  ["flatcraft:nether_layer:glowstone", glowstone],
  ["flatcraft:nether_layer:soul_sand", soulSand],
  ["flatcraft:nether_layer:basalt", basalt],
  ["flatcraft:nether_layer:ancient_debris", ancientDebris],
];

for (const [id, json] of layers) {
  registerNetherLayer(parseNetherLayer(id, json));
}
