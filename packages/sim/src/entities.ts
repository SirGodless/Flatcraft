import type { ItemStack } from "./inventory.js";
import type { Dimension } from "./world/world.js";

/**
 * Non-player entities: items lying in the world and mobs. Plain
 * serializable data; all behavior lives in the simulation's tick.
 */
export type EntityId = number;

/** Any registered mob's string id (see mobs.ts for the datapack registry
 * - this is intentionally open, not a closed union, so a server datapack
 * mob works exactly like a built-in one). */
export type MobKind = string;

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

/** Type guards for narrowing `Entity`. Needed because `MobKind` is an
 * open string type (datapack-driven), so plain `entity.kind === "item"`
 * equality checks can't discriminate the union on their own - these
 * predicates spell the discrimination out explicitly instead. */
export function isItemEntity(e: Entity): e is ItemEntity {
  return e.kind === "item";
}
export function isArrowEntity(e: Entity): e is ArrowEntity {
  return e.kind === "arrow";
}
export function isMobEntity(e: Entity): e is MobEntity {
  return !isItemEntity(e) && !isArrowEntity(e);
}

export interface EntitySize {
  width: number;
  height: number;
}

/** Sizes for the two non-mob entity kinds. Mob sizes live in their
 * MobDef instead (mobs.ts's registry) - see sizeOf() there for a
 * lookup that covers all three kinds uniformly. */
export const NON_MOB_SIZES: Readonly<Record<"item" | "arrow", EntitySize>> = {
  item: { width: 0.25, height: 0.25 },
  arrow: { width: 0.3, height: 0.15 },
};

export const ITEM_DESPAWN_TICKS = 6000; // 5 minutes
export const ITEM_PICKUP_DELAY = 10;
/** Distance from the player's AABB within which items are collected. */
export const ITEM_PICKUP_RADIUS = 1.25;

export const ARROW_TTL = 100;
/** Player bow: stronger than most mobs' arrows, with its own fire rate. */
export const BOW_DAMAGE = 6;
export const BOW_COOLDOWN = 20;
export const BOW_ARROW_SPEED = 0.8;

export const MOB_DESPAWN_RANGE = 72;
export const MOB_CAP = 10;
export const ATTACK_REACH = 4;
