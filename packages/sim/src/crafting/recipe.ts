import { TAGS } from "../data/tags.js";
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

/** An ingredient reference: a concrete item or a tag (any member). */
export interface IngredientJson {
  item?: string;
  tag?: string;
}

export interface RecipeJson {
  type: string;
  pattern?: string[];
  key?: Record<string, IngredientJson>;
  ingredients?: IngredientJson[];
  /** Smelting recipes: the single input. */
  ingredient?: IngredientJson;
  /** Smelting recipes: accepted for Minecraft-likeness (ticks). */
  cookingtime?: number;
  result: { item: string; count?: number };
}

export interface Recipe {
  id: string;
  kind: "crafting" | "smelting" | "brewing";
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

/** Burn duration in ticks per fuel item (Minecraft values at 20 TPS). */
export const FUEL_TICKS: Readonly<Record<string, number>> = {
  coal: 1600,
  oak_log: 300,
  oak_planks: 300,
  birch_log: 300,
  birch_planks: 300,
  spruce_log: 300,
  spruce_planks: 300,
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

/** Parse an ingredient reference to its key ("item_id" or "#tag"). */
function parseIngredient(entry: IngredientJson, recipeId: string): string {
  if (entry.tag !== undefined) {
    const tag = entry.tag.startsWith(NAMESPACE) ? entry.tag.slice(NAMESPACE.length) : entry.tag;
    if (!TAGS[tag]) {
      throw new Error(`recipe ${recipeId}: unknown tag "${entry.tag}"`);
    }
    return `#${tag}`;
  }
  if (entry.item !== undefined) {
    return parseItemId(entry.item, recipeId);
  }
  throw new Error(`recipe ${recipeId}: ingredient needs "item" or "tag"`);
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
        const ingredientKey = parseIngredient(entry, id);
        ingredients.set(ingredientKey, (ingredients.get(ingredientKey) ?? 0) + 1);
        itemRow.push(ingredientKey);
      }
      itemPattern.push(itemRow);
    }
    if (ingredients.size === 0) {
      throw new Error(`recipe ${id}: pattern is empty`);
    }
    const gridSize = width <= 2 && pattern.length <= 2 ? 2 : 3;
    return { id, kind: "crafting", shaped: true, gridSize, ingredients, pattern: itemPattern, result };
  }

  if (json.type === `${NAMESPACE}brewing`) {
    const list = json.ingredients;
    if (!list || list.length === 0) {
      throw new Error(`recipe ${id}: brewing recipe needs ingredients`);
    }
    const ingredients = new Map<string, number>();
    for (const entry of list) {
      const key = parseIngredient(entry, id);
      ingredients.set(key, (ingredients.get(key) ?? 0) + 1);
    }
    return { id, kind: "brewing", shaped: false, gridSize: 3, ingredients, result };
  }

  if (json.type === `${NAMESPACE}smelting`) {
    const ingredient = json.ingredient;
    if (!ingredient) {
      throw new Error(`recipe ${id}: smelting recipe needs an ingredient`);
    }
    const item = parseIngredient(ingredient, id);
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
      const key = parseIngredient(entry, id);
      ingredients.set(key, (ingredients.get(key) ?? 0) + 1);
      shapeless.push(key);
    }
    const gridSize = list.length <= 4 ? 2 : 3;
    return { id, kind: "crafting", shaped: false, gridSize, ingredients, shapeless, result };
  }

  throw new Error(`recipe ${id}: unknown type "${json.type}"`);
}
