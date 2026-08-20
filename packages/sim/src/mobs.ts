import { MOB_JSONS } from "./data/mobs/index.js";
import type { EntitySize } from "./entities.js";
import { NON_MOB_SIZES } from "./entities.js";
import { registerContentType, validateContentInstance } from "./registry/generic.js";
import { validateVisualJson, validateMobFallbackJson, localName, type MobJson } from "./registry/schema.js";
import type { MobVisualDef } from "./registry/visual.js";

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
  readonly visual?: MobVisualDef;
}

const defs = new Map<string, MobDef>();

function pretty(id: string): string {
  return localName(id).split("_").map((word) => (word[0] ?? "").toUpperCase() + word.slice(1)).join(" ");
}

registerContentType(
  {
    id: "mob",
    fields: {
      id: { kind: "qualified_id", required: true },
      name: { kind: "string" },
      sprite: { kind: "string" },
      // Validated separately below - see items.ts's registerContentType
      // call for why (content-type-parameterized fallback shape).
      visual: { kind: "any" },
      health: { kind: "number", min: 1, max: 10_000, required: true },
      speed: { kind: "number", min: 0, max: 10, required: true },
      size: {
        kind: "object",
        required: true,
        fields: { width: { kind: "number", min: 0.1, max: 10, required: true }, height: { kind: "number", min: 0.1, max: 10, required: true } },
      },
      melee: {
        kind: "object",
        fields: {
          damage: { kind: "number", min: 0, max: 1000, required: true },
          cooldown: { kind: "number", min: 1, max: 1000, required: true },
          follow_range: { kind: "number", min: 1, max: 256, required: true },
        },
      },
      ranged: {
        kind: "object",
        fields: {
          damage: { kind: "number", min: 0, max: 1000, required: true },
          range: { kind: "number", min: 1, max: 256, required: true },
          shoot_cooldown: { kind: "number", min: 1, max: 1000, required: true },
          kite_near: { kind: "number", min: 0, max: 256, required: true },
          kite_far: { kind: "number", min: 0, max: 256, required: true },
        },
      },
      explodes: {
        kind: "object",
        fields: {
          follow_range: { kind: "number", min: 0, max: 256, required: true },
          trigger_range: { kind: "number", min: 0, max: 256, required: true },
          fuse_ticks: { kind: "number", min: 1, max: 1000, required: true },
          block_radius: { kind: "number", min: 0, max: 64, required: true },
          damage_radius: { kind: "number", min: 0, max: 64, required: true },
          max_damage: { kind: "number", min: 0, max: 1000, required: true },
        },
      },
      wanders: { kind: "boolean" },
      burns_in_daylight: { kind: "boolean" },
      trades: { kind: "boolean" },
      loot: {
        kind: "array",
        items: {
          kind: "object",
          fields: {
            item: { kind: "ref", ref_type: "item", required: true },
            max: { kind: "number", min: 1, max: 64, required: true },
            chance: { kind: "number", min: 0, max: 1, required: true },
          },
        },
      },
      equipment: {
        kind: "object",
        fields: { armor: { kind: "ref", ref_type: "item" }, offhand: { kind: "ref", ref_type: "item" } },
      },
      spawn: {
        kind: "object",
        fields: {
          group: { kind: "enum", values: ["hostile_surface", "grass_day", "nether_pocket"] },
          weight: { kind: "number", min: 1, max: 100 },
          near_structure: { kind: "ref", ref_type: "structure" },
        },
      },
    },
  },
  "engine/types/mob",
);

/** Register a mob from datapack JSON (built-in files or server mods). */
export function registerMobJson(raw: unknown, source = "datapack"): MobDef {
  const v = validateContentInstance("mob", raw, source) as unknown as MobJson;
  const json: MobJson = {
    ...v,
    ...(v.visual !== undefined ? { visual: validateVisualJson(v.visual, source, validateMobFallbackJson) } : {}),
  };
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
