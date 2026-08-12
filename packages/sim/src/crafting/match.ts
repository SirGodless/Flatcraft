import type { ItemStack } from "../inventory.js";
import { ingredientMatches, type Recipe } from "./recipe.js";

/**
 * Grid crafting: match the contents of a crafting grid against shaped and
 * shapeless recipes, position-independently - exactly like Minecraft's
 * crafting table. The grid is always stored as 9 slots (3x3, row-major);
 * in 2x2 mode only the top-left square is usable.
 */

export const CRAFT_GRID_SIZE = 9;
export const CRAFT_GRID_WIDTH = 3;

/** Grid indices usable without a crafting table (top-left 2x2). */
export const SMALL_GRID_INDICES: readonly number[] = [0, 1, 3, 4];

interface Bounds {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}

function gridBounds(grid: readonly (ItemStack | null)[]): Bounds | null {
  let minRow = 3;
  let maxRow = -1;
  let minCol = 3;
  let maxCol = -1;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      if (!grid[row * CRAFT_GRID_WIDTH + col]) continue;
      minRow = Math.min(minRow, row);
      maxRow = Math.max(maxRow, row);
      minCol = Math.min(minCol, col);
      maxCol = Math.max(maxCol, col);
    }
  }
  return maxRow === -1 ? null : { minRow, maxRow, minCol, maxCol };
}

function matchesShaped(grid: readonly (ItemStack | null)[], recipe: Recipe, b: Bounds): boolean {
  const pattern = recipe.pattern!;
  const height = pattern.length;
  const width = pattern[0]!.length;
  if (b.maxRow - b.minRow + 1 !== height || b.maxCol - b.minCol + 1 !== width) return false;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const want = pattern[row]![col] ?? null;
      const have = grid[(b.minRow + row) * CRAFT_GRID_WIDTH + (b.minCol + col)] ?? null;
      if ((want === null) !== (have === null)) return false;
      if (want !== null && have !== null && !ingredientMatches(want, have.item)) return false;
    }
  }
  return true;
}

function matchesShapeless(grid: readonly (ItemStack | null)[], recipe: Recipe): boolean {
  const remaining = [...recipe.shapeless!];
  let filled = 0;
  for (const stack of grid) {
    if (!stack) continue;
    filled++;
    const idx = remaining.findIndex((key) => ingredientMatches(key, stack.item));
    if (idx === -1) return false;
    remaining.splice(idx, 1);
  }
  return filled > 0 && remaining.length === 0;
}

/**
 * The recipe the grid currently produces, or null. `maxGridSize` is 2
 * without a crafting table nearby, which excludes 3x3-only recipes.
 */
export function matchGrid(
  grid: readonly (ItemStack | null)[],
  recipes: Iterable<Recipe>,
  maxGridSize: 2 | 3,
): Recipe | null {
  const bounds = gridBounds(grid);
  if (!bounds) return null;
  for (const recipe of recipes) {
    if (recipe.kind !== "crafting" || recipe.gridSize > maxGridSize) continue;
    if (recipe.shaped ? matchesShaped(grid, recipe, bounds) : matchesShapeless(grid, recipe)) {
      return recipe;
    }
  }
  return null;
}
