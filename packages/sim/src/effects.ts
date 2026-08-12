import type { ItemStack } from "./inventory.js";
import { itemDef } from "./items.js";

/**
 * Potion effects: tracked per player as remaining ticks. Speed multiplies
 * walking, regeneration heals over time, strength adds melee damage, and
 * the miner effect reveals ores through the fog of war (client-side).
 * Which item grants which effect comes from the item's datapack
 * "effect" component.
 */
export type EffectId = "speed" | "regeneration" | "strength" | "miner";

export const EFFECT_DURATION_TICKS = 1800; // 90 seconds
export const SPEED_MULTIPLIER = 1.5;
export const REGEN_EFFECT_INTERVAL = 40; // 1 HP per 2s
export const STRENGTH_BONUS = 3;

/** The effect id an item grants when used, if any. */
export function potionEffect(item: string): string | null {
  return itemDef(item)?.effect?.id ?? null;
}

/** Simplified enchanting: one enchantment per item, three levels. */
export const ENCHANT_MAX_LEVEL = 3;
export const ENCHANT_LAPIS_COST = 8;

/** The enchantment id a given item can receive (its datapack `enchants`
 * list; the first not-yet-maxed entry), or null. */
export function enchantFor(stack: ItemStack): string | null {
  const enchants = itemDef(stack.item)?.enchants;
  if (!enchants || enchants.length === 0) return null;
  for (const id of enchants) {
    if (enchantLevel(stack, id) < ENCHANT_MAX_LEVEL) return id;
  }
  return enchants[0] ?? null;
}

export function enchantLevel(stack: ItemStack | null, id: string): number {
  return stack?.ench?.find((e) => e.id === id)?.level ?? 0;
}
