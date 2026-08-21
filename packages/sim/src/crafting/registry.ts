import { parseStationRecipe, type Recipe } from "./recipe.js";
import { itemRecipeSources } from "../items.js";

/**
 * The recipe registry. Recipes live in the datapack, embedded in their
 * result item's JSON file under "recipes" (content/flatcraft/items/*.json).
 * A recipe's id is its result item's id (plus _2, _3... for an item
 * with multiple recipes).
 */
const map = new Map<string, Recipe>();

/** Register a recipe from a datapack source (item file or server mod). */
export function registerRecipe(result: string, json: Parameters<typeof parseStationRecipe>[2]): Recipe {
  let id = result;
  let counter = 2;
  while (map.has(id)) {
    id = `${result}_${counter++}`;
  }
  const recipe = parseStationRecipe(id, result, json);
  map.set(id, recipe);
  return recipe;
}

/** How many item-embedded recipe sources have been consumed so far. */
let consumed = 0;

/**
 * Pull in recipes of items registered since the last call (used after a
 * server datapack registers additional items at runtime).
 */
export function syncItemRecipes(): void {
  const sources = itemRecipeSources();
  while (consumed < sources.length) {
    const { result, json } = sources[consumed++]!;
    registerRecipe(result, json);
  }
}

export const RECIPES: ReadonlyMap<string, Recipe> = map;
