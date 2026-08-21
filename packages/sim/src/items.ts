import { createInstanceStore, registerContentType, validateContentInstance } from "./registry/generic.js";
import { validateRecipeJson, validateVisualJson, validateItemFallbackJson, localName, type ItemJson, type RecipeJson } from "./registry/schema.js";
import type { ItemVisualDef } from "./registry/visual.js";
import { blockByName, BlockId } from "./world/block.js";

/**
 * Item registry. Every item is defined by a datapack JSON file
 * (src/data/items/*.json, see registry/schema.ts); capabilities are
 * optional components - an item is whatever its components say.
 * Item ids are strings ("golden_shovel") everywhere; there is no
 * numeric item id at all.
 */
export type ToolKind = "pickaxe" | "axe" | "shovel" | "sword" | "hammer";

export interface ToolDef {
  readonly kind: ToolKind;
  /** Harvest tier: 1 wood, 2 stone/copper, 3 iron, 4 diamond+. */
  readonly tier: number;
  /** Mining speed multiplier against matching blocks (hand = 1). */
  readonly speed: number;
}

export interface WeaponDef {
  readonly damage: number;
  readonly knockback: number;
}

export interface RangedWeaponDef {
  readonly damage: number;
  readonly cooldownTicks: number;
  readonly arrowSpeed: number;
  /** Item id consumed as ammo, one per shot. */
  readonly ammo: string;
}

export interface GliderDef {
  /** Clamps downward speed while gliding. */
  readonly sink: number;
  /** Horizontal speed multiplier while gliding. */
  readonly glideBoost: number;
}

export interface FoodDef {
  readonly hunger: number;
  /** Saturation buffers hunger drain before points are lost. */
  readonly saturation: number;
  /** Ticks it takes to eat. */
  readonly eatTicks: number;
  /** Item left behind after eating (e.g. a bowl). */
  readonly returns?: string | undefined;
}

export interface EffectDef {
  readonly id: string;
  readonly ticks: number;
  /** Item left behind after drinking (e.g. the glass bottle). */
  readonly returns?: string | undefined;
}

export interface ItemDef {
  readonly id: string;
  /** Display name. */
  readonly name: string;
  readonly maxStack: number;
  /** Set for items that place a block when used. */
  readonly block?: BlockId | undefined;
  readonly tool?: ToolDef | undefined;
  readonly weapon?: WeaponDef | undefined;
  /** Fires an ammo item as an arrow entity on the "shoot" command. */
  readonly ranged?: RangedWeaponDef | undefined;
  readonly food?: FoodDef | undefined;
  /** Fraction of incoming damage absorbed while worn. */
  readonly armor?: number | undefined;
  /** Fraction of damage blocked while held in the offhand. */
  readonly shieldBlock?: number | undefined;
  /** Grappling hook: max anchor distance in tiles. */
  readonly grapple?: number | undefined;
  /** Held while falling + jump: slows descent, boosts horizontal speed. */
  readonly glider?: GliderDef | undefined;
  readonly effect?: EffectDef | undefined;
  /** Bucket: capacity in whole blocks of liquid it can carry. */
  readonly bucket?: number | undefined;
  /** Nested inventory this item carries (backpacks): slot count. */
  readonly container?: number | undefined;
  /** Furnace burn duration when used as fuel. */
  readonly fuelTicks?: number | undefined;
  /** Enchantment ids this item can receive. */
  readonly enchants?: readonly string[] | undefined;
  /** Sprite path override (default sprites/item/<id>.png). */
  readonly sprite?: string | undefined;
  /** Sprite variants/animation/shader. */
  readonly visual?: ItemVisualDef | undefined;
}

const defs = createInstanceStore<ItemDef>("item");
/** Recipes embedded in item files, collected for the recipe registry. */
const recipeSources: Array<{ result: string; json: RecipeJson; source: string }> = [];

function pretty(id: string): string {
  return localName(id).split("_").map((word) => (word[0] ?? "").toUpperCase() + word.slice(1)).join(" ");
}

registerContentType(
  {
    id: "item",
    fields: {
      id: { kind: "qualified_id", required: true },
      name: { kind: "string" },
      max_stack: { kind: "number", min: 1, max: 64 },
      sprite: { kind: "string" },
      // visual/recipes are validated separately below - their shape is
      // either content-type-parameterized (visual's fallback) or
      // genuinely algorithmic (a recipe's station-dependent branching),
      // neither of which the flat field DSL expresses (see multiblock.ts's
      // `config` for the same "any" pattern, and structures.ts/biome.ts
      // for the same "generic engine validates the rest, hand code keeps
      // its own logic" split).
      visual: { kind: "any" },
      places_block: { kind: "ref", ref_type: "block" },
      tool: {
        kind: "object",
        fields: {
          kind: { kind: "enum", values: ["pickaxe", "axe", "shovel", "sword", "hammer"], required: true },
          tier: { kind: "number", min: 1, max: 8, required: true },
          mining_speed: { kind: "number", min: 1, max: 100, required: true },
        },
      },
      weapon: {
        kind: "object",
        fields: { damage: { kind: "number", min: 0, max: 100, required: true }, knockback: { kind: "number", min: 0, max: 2 } },
      },
      ranged: {
        kind: "object",
        fields: {
          damage: { kind: "number", min: 0, max: 100, required: true },
          cooldown_ticks: { kind: "number", min: 1, max: 1000, required: true },
          arrow_speed: { kind: "number", min: 0.01, max: 10, required: true },
          ammo: { kind: "ref", ref_type: "item", required: true },
        },
      },
      food: {
        kind: "object",
        fields: {
          hunger: { kind: "number", min: 0, max: 20, required: true },
          saturation: { kind: "number", min: 0, max: 20 },
          eat_ticks: { kind: "number", min: 1, max: 200 },
          returns: { kind: "ref", ref_type: "item" },
        },
      },
      armor: { kind: "object", fields: { absorb: { kind: "number", min: 0, max: 0.95, required: true } } },
      shield: { kind: "object", fields: { block: { kind: "number", min: 0, max: 0.95, required: true } } },
      grapple: { kind: "object", fields: { range: { kind: "number", min: 1, max: 128, required: true } } },
      glider: {
        kind: "object",
        fields: { sink: { kind: "number", min: 0, max: 1, required: true }, glide_boost: { kind: "number", min: 0, max: 10, required: true } },
      },
      effect: {
        kind: "object",
        fields: {
          id: { kind: "id", required: true },
          ticks: { kind: "number", min: 1, max: 1_000_000, required: true },
          returns: { kind: "ref", ref_type: "item" },
        },
      },
      bucket: { kind: "object", fields: { capacity: { kind: "number", min: 1, max: 64, required: true } } },
      container: { kind: "object", fields: { slots: { kind: "number", min: 1, max: 54, required: true } } },
      fuel_ticks: { kind: "number", min: 1, max: 100_000 },
      enchants: { kind: "array", items: { kind: "ref", ref_type: "enchant" } },
      recipes: { kind: "array", items: { kind: "any" } },
    },
  },
  "engine/types/item",
);

/** Register an item from datapack JSON (built-in files or server mods). */
export function registerItemJson(raw: unknown, source = "datapack"): ItemDef {
  const v = validateContentInstance("item", raw, source) as unknown as ItemJson;
  const json: ItemJson = {
    ...v,
    ...(v.visual !== undefined ? { visual: validateVisualJson(v.visual, source, validateItemFallbackJson) } : {}),
    ...(v.recipes !== undefined ? { recipes: v.recipes.map((entry, i) => validateRecipeJson(entry, source, i)) } : {}),
  };
  let block: BlockId | undefined;
  if (json.places_block !== undefined) {
    block = blockByName(json.places_block);
    if (block === undefined) {
      throw new Error(`datapack ${source}: places_block "${json.places_block}" is not a known block`);
    }
  }
  const def: ItemDef = {
    id: json.id,
    name: json.name ?? pretty(json.id),
    maxStack: json.max_stack ?? 64,
    ...(block !== undefined ? { block } : {}),
    ...(json.tool !== undefined
      ? { tool: { kind: json.tool.kind, tier: json.tool.tier, speed: json.tool.mining_speed } }
      : {}),
    ...(json.weapon !== undefined
      ? { weapon: { damage: json.weapon.damage, knockback: json.weapon.knockback ?? 0.35 } }
      : {}),
    ...(json.ranged !== undefined
      ? {
          ranged: {
            damage: json.ranged.damage,
            cooldownTicks: json.ranged.cooldown_ticks,
            arrowSpeed: json.ranged.arrow_speed,
            ammo: json.ranged.ammo,
          },
        }
      : {}),
    ...(json.glider !== undefined
      ? { glider: { sink: json.glider.sink, glideBoost: json.glider.glide_boost } }
      : {}),
    ...(json.food !== undefined
      ? {
          food: {
            hunger: json.food.hunger,
            saturation: json.food.saturation ?? Math.floor(json.food.hunger / 2),
            eatTicks: json.food.eat_ticks ?? 32,
            ...(json.food.returns !== undefined ? { returns: json.food.returns } : {}),
          },
        }
      : {}),
    ...(json.armor !== undefined ? { armor: json.armor.absorb } : {}),
    ...(json.shield !== undefined ? { shieldBlock: json.shield.block } : {}),
    ...(json.grapple !== undefined ? { grapple: json.grapple.range } : {}),
    ...(json.bucket !== undefined ? { bucket: json.bucket.capacity } : {}),
    ...(json.container !== undefined ? { container: json.container.slots } : {}),
    ...(json.effect !== undefined
      ? {
          effect: {
            id: json.effect.id,
            ticks: json.effect.ticks,
            ...(json.effect.returns !== undefined ? { returns: json.effect.returns } : {}),
          },
        }
      : {}),
    ...(json.fuel_ticks !== undefined ? { fuelTicks: json.fuel_ticks } : {}),
    ...(json.enchants !== undefined ? { enchants: json.enchants } : {}),
    ...(json.sprite !== undefined ? { sprite: json.sprite } : {}),
    ...(json.visual !== undefined ? { visual: json.visual } : {}),
  };
  defs.register(def);
  for (const recipe of json.recipes ?? []) {
    recipeSources.push({ result: def.id, json: recipe, source });
  }
  return def;
}

export function itemDef(id: string): ItemDef | undefined {
  return defs.get(id);
}

export function allItems(): Iterable<ItemDef> {
  return defs.values();
}

/** Recipes collected from item files (consumed by the recipe registry). */
export function itemRecipeSources(): ReadonlyArray<{ result: string; json: RecipeJson; source: string }> {
  return recipeSources;
}

/** Furnace burn duration for an item used as fuel (0 = not a fuel). */
export function fuelTicksOf(item: string): number {
  return defs.get(item)?.fuelTicks ?? 0;
}
