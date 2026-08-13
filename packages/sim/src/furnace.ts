import { DEFAULT_COOK_TICKS, fuelTicks, type Recipe } from "./crafting/recipe.js";
import type { ItemStack } from "./inventory.js";
import { itemDef } from "./items.js";
import type { Dimension } from "./world/world.js";

/**
 * Furnace block state: a real Minecraft-style furnace with input, fuel
 * and output slots that cooks while burning. States live in the
 * simulation keyed by position and tick with the world.
 */
export interface FurnaceState {
  dimension: Dimension;
  x: number;
  y: number;
  input: ItemStack | null;
  fuel: ItemStack | null;
  output: ItemStack | null;
  /** Remaining burn time of the current fuel, in ticks. */
  burnLeft: number;
  /** Full burn time of the current fuel (for the flame indicator). */
  burnTotal: number;
  /** Progress cooking the current input item, in ticks. */
  cookProgress: number;
  /** Burn/cook rate multiplier from the block that created this (a
   * datapack "blast furnace" variant might run at 2x). */
  speed: number;
}

export function createFurnace(dimension: Dimension, x: number, y: number, speed = 1): FurnaceState {
  return { dimension, x, y, input: null, fuel: null, output: null, burnLeft: 0, burnTotal: 0, cookProgress: 0, speed };
}

export function furnaceKey(dimension: Dimension, x: number, y: number): string {
  return `${dimension}:${x},${y}`;
}

/** The smelting recipe consuming this item, if any. */
export function smeltingRecipeFor(item: string, recipes: Iterable<Recipe>): Recipe | null {
  for (const recipe of recipes) {
    if (recipe.kind === "smelting" && recipe.ingredients.has(item)) return recipe;
  }
  return null;
}

/**
 * Advance a furnace by one tick. Returns true if anything observable
 * changed (slots, burn or cook state).
 */
export function stepFurnace(state: FurnaceState, recipes: Iterable<Recipe>): boolean {
  let changed = false;

  const recipe = state.input ? smeltingRecipeFor(state.input.item, recipes) : null;
  const maxStack = recipe ? (itemDef(recipe.result.item)?.maxStack ?? 64) : 0;
  const outputFits =
    recipe !== null &&
    (state.output === null ||
      (state.output.item === recipe.result.item && state.output.count + recipe.result.count <= maxStack));
  const canCook = recipe !== null && outputFits;

  if (state.burnLeft > 0) {
    state.burnLeft = Math.max(0, state.burnLeft - state.speed);
    changed = true;
  }

  // Ignite new fuel only when there is something to cook.
  if (canCook && state.burnLeft === 0 && state.fuel && fuelTicks(state.fuel.item) > 0) {
    const ticks = fuelTicks(state.fuel.item);
    state.fuel = state.fuel.count > 1 ? { item: state.fuel.item, count: state.fuel.count - 1 } : null;
    state.burnLeft = ticks;
    state.burnTotal = ticks;
    changed = true;
  }

  if (canCook && state.burnLeft > 0) {
    state.cookProgress += state.speed;
    changed = true;
    const needed = recipe.cookingTime ?? DEFAULT_COOK_TICKS;
    if (state.cookProgress >= needed) {
      state.cookProgress = 0;
      state.output = state.output
        ? { item: state.output.item, count: state.output.count + recipe.result.count }
        : { item: recipe.result.item, count: recipe.result.count };
      state.input = state.input!.count > 1 ? { item: state.input!.item, count: state.input!.count - 1 } : null;
    }
  } else if (state.cookProgress !== 0) {
    // Nothing cookable: progress resets (Minecraft decays it; reset is fine).
    state.cookProgress = 0;
    changed = true;
  }

  return changed;
}

/** Whether the furnace is completely idle (no need to broadcast). */
export function furnaceIdle(state: FurnaceState): boolean {
  return state.burnLeft === 0 && state.cookProgress === 0;
}
