import type { InventorySlots, ItemStack } from "./inventory.js";
import type { Dimension } from "./world/world.js";

/**
 * Everything that lives in the world - items, mobs, arrows, and players
 * alike - is an Entity, sharing one id space and one map. Plain
 * serializable data; all behavior lives in the simulation's tick.
 */
export type EntityId = number;

/** A player's current movement intent, kept until the next move command. */
export interface PlayerInput {
  dx: -1 | 0 | 1;
  jump: boolean;
  /** Creative flight: descend. */
  down?: boolean;
}

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
  /** Worn armor (damage absorption) - unset for every built-in mob today;
   * a datapack mob or future spawn logic can equip one (see mobs.ts). */
  armor?: ItemStack | null;
  /** Offhand item (shields block passively from here). */
  offhand?: ItemStack | null;
  /** Carried items, dropped on death alongside armor/offhand. */
  inventory?: InventorySlots;
}

export interface ArrowEntity extends EntityBase {
  kind: "arrow";
  damage: number;
  /** Remaining lifetime in ticks. */
  ttl: number;
  /** Set for player-shot arrows: they hit mobs instead of players. */
  owner?: number;
}

export interface PlayerEntity extends EntityBase {
  kind: "player";
  name: string;
  /** Body color (0xRRGGBB), chosen at login / via set_color. */
  color: number;
  input: PlayerInput;
  inventory: InventorySlots;
  /** Selected hotbar slot, 0..8. */
  selected: number;
  /** Stack held on the cursor while a UI is open. */
  cursor: ItemStack | null;
  /** Personal 3x3 crafting grid (only the 2x2 corner without a table). */
  craftGrid: (ItemStack | null)[];
  /** Block currently being mined, with accumulated progress ticks.
   * `wall` targets the background layer (hammer mining). */
  mining: { x: number; y: number; progress: number; wall?: boolean } | null;
  health: number;
  /** Hunger bar, 0..PLAYER_MAX_HUNGER. */
  hunger: number;
  /** Accumulated activity; drains hunger at EXHAUSTION_PER_POINT. */
  exhaustion: number;
  /** Invulnerability frames after taking a hit. */
  hurtCooldown: number;
  /** Ticks until the next melee attack is allowed. */
  attackCooldown: number;
  /** Knockback velocity, decays and adds onto walking. */
  kbX: number;
  /** Tiles fallen so far in the current fall. */
  fallDistance: number;
  /** Active potion effects, remaining ticks by effect id. */
  effects: Record<string, number>;
  /** Consecutive ticks standing inside a nether portal. */
  portalTicks: number;
  /** Ticks left before a portal can trigger again after arriving. */
  portalCooldown: number;
  /** Saturation buffers hunger drain (eating tops it up). */
  saturation: number;
  /** Food currently being eaten (takes the item's eat_ticks). */
  eating: { item: string; ticks: number } | null;
  /** Worn armor piece (damage absorption). */
  armor: ItemStack | null;
  /** Offhand item (shields block passively from here). */
  offhand: ItemStack | null;
  /** Active grappling-hook pull toward an anchor point. */
  grapple: { x: number; y: number; ticks: number } | null;
  /** Creative mode: no damage, flight, instant break, free placement. */
  creative: boolean;
  /** Remaining diving air in ticks (MAX_AIR_TICKS when surfaced). */
  air: number;
  /** Which way this player is visually facing (last nonzero move dx). */
  facing: "left" | "right";
}

export type Entity = ItemEntity | MobEntity | ArrowEntity | PlayerEntity;

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
export function isPlayerEntity(e: Entity): e is PlayerEntity {
  return e.kind === "player";
}
export function isMobEntity(e: Entity): e is MobEntity {
  return !isItemEntity(e) && !isArrowEntity(e) && !isPlayerEntity(e);
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

export const MOB_DESPAWN_RANGE = 72;
export const MOB_CAP = 10;
export const ATTACK_REACH = 4;
