import type { ItemStack } from "./inventory.js";

/**
 * Enchantment effects: what an enchant id (referenced from an item's
 * "enchants" list, see items.ts) actually does, as data rather than a
 * string-gated special case in combat.ts/mining.ts. Same registry
 * pattern as veins/woods - a JSON file per enchant, registered by id.
 */

export type EnchantEffect = "damage_bonus" | "mining_speed";

export interface EnchantJson {
  id: string;
  /** Not typed as the literal union here - imported JSON modules widen
   * string literals to `string`, so the union only exists on the parsed
   * EnchantDef, checked at runtime in parseEnchant. */
  effect: string;
  per_level: number;
}

export interface EnchantDef {
  id: string;
  effect: EnchantEffect;
  perLevel: number;
}

export function parseEnchant(id: string, json: EnchantJson): EnchantDef {
  if (json.effect !== "damage_bonus" && json.effect !== "mining_speed") {
    throw new Error(`enchant "${id}": effect must be "damage_bonus" or "mining_speed"`);
  }
  if (typeof json.per_level !== "number") {
    throw new Error(`enchant "${id}": "per_level" is required`);
  }
  return { id, effect: json.effect, perLevel: json.per_level };
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
