import { TIER_MATERIAL, TIER_ORDER } from "../../items.js";
import type { RecipeJson } from "../../crafting/recipe.js";

/**
 * Programmatically generated recipe families, in the exact same
 * datapack-JSON shape as the .json files - one entry per tier/wood so a
 * single loop covers what would otherwise be ~50 near-identical files.
 *
 * Availability per family follows the design doc's binary tier codes
 * (order: wood stone copper iron gold diamond emerald netherite):
 *   armor          00111111 (+ leather)
 *   shields        11111111 (diamond/emerald build on an iron shield)
 *   grappling hooks 11111111 (from iron on, the previous hook is part
 *                             of the recipe)
 *   hammers        11111111 (diamond/emerald build on an iron hammer)
 */

const ns = (id: string): string => `flatcraft:${id}`;
/** Material reference for a tier: item or the planks tag for wood. */
function materialRef(tier: (typeof TIER_ORDER)[number]): { item?: string; tag?: string } {
  const material = TIER_MATERIAL[tier];
  return material.startsWith("#") ? { tag: ns(material.slice(1)) } : { item: ns(material) };
}

export const GENERATED_RECIPES: Record<string, RecipeJson> = {};

// --- Wood building sets: stairs, slabs, fences, doors, trapdoors ---
for (const wood of ["oak", "birch", "spruce"]) {
  const planks = { item: ns(`${wood}_planks`) };
  const stick = { item: ns("stick") };
  GENERATED_RECIPES[`${wood}_stairs`] = {
    type: "flatcraft:crafting_shaped",
    pattern: ["#  ", "## ", "###"],
    key: { "#": planks },
    result: { item: ns(`${wood}_stairs`), count: 4 },
  };
  GENERATED_RECIPES[`${wood}_slab`] = {
    type: "flatcraft:crafting_shaped",
    pattern: ["###"],
    key: { "#": planks },
    result: { item: ns(`${wood}_slab`), count: 6 },
  };
  GENERATED_RECIPES[`${wood}_fence`] = {
    type: "flatcraft:crafting_shaped",
    pattern: ["#|#", "#|#"],
    key: { "#": planks, "|": stick },
    result: { item: ns(`${wood}_fence`), count: 3 },
  };
  GENERATED_RECIPES[`${wood}_door`] = {
    type: "flatcraft:crafting_shaped",
    pattern: ["##", "##", "##"],
    key: { "#": planks },
    result: { item: ns(`${wood}_door`), count: 3 },
  };
  GENERATED_RECIPES[`${wood}_trapdoor`] = {
    type: "flatcraft:crafting_shaped",
    pattern: ["###", "###"],
    key: { "#": planks },
    result: { item: ns(`${wood}_trapdoor`), count: 2 },
  };
}

// --- Hammers: all tiers; diamond/emerald sit on an iron hammer core ---
for (const tier of TIER_ORDER) {
  const material = materialRef(tier);
  const ironCore = tier === "diamond" || tier === "emerald";
  GENERATED_RECIPES[`${tier}_hammer`] = {
    type: "flatcraft:crafting_shaped",
    pattern: ironCore ? ["MMM", "MHM", " | "] : ["MMM", "M|M", " | "],
    key: ironCore
      ? { M: material, H: { item: ns("iron_hammer") }, "|": { item: ns("stick") } }
      : { M: material, "|": { item: ns("stick") } },
    result: { item: ns(`${tier}_hammer`) },
  };
}

// --- Armor: leather + copper..netherite; diamond/emerald on iron armor ---
const ARMOR_TIERS = ["leather", "copper", "iron", "golden", "diamond", "emerald", "netherite"] as const;
for (const tier of ARMOR_TIERS) {
  const material =
    tier === "leather" ? { item: ns("leather") } : materialRef(tier as (typeof TIER_ORDER)[number]);
  const ironCore = tier === "diamond" || tier === "emerald";
  GENERATED_RECIPES[`${tier}_armor`] = {
    type: "flatcraft:crafting_shaped",
    pattern: ironCore ? ["M M", "MIM", "MMM"] : ["M M", "MMM", "MMM"],
    key: ironCore ? { M: material, I: { item: ns("iron_armor") } } : { M: material },
    result: { item: ns(`${tier}_armor`) },
  };
}

// --- Shields: all tiers; diamond/emerald sit on an iron shield core ---
for (const tier of TIER_ORDER) {
  const material = materialRef(tier);
  const ironCore = tier === "diamond" || tier === "emerald";
  GENERATED_RECIPES[`${tier}_shield`] = {
    type: "flatcraft:crafting_shaped",
    pattern: ironCore ? ["MMM", "MSM", " M "] : ["MMM", "MMM", " M "],
    key: ironCore ? { M: material, S: { item: ns("iron_shield") } } : { M: material },
    result: { item: ns(`${tier}_shield`) },
  };
}

// --- Grappling hooks: all tiers, strings included; from iron on, the
// previous tier's hook is part of the recipe ---
TIER_ORDER.forEach((tier, index) => {
  const material = materialRef(tier);
  const string = { item: ns("string") };
  const ingredients = [material, material, material, string, string];
  if (index >= 3) {
    ingredients.push({ item: ns(`${TIER_ORDER[index - 1]}_grappling_hook`) });
  } else {
    ingredients.push({ item: ns("stick") });
  }
  GENERATED_RECIPES[`${tier}_grappling_hook`] = {
    type: "flatcraft:crafting_shapeless",
    ingredients,
    result: { item: ns(`${tier}_grappling_hook`) },
  };
});
