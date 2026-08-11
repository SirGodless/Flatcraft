import { parseRecipe, type Recipe, type RecipeJson } from "../../crafting/recipe.js";

import craftingTable from "./crafting_table.json";
import oakPlanks from "./oak_planks.json";
import sandstone from "./sandstone.json";
import stick from "./stick.json";
import stoneAxe from "./stone_axe.json";
import stonePickaxe from "./stone_pickaxe.json";
import stoneShovel from "./stone_shovel.json";
import stoneSword from "./stone_sword.json";
import woodenAxe from "./wooden_axe.json";
import woodenPickaxe from "./wooden_pickaxe.json";
import woodenShovel from "./wooden_shovel.json";
import woodenSword from "./wooden_sword.json";

/**
 * To add a recipe: drop a .json file next to this index (Minecraft
 * datapack format, see crafting/recipe.ts) and register it here. The
 * recipe id is the filename without extension.
 */
const sources: Record<string, RecipeJson> = {
  oak_planks: oakPlanks,
  stick,
  crafting_table: craftingTable,
  sandstone,
  wooden_pickaxe: woodenPickaxe,
  wooden_axe: woodenAxe,
  wooden_shovel: woodenShovel,
  wooden_sword: woodenSword,
  stone_pickaxe: stonePickaxe,
  stone_axe: stoneAxe,
  stone_shovel: stoneShovel,
  stone_sword: stoneSword,
};

export const RECIPES: ReadonlyMap<string, Recipe> = new Map(
  Object.entries(sources).map(([id, json]) => [id, parseRecipe(id, json)]),
);
