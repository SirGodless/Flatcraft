import { TAGS } from "../data/tags.js";
import { fuelTicksOf, itemDef } from "../items.js";
import type { ItemStack } from "../inventory.js";
import type { RecipeJson } from "../registry/schema.js";

/**
 * Recipes come from the datapack: usually embedded in the result item's
 * JSON file under "recipes" (see registry/schema.ts), e.g.:
 *
 *   "recipes": [{
 *     "station": "crafting_table",
 *     "style": "shaped",
 *     "recipe": ["a", "b", "b"],
 *     "key": { "a": "item:gold_ingot", "b": "item:stick" },
 *     "amount": 1
 *   }]
 *
 * Ingredient refs are "item:<id>" or "tag:<name>" (any member of the
 * tag matches - e.g. tag:planks accepts every wood type). Shaped
 * recipes match position-independently, like Minecraft; shapeless
 * additionally ignores the arrangement entirely.
 */

export interface Recipe {
  id: string;
  kind: "crafting" | "smelting" | "brewing";
  /** Which block (via BlockDef.station) must be nearby, if any - "inventory"
   * needs none. Carried straight from the JSON rather than re-derived
   * from kind/gridSize. */
  station: "inventory" | "crafting_table" | "furnace" | "brewing_stand";
  shaped: boolean;
  /** 2 = craftable in the inventory grid, 3 = needs a crafting table. */
  gridSize: 2 | 3;
  /**
   * Total required count per ingredient key. A key is an item id or a
   * tag reference ("#planks") - resolve with `ingredientOptions`.
   */
  ingredients: ReadonlyMap<string, number>;
  /** Shaped recipes: the pattern as an ingredient-key grid, null blanks. */
  pattern?: (string | null)[][];
  /** Shapeless recipes: the flat list of required ingredient keys. */
  shapeless?: string[];
  /** Smelting recipes: ticks per item. */
  cookingTime?: number;
  result: ItemStack;
}

export const DEFAULT_COOK_TICKS = 200;

/** Furnace burn duration in ticks (from the item's fuel_ticks). */
export function fuelTicks(item: string): number {
  return fuelTicksOf(item);
}

/** Convert a validated ingredient ref to a registry key and check it. */
function refToKey(ref: string, recipeId: string): string {
  const [type, name] = ref.split(":") as [string, string];
  if (type === "tag") {
    if (!TAGS[name]) {
      throw new Error(`recipe ${recipeId}: unknown tag "${name}"`);
    }
    return `#${name}`;
  }
  if (!itemDef(name)) {
    throw new Error(`recipe ${recipeId}: unknown item "${name}"`);
  }
  return name;
}

/** The concrete item ids an ingredient key accepts. */
export function ingredientOptions(key: string): readonly string[] {
  if (key.startsWith("#")) return TAGS[key.slice(1)] ?? [];
  return [key];
}

export function ingredientMatches(key: string, item: string): boolean {
  return key.startsWith("#") ? (TAGS[key.slice(1)] ?? []).includes(item) : key === item;
}

/** Display name for an ingredient key ("#planks" -> "any planks"). */
export function ingredientLabel(key: string): string {
  return key.startsWith("#") ? `any ${key.slice(1)}` : key;
}

/** Parse a (schema-validated) station recipe into the runtime Recipe. */
export function parseStationRecipe(id: string, resultItem: string, json: RecipeJson): Recipe {
  if (!itemDef(resultItem)) {
    throw new Error(`recipe ${id}: unknown result item "${resultItem}"`);
  }
  const result: ItemStack = { item: resultItem, count: json.amount ?? 1 };

  if (json.station === "furnace") {
    const key = refToKey(json.input!, id);
    return {
      id,
      kind: "smelting",
      station: "furnace",
      shaped: false,
      gridSize: 3,
      ingredients: new Map([[key, 1]]),
      cookingTime: json.cooking_ticks ?? DEFAULT_COOK_TICKS,
      result,
    };
  }

  if (json.station === "brewing_stand") {
    const ingredients = new Map<string, number>();
    for (const ref of json.ingredients!) {
      const key = refToKey(ref, id);
      ingredients.set(key, (ingredients.get(key) ?? 0) + 1);
    }
    return { id, kind: "brewing", station: "brewing_stand", shaped: false, gridSize: 3, ingredients, result };
  }

  const stationSize = json.station === "inventory" ? 2 : 3;
  if (json.style === "shapeless") {
    const ingredients = new Map<string, number>();
    const shapeless: string[] = [];
    for (const ref of json.ingredients!) {
      const key = refToKey(ref, id);
      ingredients.set(key, (ingredients.get(key) ?? 0) + 1);
      shapeless.push(key);
    }
    if (stationSize === 2 && shapeless.length > 4) {
      throw new Error(`recipe ${id}: station "inventory" fits at most 4 ingredients`);
    }
    return { id, kind: "crafting", station: json.station, shaped: false, gridSize: stationSize, ingredients, shapeless, result };
  }

  const rows = json.recipe!;
  const width = Math.max(...rows.map((row) => row.length));
  if (stationSize === 2 && (width > 2 || rows.length > 2)) {
    throw new Error(`recipe ${id}: station "inventory" fits at most a 2x2 pattern`);
  }
  const ingredients = new Map<string, number>();
  const pattern: (string | null)[][] = [];
  for (const row of rows) {
    const patternRow: (string | null)[] = [];
    for (let i = 0; i < width; i++) {
      const letter = row[i] ?? " ";
      if (letter === " ") {
        patternRow.push(null);
        continue;
      }
      const ref = json.key?.[letter];
      if (ref === undefined) {
        throw new Error(`recipe ${id}: pattern symbol "${letter}" missing from key`);
      }
      const key = refToKey(ref, id);
      ingredients.set(key, (ingredients.get(key) ?? 0) + 1);
      patternRow.push(key);
    }
    pattern.push(patternRow);
  }
  if (ingredients.size === 0) {
    throw new Error(`recipe ${id}: pattern is empty`);
  }
  return { id, kind: "crafting", station: json.station, shaped: true, gridSize: stationSize, ingredients, pattern, result };
}
