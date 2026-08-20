import { parseEnchant, registerEnchant, type EnchantJson } from "../../enchants.js";

import sharpness from "./sharpness.json";
import efficiency from "./efficiency.json";

/**
 * To add an enchant: drop a .json file next to this index (see
 * enchants.ts for the format) and register it here, then reference its
 * id from any item's "enchants" list.
 */
const sources: Record<string, EnchantJson> = {
  sharpness,
  efficiency,
};

for (const [id, json] of Object.entries(sources)) {
  registerEnchant(parseEnchant(id, json));
}
