import { enchantLevel } from "./effects.js";
import type { ItemStack } from "./inventory.js";
import { itemDef } from "./items.js";

/** Attack damage by held item, Minecraft-flavored (hand = 1). */
export function attackDamage(held: ItemStack | null): number {
  const tool = held ? itemDef(held.item)?.tool : undefined;
  // Sharpness: +2 damage per level.
  const sharpness = held ? 2 * enchantLevel(held, "sharpness") : 0;
  if (!tool) return 1;
  if (tool.kind === "sword") {
    const byTier: Record<number, number> = { 1: 4, 2: 5, 3: 6, 4: 7 };
    return (byTier[tool.tier] ?? 4) + sharpness;
  }
  return 2 + sharpness;
}

export const PLAYER_MAX_HEALTH = 20;
/** Invulnerability frames after any hit. */
export const HURT_COOLDOWN_TICKS = 10;
/** Minimum ticks between a player's attacks. */
export const PLAYER_ATTACK_COOLDOWN = 8;
/** Passive regeneration: 1 HP per this many ticks (no food system yet). */
export const REGEN_INTERVAL_TICKS = 80;
/** Falling further than this many tiles hurts, 1 HP per extra tile. */
export const SAFE_FALL_TILES = 3;
