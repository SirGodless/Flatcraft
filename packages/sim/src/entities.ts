import type { ItemStack } from "./inventory.js";

/**
 * Non-player entities: items lying in the world and mobs. Plain
 * serializable data; all behavior lives in the simulation's tick.
 */
export type EntityId = number;

export type MobKind = "zombie" | "pig";

interface EntityBase {
  id: EntityId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  onGround: boolean;
}

export interface ItemEntity extends EntityBase {
  kind: "item";
  stack: ItemStack;
  /** Ticks since spawn; despawns at ITEM_DESPAWN_TICKS. */
  age: number;
  /** Ticks until it may be picked up. */
  pickupDelay: number;
}

export interface MobEntity extends EntityBase {
  kind: MobKind;
  health: number;
  /** Invulnerability frames after taking a hit. */
  hurtCooldown: number;
  /** Zombies: ticks until the next contact attack. */
  attackCooldown: number;
  /** Pigs: current wander direction and ticks until it changes. */
  wanderDir: -1 | 0 | 1;
  wanderTimer: number;
}

export type Entity = ItemEntity | MobEntity;

export interface EntitySize {
  width: number;
  height: number;
}

export const ENTITY_SIZES: Readonly<Record<Entity["kind"], EntitySize>> = {
  item: { width: 0.25, height: 0.25 },
  zombie: { width: 0.6, height: 1.8 },
  pig: { width: 0.9, height: 0.9 },
};

export const ITEM_DESPAWN_TICKS = 6000; // 5 minutes
export const ITEM_PICKUP_DELAY = 10;
/** Distance from the player's AABB within which items are collected. */
export const ITEM_PICKUP_RADIUS = 1.25;

export const MOB_STATS: Readonly<Record<MobKind, { health: number; speed: number }>> = {
  zombie: { health: 20, speed: 0.1 },
  pig: { health: 10, speed: 0.06 },
};

export const ZOMBIE_DAMAGE = 3;
export const ZOMBIE_ATTACK_COOLDOWN = 20;
export const ZOMBIE_FOLLOW_RANGE = 16;
export const MOB_DESPAWN_RANGE = 72;
export const MOB_CAP = 10;
export const ATTACK_REACH = 4;
