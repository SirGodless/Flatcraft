import { enchantBonus } from "./enchants.js";
import type { ItemStack } from "./inventory.js";
import { itemDef } from "./items.js";

/** Attack damage by held item: the weapon component (hand = 1) plus any
 * damage_bonus enchantment (e.g. sharpness). */
export function attackDamage(held: ItemStack | null): number {
  const weapon = held ? itemDef(held.item)?.weapon : undefined;
  return (weapon?.damage ?? 1) + enchantBonus(held, "damage_bonus");
}

/** Knockback impulse of the held item (bare hand default). */
export function attackKnockback(held: ItemStack | null): number {
  const weapon = held ? itemDef(held.item)?.weapon : undefined;
  return weapon?.knockback ?? 0.3;
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
