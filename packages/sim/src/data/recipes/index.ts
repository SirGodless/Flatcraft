import { parseRecipe, type Recipe, type RecipeJson } from "../../crafting/recipe.js";

import arrow from "./arrow.json";
import backpack from "./backpack.json";
import birchPlanks from "./birch_planks.json";
import copperIngot from "./copper_ingot.json";
import netheriteIngot from "./netherite_ingot.json";
import netheriteScrap from "./netherite_scrap.json";
import sprucePlanks from "./spruce_planks.json";
import { GENERATED_RECIPES } from "./generated.js";
import bow from "./bow.json";
import brewingStand from "./brewing_stand.json";
import chest from "./chest.json";
import cookedBeef from "./cooked_beef.json";
import cookedChicken from "./cooked_chicken.json";
import cookedPorkchop from "./cooked_porkchop.json";
import craftingTable from "./crafting_table.json";
import diamondAxe from "./diamond_axe.json";
import enchantingTable from "./enchanting_table.json";
import diamondPickaxe from "./diamond_pickaxe.json";
import diamondShovel from "./diamond_shovel.json";
import diamondSword from "./diamond_sword.json";
import flintAndSteel from "./flint_and_steel.json";
import furnace from "./furnace.json";
import glass from "./glass.json";
import glassBottle from "./glass_bottle.json";
import glowstone from "./glowstone.json";
import potionMiner from "./potion_miner.json";
import potionRegeneration from "./potion_regeneration.json";
import potionSpeed from "./potion_speed.json";
import potionStrength from "./potion_strength.json";
import goldIngot from "./gold_ingot.json";
import goldenAxe from "./golden_axe.json";
import goldenPickaxe from "./golden_pickaxe.json";
import goldenShovel from "./golden_shovel.json";
import goldenSword from "./golden_sword.json";
import ironAxe from "./iron_axe.json";
import ironIngot from "./iron_ingot.json";
import ironPickaxe from "./iron_pickaxe.json";
import ironShovel from "./iron_shovel.json";
import ironSword from "./iron_sword.json";
import oakPlanks from "./oak_planks.json";
import sandstone from "./sandstone.json";
import stick from "./stick.json";
import stone from "./stone.json";
import string from "./string.json";
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
  furnace,
  sandstone,
  wooden_pickaxe: woodenPickaxe,
  wooden_axe: woodenAxe,
  wooden_shovel: woodenShovel,
  wooden_sword: woodenSword,
  stone_pickaxe: stonePickaxe,
  stone_axe: stoneAxe,
  stone_shovel: stoneShovel,
  stone_sword: stoneSword,
  iron_pickaxe: ironPickaxe,
  iron_axe: ironAxe,
  iron_shovel: ironShovel,
  iron_sword: ironSword,
  golden_pickaxe: goldenPickaxe,
  golden_axe: goldenAxe,
  golden_shovel: goldenShovel,
  golden_sword: goldenSword,
  diamond_pickaxe: diamondPickaxe,
  diamond_axe: diamondAxe,
  diamond_shovel: diamondShovel,
  diamond_sword: diamondSword,
  iron_ingot: ironIngot,
  gold_ingot: goldIngot,
  glass,
  stone,
  flint_and_steel: flintAndSteel,
  chest,
  backpack,
  glowstone,
  glass_bottle: glassBottle,
  brewing_stand: brewingStand,
  enchanting_table: enchantingTable,
  potion_speed: potionSpeed,
  potion_regeneration: potionRegeneration,
  potion_strength: potionStrength,
  potion_miner: potionMiner,
  string,
  bow,
  arrow,
  cooked_porkchop: cookedPorkchop,
  cooked_beef: cookedBeef,
  cooked_chicken: cookedChicken,
  birch_planks: birchPlanks,
  spruce_planks: sprucePlanks,
  copper_ingot: copperIngot,
  netherite_scrap: netheriteScrap,
  netherite_ingot: netheriteIngot,
  ...GENERATED_RECIPES,
};

export const RECIPES: ReadonlyMap<string, Recipe> = new Map(
  Object.entries(sources).map(([id, json]) => [id, parseRecipe(id, json)]),
);
