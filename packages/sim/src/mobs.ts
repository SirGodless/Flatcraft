import { MOB_JSONS } from "./data/mobs/index.js";
import type { EntitySize } from "./entities.js";
import { NON_MOB_SIZES } from "./entities.js";
import { validateMobJson } from "./registry/schema.js";
import type { VisualDef } from "./registry/visual.js";

/**
 * Mob registry. Every mob kind is defined by a datapack JSON file
 * (src/data/mobs/*.json, see registry/schema.ts) the same way items and
 * blocks are: base stats plus optional AI-behavior components. A mob
 * with none of melee/ranged/explodes/wanders just stands there (still
 * useful for e.g. a pure trading NPC).
 */

export interface MeleeDef {
  readonly damage: number;
  readonly cooldown: number;
  readonly followRange: number;
}

export interface RangedDef {
  readonly damage: number;
  readonly range: number;
  readonly shootCooldown: number;
  readonly kiteNear: number;
  readonly kiteFar: number;
}

export interface ExplodesDef {
  readonly followRange: number;
  readonly triggerRange: number;
  readonly fuseTicks: number;
  readonly blockRadius: number;
  readonly damageRadius: number;
  readonly maxDamage: number;
}

export interface MobLootEntry {
  readonly item: string;
  readonly max: number;
  readonly chance: number;
}

export interface MobEquipmentDef {
  readonly armor?: string;
  readonly offhand?: string;
}

export interface MobSpawnDef {
  readonly group?: "hostile_surface" | "grass_day" | "nether_pocket";
  readonly weight: number;
  readonly nearStructure?: string;
}

export interface MobDef {
  readonly id: string;
  readonly name: string;
  readonly health: number;
  readonly speed: number;
  readonly size: EntitySize;
  readonly melee?: MeleeDef;
  readonly ranged?: RangedDef;
  readonly explodes?: ExplodesDef;
  readonly wanders?: boolean;
  readonly burnsInDaylight?: boolean;
  /** Can be right-clicked to open the trade panel. */
  readonly trades?: boolean;
  readonly loot?: readonly MobLootEntry[];
  readonly equipment?: MobEquipmentDef;
  readonly spawn?: MobSpawnDef;
  /** Sprite path override (default sprites/mob/<id>.png). */
  readonly sprite?: string;
  /** Sprite variants/animation/shader. */
  readonly visual?: VisualDef;
}

const defs = new Map<string, MobDef>();

function pretty(id: string): string {
  return id.split("_").map((word) => (word[0] ?? "").toUpperCase() + word.slice(1)).join(" ");
}

/** Register a mob from datapack JSON (built-in files or server mods). */
export function registerMobJson(raw: unknown, source = "datapack"): MobDef {
  const json = validateMobJson(raw, source);
  const def: MobDef = {
    id: json.id,
    name: json.name ?? pretty(json.id),
    health: json.health,
    speed: json.speed,
    size: { width: json.size.width, height: json.size.height },
    ...(json.melee !== undefined
      ? { melee: { damage: json.melee.damage, cooldown: json.melee.cooldown, followRange: json.melee.follow_range } }
      : {}),
    ...(json.ranged !== undefined
      ? {
          ranged: {
            damage: json.ranged.damage,
            range: json.ranged.range,
            shootCooldown: json.ranged.shoot_cooldown,
            kiteNear: json.ranged.kite_near,
            kiteFar: json.ranged.kite_far,
          },
        }
      : {}),
    ...(json.explodes !== undefined
      ? {
          explodes: {
            followRange: json.explodes.follow_range,
            triggerRange: json.explodes.trigger_range,
            fuseTicks: json.explodes.fuse_ticks,
            blockRadius: json.explodes.block_radius,
            damageRadius: json.explodes.damage_radius,
            maxDamage: json.explodes.max_damage,
          },
        }
      : {}),
    ...(json.wanders !== undefined ? { wanders: json.wanders } : {}),
    ...(json.burns_in_daylight !== undefined ? { burnsInDaylight: json.burns_in_daylight } : {}),
    ...(json.trades !== undefined ? { trades: json.trades } : {}),
    ...(json.loot !== undefined ? { loot: json.loot } : {}),
    ...(json.equipment !== undefined
      ? {
          equipment: {
            ...(json.equipment.armor !== undefined ? { armor: json.equipment.armor } : {}),
            ...(json.equipment.offhand !== undefined ? { offhand: json.equipment.offhand } : {}),
          },
        }
      : {}),
    ...(json.spawn !== undefined
      ? { spawn: { weight: json.spawn.weight ?? 1, ...(json.spawn.group !== undefined ? { group: json.spawn.group } : {}), ...(json.spawn.near_structure !== undefined ? { nearStructure: json.spawn.near_structure } : {}) } }
      : {}),
    ...(json.sprite !== undefined ? { sprite: json.sprite } : {}),
    ...(json.visual !== undefined ? { visual: json.visual } : {}),
  };
  defs.set(def.id, def);
  return def;
}

for (const raw of MOB_JSONS) {
  registerMobJson(raw, "builtin");
}

export function mobDef(id: string): MobDef | undefined {
  return defs.get(id);
}

export function allMobs(): Iterable<MobDef> {
  return defs.values();
}

/** Size for any entity kind - the two non-mob kinds ("item"/"arrow")
 * plus every registered mob. */
export function sizeOf(kind: string): EntitySize {
  if (kind === "item" || kind === "arrow") return NON_MOB_SIZES[kind];
  return mobDef(kind)?.size ?? { width: 0.6, height: 1.8 };
}

/** Mob kinds carrying a given AI component, in registration order -
 * e.g. every melee mob, for the AI dispatch in simulation.ts. Computed
 * once; the registry doesn't change at runtime. */
function withComponent<K extends keyof MobDef>(key: K): readonly string[] {
  return [...defs.values()].filter((m) => m[key] !== undefined).map((m) => m.id);
}

export const MELEE_MOBS: readonly string[] = withComponent("melee");
export const RANGED_MOBS: readonly string[] = withComponent("ranged");
export const EXPLODING_MOBS: readonly string[] = withComponent("explodes");
export const WANDERING_MOBS: readonly string[] = withComponent("wanders");
export const BURNING_MOBS: readonly string[] = withComponent("burnsInDaylight");

/** Registered mob kinds belonging to a natural-spawn pool, expanded by
 * weight and in registration order - e.g. a weight-2 mob appears twice,
 * so a uniform pick over the array reproduces the weighting. */
export function spawnPool(group: NonNullable<MobSpawnDef["group"]>): readonly string[] {
  const pool: string[] = [];
  for (const def of defs.values()) {
    if (def.spawn?.group !== group) continue;
    for (let i = 0; i < def.spawn.weight; i++) pool.push(def.id);
  }
  return pool;
}

/** Mobs anchored to a named structure instead of the ambient spawn roll
 * (e.g. villagers appearing near houses). */
export function mobsNearStructure(structureId: string): readonly string[] {
  return [...defs.values()].filter((m) => m.spawn?.nearStructure === structureId).map((m) => m.id);
}
