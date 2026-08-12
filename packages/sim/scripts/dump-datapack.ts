/**
 * One-shot migration: dump the current code-defined registries (items,
 * blocks, recipes) into the new datapack JSON files under src/data/items
 * and src/data/blocks, plus generated index.ts import lists. Run via:
 *   npx esbuild scripts/dump-datapack.ts --bundle --platform=node \
 *     --format=esm --outfile=dist/dump.mjs && node dist/dump.mjs
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { allItems } from "../src/items.js";
import { RECIPES } from "../src/data/recipes/index.js";
import { FUEL_TICKS, type Recipe } from "../src/crafting/recipe.js";
import { blockDef, BlockId } from "../src/world/block.js";
import { potionEffect } from "../src/effects.js";

const itemsDir = join(import.meta.dirname, "../src/data/items");
const blocksDir = join(import.meta.dirname, "../src/data/blocks");
rmSync(itemsDir, { recursive: true, force: true });
rmSync(blocksDir, { recursive: true, force: true });
mkdirSync(itemsDir, { recursive: true });
mkdirSync(blocksDir, { recursive: true });

const pretty = (id: string): string =>
  id.split("_").map((w) => (w[0] ?? "").toUpperCase() + w.slice(1)).join(" ");

// --- Recipes: convert parsed Recipe objects to the new station format ---
function ingredientRef(key: string): string {
  return key.startsWith("#") ? `tag:${key.slice(1)}` : `item:${key}`;
}

function toNewRecipe(r: Recipe): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (r.kind === "smelting") {
    out["station"] = "furnace";
    out["input"] = ingredientRef([...r.ingredients.keys()][0]!);
    out["cooking_ticks"] = r.cookingTime ?? 200;
  } else if (r.kind === "brewing") {
    out["station"] = "brewing_stand";
    const list: string[] = [];
    for (const [key, count] of r.ingredients) {
      for (let i = 0; i < count; i++) list.push(ingredientRef(key));
    }
    out["ingredients"] = list;
  } else {
    out["station"] = r.gridSize === 3 ? "crafting_table" : "inventory";
    if (r.shaped) {
      out["style"] = "shaped";
      const letters = new Map<string, string>();
      const alphabet = "abcdefghi";
      const rows: string[] = [];
      for (const row of r.pattern!) {
        let s = "";
        for (const cell of row) {
          if (cell === null) {
            s += " ";
          } else {
            if (!letters.has(cell)) letters.set(cell, alphabet[letters.size]!);
            s += letters.get(cell)!;
          }
        }
        rows.push(s);
      }
      out["recipe"] = rows;
      out["key"] = Object.fromEntries([...letters].map(([key, l]) => [l, ingredientRef(key)]));
    } else {
      out["style"] = "shapeless";
      out["ingredients"] = r.shapeless!.map(ingredientRef);
    }
  }
  if (r.result.count !== 1) out["amount"] = r.result.count;
  return out;
}

const recipesByResult = new Map<string, Recipe[]>();
for (const recipe of RECIPES.values()) {
  const list = recipesByResult.get(recipe.result.item) ?? [];
  list.push(recipe);
  recipesByResult.set(recipe.result.item, list);
}

// --- Items ---
const SWORD_DAMAGE: Record<number, number> = { 1: 4, 2: 5, 3: 6, 4: 7 };
const itemFiles: string[] = [];
for (const def of allItems()) {
  const json: Record<string, unknown> = { id: def.id, name: pretty(def.id) };
  if (def.maxStack !== 64) json["max_stack"] = def.maxStack;
  if (def.block !== undefined) json["places_block"] = blockDef(def.block).name;
  if (def.tool) {
    json["tool"] = { kind: def.tool.kind, tier: def.tool.tier, mining_speed: def.tool.speed };
    json["weapon"] = {
      damage: def.tool.kind === "sword" ? (SWORD_DAMAGE[def.tool.tier] ?? 4) : 2,
      knockback: 0.35,
    };
    json["enchants"] = [def.tool.kind === "sword" ? "sharpness" : "efficiency"];
  }
  if (def.food !== undefined) {
    const cooked = def.id.startsWith("cooked_");
    json["food"] = {
      hunger: def.food,
      saturation: cooked ? def.food : Math.floor(def.food / 2),
      eat_ticks: 32,
    };
  }
  const effect = potionEffect(def.id);
  if (effect) {
    json["effect"] = { id: effect, ticks: 1800, returns: "glass_bottle" };
  }
  if (def.armor !== undefined) json["armor"] = { absorb: def.armor };
  if (def.shieldBlock !== undefined) json["shield"] = { block: def.shieldBlock };
  if (def.grapple !== undefined) json["grapple"] = { range: def.grapple };
  if (FUEL_TICKS[def.id] !== undefined) json["fuel_ticks"] = FUEL_TICKS[def.id];
  const recipes = recipesByResult.get(def.id);
  if (recipes) json["recipes"] = recipes.map(toNewRecipe);

  writeFileSync(join(itemsDir, `${def.id}.json`), JSON.stringify(json, null, 2) + "\n");
  itemFiles.push(def.id);
}

// --- Blocks (Air stays an engine constant) ---
const blockFiles: string[] = [];
for (let id = 1 as BlockId; id <= 77; id++) {
  const def = blockDef(id);
  if (def.id === BlockId.Air && id !== BlockId.Air) continue; // unregistered gap
  const json: Record<string, unknown> = {
    id: def.name,
    name: pretty(def.name),
    solid: def.solid,
    hardness: def.hardness,
  };
  if (def.tool) json["tool"] = def.tool;
  if (def.requiredTier) json["required_tier"] = def.requiredTier;
  if (def.drops === null) json["drops"] = "none";
  else if (def.drops) json["drops"] = { item: def.drops.item, amount: def.drops.count };
  if (def.sidePermeable) json["side_permeable"] = true;
  if (def.slab) json["slab"] = true;
  if (def.tall) json["tall"] = true;
  if (def.toggleTo !== undefined) json["toggle_to"] = blockDef(def.toggleTo).name;
  if (def.liquid) json["liquid"] = def.liquid;
  writeFileSync(join(blocksDir, `${def.name}.json`), JSON.stringify(json, null, 2) + "\n");
  blockFiles.push(def.name);
}

// --- Generated index files ---
function writeIndex(dir: string, files: string[], exportName: string): void {
  const lines = [
    "// GENERATED by scripts/dump-datapack.ts - one import per data file.",
    "// Add a new file? Add its import here (or re-run the generator).",
    ...files.map((f, i) => `import d${i} from "./${f}.json";`),
    "",
    `export const ${exportName}: unknown[] = [${files.map((_, i) => `d${i}`).join(", ")}];`,
    "",
  ];
  writeFileSync(join(dir, "index.ts"), lines.join("\n"));
}
writeIndex(itemsDir, itemFiles, "ITEM_JSONS");
writeIndex(blocksDir, blockFiles, "BLOCK_JSONS");

console.log(`wrote ${itemFiles.length} items, ${blockFiles.length} blocks`);
