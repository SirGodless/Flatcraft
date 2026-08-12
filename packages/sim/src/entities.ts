import type { ItemStack } from "./inventory.js";
import type { Dimension } from "./world/world.js";

/**
 * Non-player entities: items lying in the world and mobs. Plain
 * serializable data; all behavior lives in the simulation's tick.
 */
export type EntityId = number;

export type MobKind =
  | "zombie"
  | "skeleton"
  | "creeper"
  | "zombified_piglin"
  | "pig"
  | "cow"
  | "sheep"
  | "chicken"
  | "villager";

/** Mobs that walk toward players and hit on contact. */
export const MELEE_MOBS: readonly MobKind[] = ["zombie", "zombified_piglin"];
/** Animals that wander idly and spawn on grass in daylight. */
export const PASSIVE_MOBS: readonly MobKind[] = ["pig", "cow", "sheep", "chicken"];
/** All idle wanderers (villagers spawn at houses, not on grass). */
export const WANDERING_MOBS: readonly MobKind[] = [...PASSIVE_MOBS, "villager"];
/** Mobs that burn in daylight. */
export const BURNING_MOBS: readonly MobKind[] = ["zombie", "skeleton"];

interface EntityBase {
  id: EntityId;
  dimension: Dimension;
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
  /** Melee: ticks until the next contact attack; ranged: until next shot. */
  attackCooldown: number;
  /** Passive mobs: current wander direction and ticks until it changes. */
  wanderDir: -1 | 0 | 1;
  wanderTimer: number;
  /** Creepers: remaining fuse ticks; -1 = not ignited. */
  fuse?: number;
}

export interface ArrowEntity extends EntityBase {
  kind: "arrow";
  damage: number;
  /** Remaining lifetime in ticks. */
  ttl: number;
  /** Set for player-shot arrows: they hit mobs instead of players. */
  owner?: number;
}

export type Entity = ItemEntity | MobEntity | ArrowEntity;

export interface EntitySize {
  width: number;
  height: number;
}

export const ENTITY_SIZES: Readonly<Record<Entity["kind"], EntitySize>> = {
  item: { width: 0.25, height: 0.25 },
  zombie: { width: 0.6, height: 1.8 },
  skeleton: { width: 0.6, height: 1.8 },
  creeper: { width: 0.6, height: 1.5 },
  zombified_piglin: { width: 0.6, height: 1.8 },
  pig: { width: 0.9, height: 0.9 },
  cow: { width: 0.9, height: 1.2 },
  sheep: { width: 0.9, height: 1.1 },
  chicken: { width: 0.5, height: 0.6 },
  villager: { width: 0.6, height: 1.9 },
  arrow: { width: 0.3, height: 0.15 },
};

export const ITEM_DESPAWN_TICKS = 6000; // 5 minutes
export const ITEM_PICKUP_DELAY = 10;
/** Distance from the player's AABB within which items are collected. */
export const ITEM_PICKUP_RADIUS = 1.25;

export const MOB_STATS: Readonly<Record<MobKind, { health: number; speed: number }>> = {
  zombie: { health: 20, speed: 0.1 },
  skeleton: { health: 20, speed: 0.09 },
  creeper: { health: 20, speed: 0.09 },
  zombified_piglin: { health: 20, speed: 0.1 },
  pig: { health: 10, speed: 0.06 },
  cow: { health: 10, speed: 0.05 },
  sheep: { health: 8, speed: 0.05 },
  chicken: { health: 4, speed: 0.05 },
  villager: { health: 20, speed: 0.05 },
};

/** Death drops: item, max count (1..max rolled), chance. */
export const MOB_LOOT: Readonly<Record<MobKind, ReadonlyArray<{ item: string; max: number; chance: number }>>> = {
  zombie: [{ item: "rotten_flesh", max: 2, chance: 0.8 }],
  skeleton: [
    { item: "bone", max: 2, chance: 0.9 },
    { item: "arrow", max: 2, chance: 0.6 },
  ],
  creeper: [{ item: "gunpowder", max: 2, chance: 0.9 }],
  zombified_piglin: [
    { item: "gold_nugget", max: 2, chance: 0.6 },
    { item: "rotten_flesh", max: 1, chance: 0.5 },
  ],
  pig: [{ item: "porkchop", max: 2, chance: 1 }],
  cow: [
    { item: "leather", max: 2, chance: 0.9 },
    { item: "beef", max: 3, chance: 1 },
  ],
  sheep: [{ item: "wool", max: 2, chance: 1 }],
  chicken: [
    { item: "chicken", max: 1, chance: 1 },
    { item: "feather", max: 2, chance: 0.7 },
  ],
  villager: [],
};

export const SKELETON_RANGE = 12;
export const SKELETON_SHOOT_COOLDOWN = 50;
export const ARROW_DAMAGE = 3;
export const ARROW_TTL = 100;
/** Player bow: stronger than skeleton arrows, with its own fire rate. */
export const BOW_DAMAGE = 6;
export const BOW_COOLDOWN = 20;
export const BOW_ARROW_SPEED = 0.8;
export const CREEPER_FUSE = 30;
export const CREEPER_TRIGGER_RANGE = 1.8;
export const EXPLOSION_BLOCK_RADIUS = 2.5;
export const EXPLOSION_DAMAGE_RADIUS = 4;
export const EXPLOSION_MAX_DAMAGE = 18;

export const ZOMBIE_DAMAGE = 3;
export const ZOMBIE_ATTACK_COOLDOWN = 20;
export const ZOMBIE_FOLLOW_RANGE = 16;
export const MOB_DESPAWN_RANGE = 72;
export const MOB_CAP = 10;
export const ATTACK_REACH = 4;
