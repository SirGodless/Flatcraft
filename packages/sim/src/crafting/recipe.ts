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
  result: { item: string; count?: number };
}

export interface Recipe {
  id: string;
  shaped: boolean;
  /** 2 = craftable in the inventory grid, 3 = needs a crafting table. */
  gridSize: 2 | 3;
  /** Total required count per item id. */
  ingredients: ReadonlyMap<string, number>;
  result: ItemStack;
}

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
    for (const row of pattern) {
      for (const char of row) {
        if (char === " ") continue;
        const entry = key[char];
        if (!entry) {
          throw new Error(`recipe ${id}: pattern symbol "${char}" missing from key`);
        }
        const item = parseItemId(entry.item, id);
        ingredients.set(item, (ingredients.get(item) ?? 0) + 1);
      }
    }
    if (ingredients.size === 0) {
      throw new Error(`recipe ${id}: pattern is empty`);
    }
    const gridSize = width <= 2 && pattern.length <= 2 ? 2 : 3;
    return { id, shaped: true, gridSize, ingredients, result };
  }

  if (json.type === `${NAMESPACE}crafting_shapeless`) {
    const list = json.ingredients;
    if (!list || list.length === 0 || list.length > 9) {
      throw new Error(`recipe ${id}: shapeless recipe needs 1-9 ingredients`);
    }
    const ingredients = new Map<string, number>();
    for (const entry of list) {
      const item = parseItemId(entry.item, id);
      ingredients.set(item, (ingredients.get(item) ?? 0) + 1);
    }
    const gridSize = list.length <= 4 ? 2 : 3;
    return { id, shaped: false, gridSize, ingredients, result };
  }

  throw new Error(`recipe ${id}: unknown type "${json.type}"`);
}
