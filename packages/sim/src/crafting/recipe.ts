import { itemDef } from "../items.js";
import type { ItemStack } from "../inventory.js";

/**
 * Crafting recipes, defined in JSON files using Minecraft's datapack
 * format (src/data/recipes/*.json):
 *
 *   {
 *     "type": "flatcraft:crafting_shaped",
 *     "pattern": ["###", " | ", " | "],
 *     "key": {
 *       "#": { "item": "flatcraft:oak_planks" },
 *       "|": { "item": "flatcraft:stick" }
 *     },
 *     "result": { "item": "flatcraft:wooden_pickaxe" }
 *   }
 *
 *   {
 *     "type": "flatcraft:crafting_shapeless",
 *     "ingredients": [{ "item": "flatcraft:oak_log" }],
 *     "result": { "item": "flatcraft:oak_planks", "count": 4 }
 *   }
 *
 * Recipes whose pattern fits a 2x2 grid can be crafted in the inventory;
 * anything bigger needs a crafting table nearby - like Minecraft.
 */

export interface RecipeJson {
  type: string;
  pattern?: string[];
  key?: Record<string, { item: string }>;
  ingredients?: { item: string }[];
  /** Smelting recipes: the single input. */
  ingredient?: { item: string };
  /** Smelting recipes: accepted for Minecraft-likeness (ticks). */
  cookingtime?: number;
  result: { item: string; count?: number };
}

export interface Recipe {
  id: string;
  kind: "crafting" | "smelting";
  shaped: boolean;
  /** 2 = craftable in the inventory grid, 3 = needs a crafting table. */
  gridSize: 2 | 3;
  /** Total required count per item id (per smelted unit for smelting). */
  ingredients: ReadonlyMap<string, number>;
  /** Shaped recipes: the pattern as an item-id grid, null for blanks. */
  pattern?: (string | null)[][];
  /** Shapeless recipes: the flat list of required item ids. */
  shapeless?: string[];
  /** Smelting recipes: ticks per item. */
  cookingTime?: number;
  result: ItemStack;
}

/** Burn duration in ticks per fuel item (Minecraft values at 20 TPS). */
export const FUEL_TICKS: Readonly<Record<string, number>> = {
  coal: 1600,
  oak_log: 300,
  oak_planks: 300,
  stick: 100,
  crafting_table: 300,
};

export function fuelTicks(item: string): number {
  return FUEL_TICKS[item] ?? 0;
}

export const DEFAULT_COOK_TICKS = 200;

const NAMESPACE = "flatcraft:";

function parseItemId(raw: string, recipeId: string): string {
  const id = raw.startsWith(NAMESPACE) ? raw.slice(NAMESPACE.length) : raw;
  if (!itemDef(id)) {
    throw new Error(`recipe ${recipeId}: unknown item "${raw}"`);
  }
  return id;
}

export function parseRecipe(id: string, json: RecipeJson): Recipe {
  const result: ItemStack = {
    item: parseItemId(json.result.item, id),
    count: json.result.count ?? 1,
  };

  if (json.type === `${NAMESPACE}crafting_shaped`) {
    const pattern = json.pattern;
    const key = json.key;
    if (!pattern || pattern.length === 0 || pattern.length > 3 || !key) {
      throw new Error(`recipe ${id}: shaped recipe needs a 1-3 row pattern and a key`);
    }
    const width = Math.max(...pattern.map((row) => row.length));
    if (width === 0 || width > 3) {
      throw new Error(`recipe ${id}: pattern rows must be 1-3 characters`);
    }
    const ingredients = new Map<string, number>();
    const itemPattern: (string | null)[][] = [];
    for (const row of pattern) {
      const itemRow: (string | null)[] = [];
      for (let i = 0; i < width; i++) {
        const char = row[i] ?? " ";
        if (char === " ") {
          itemRow.push(null);
          continue;
        }
        const entry = key[char];
        if (!entry) {
          throw new Error(`recipe ${id}: pattern symbol "${char}" missing from key`);
        }
        const item = parseItemId(entry.item, id);
        ingredients.set(item, (ingredients.get(item) ?? 0) + 1);
        itemRow.push(item);
      }
      itemPattern.push(itemRow);
    }
    if (ingredients.size === 0) {
      throw new Error(`recipe ${id}: pattern is empty`);
    }
    const gridSize = width <= 2 && pattern.length <= 2 ? 2 : 3;
    return { id, kind: "crafting", shaped: true, gridSize, ingredients, pattern: itemPattern, result };
  }

  if (json.type === `${NAMESPACE}smelting`) {
    const ingredient = json.ingredient;
    if (!ingredient) {
      throw new Error(`recipe ${id}: smelting recipe needs an ingredient`);
    }
    const item = parseItemId(ingredient.item, id);
    return {
      id,
      kind: "smelting",
      shaped: false,
      gridSize: 3,
      ingredients: new Map([[item, 1]]),
      cookingTime: json.cookingtime ?? DEFAULT_COOK_TICKS,
      result,
    };
  }

  if (json.type === `${NAMESPACE}crafting_shapeless`) {
    const list = json.ingredients;
    if (!list || list.length === 0 || list.length > 9) {
      throw new Error(`recipe ${id}: shapeless recipe needs 1-9 ingredients`);
    }
    const ingredients = new Map<string, number>();
    const shapeless: string[] = [];
    for (const entry of list) {
      const item = parseItemId(entry.item, id);
      ingredients.set(item, (ingredients.get(item) ?? 0) + 1);
      shapeless.push(item);
    }
    const gridSize = list.length <= 4 ? 2 : 3;
    return { id, kind: "crafting", shaped: false, gridSize, ingredients, shapeless, result };
  }

  throw new Error(`recipe ${id}: unknown type "${json.type}"`);
}
