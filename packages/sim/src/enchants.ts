import type { ItemStack } from "./inventory.js";
import { registerContentType, validateContentInstance } from "./registry/generic.js";

/**
 * Enchantment effects: what an enchant id (referenced from an item's
 * "enchants" list, see items.ts) actually does, as data rather than a
 * string-gated special case in combat.ts/mining.ts. Same registry
 * pattern as veins/woods - a JSON file per enchant, registered by id.
 *
 * Validation itself runs through the generic content-type engine
 * (registry/generic.ts) rather than hand-rolled if-checks - this is the
 * first type migrated onto it for real (see genericContent.test.ts for
 * the pilot that proved the design). EnchantJson/EnchantDef stay as
 * hand-written TS types purely for ergonomics elsewhere in the engine
 * (enchantBonus() below reads def.effect/def.perLevel with real
 * autocomplete/type-checking) - they're a convenience layer over the
 * generic engine's validated output, not a second validation path.
 */

export type EnchantEffect = "damage_bonus" | "mining_speed";

export interface EnchantJson {
  id: string;
  effect: string;
  per_level: number;
}

export interface EnchantDef {
  id: string;
  effect: EnchantEffect;
  perLevel: number;
}

registerContentType(
  {
    id: "enchant",
    fields: {
      id: { kind: "id", required: true },
      effect: { kind: "enum", values: ["damage_bonus", "mining_speed"], required: true },
      per_level: { kind: "number", min: -1000, max: 1000, required: true },
    },
  },
  "engine/types/enchant",
);

export function parseEnchant(id: string, json: EnchantJson): EnchantDef {
  const validated = validateContentInstance("enchant", json, `enchant "${id}"`);
  return { id, effect: validated["effect"] as EnchantEffect, perLevel: validated["per_level"] as number };
}

const DEFS = new Map<string, EnchantDef>();

export function registerEnchant(def: EnchantDef): void {
  if (DEFS.has(def.id)) {
    throw new Error(`enchant "${def.id}" is already registered`);
  }
  DEFS.set(def.id, def);
}

export function enchantDef(id: string): EnchantDef | undefined {
  return DEFS.get(id);
}

export function allEnchantIds(): readonly string[] {
  return [...DEFS.keys()];
}

/** Total bonus a stack's enchantments contribute for one effect (e.g.
 * "how much extra attack damage", "how much extra mining speed") -
 * summed rather than assuming a single enchant, so a future stack with
 * more than one active enchantment already works. */
export function enchantBonus(stack: ItemStack | null, effect: EnchantEffect): number {
  if (!stack?.ench) return 0;
  let total = 0;
  for (const e of stack.ench) {
    const def = DEFS.get(e.id);
    if (def?.effect === effect) total += def.perLevel * e.level;
  }
  return total;
}

/** Every item's "enchants" list must reference registered enchant ids -
 * takes the item defs as a parameter (rather than importing items.ts)
 * to avoid coupling this registry to that one; called from validate.ts
 * with allItems(). Same exhaustive-collect-all pattern as
 * validateSpawnGenerators. */
export function validateItemEnchants(items: Iterable<{ id: string; enchants?: readonly string[] | undefined }>): string[] {
  const problems: string[] = [];
  for (const item of items) {
    for (const id of item.enchants ?? []) {
      if (!DEFS.has(id)) {
        problems.push(`item "${item.id}" references unknown enchant "${id}"`);
      }
    }
  }
  return problems;
}
