import type { ItemStack } from "./inventory.js";
import { itemDef } from "./items.js";

/**
 * Potion effects: tracked per player as remaining ticks. Speed multiplies
 * walking, regeneration heals over time, strength adds melee damage, and
 * the miner effect reveals ores through the fog of war (client-side).
 */
export type EffectId = "speed" | "regeneration" | "strength" | "miner";

export const EFFECT_DURATION_TICKS = 1800; // 90 seconds
export const SPEED_MULTIPLIER = 1.5;
export const REGEN_EFFECT_INTERVAL = 40; // 1 HP per 2s
export const STRENGTH_BONUS = 3;

/** The effect a potion item grants, if it is one. */
export function potionEffect(item: string): EffectId | null {
  if (!item.startsWith("potion_")) return null;
  const effect = item.slice("potion_".length);
  return effect === "speed" || effect === "regeneration" || effect === "strength" || effect === "miner"
    ? effect
    : null;
}

/** Simplified enchanting: one enchantment per tool kind, three levels. */
export const ENCHANT_MAX_LEVEL = 3;
export const ENCHANT_LAPIS_COST = 8;

/** The enchantment id a given item can receive, or null. */
export function enchantFor(stack: ItemStack): string | null {
  const tool = itemDef(stack.item)?.tool;
  if (!tool) return null;
  return tool.kind === "sword" ? "sharpness" : "efficiency";
}

export function enchantLevel(stack: ItemStack | null, id: string): number {
  return stack?.ench?.find((e) => e.id === id)?.level ?? 0;
}
