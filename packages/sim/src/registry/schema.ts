/**
 * Datapack schemas: every item and block is defined by a JSON file
 * (src/data/items/*.json, src/data/blocks/*.json - or, on a dedicated
 * server, DATA_DIR/datapack/...). Capabilities are optional components:
 * what isn't declared, the item can't do.
 *
 * Validation is strict - unknown fields or wrong types fail the load
 * with the source file named, so typos never fail silently.
 */

export interface RecipeJson {
  /** Where this recipe is crafted. */
  station: "inventory" | "crafting_table" | "furnace" | "brewing_stand";
  /** Crafting stations: shaped (position-independent) or shapeless. */
  style?: "shaped" | "shapeless";
  /** Shaped: pattern rows; letters index into `key`, spaces are blank. */
  recipe?: string[];
  /** Shaped: letter -> ingredient ref ("item:stick" / "tag:planks"). */
  key?: Record<string, string>;
  /** Shapeless + brewing: flat ingredient list. */
  ingredients?: string[];
  /** Furnace: the single input ingredient. */
  input?: string;
  /** Furnace: ticks per smelted item. */
  cooking_ticks?: number;
  /** Result count (default 1). */
  amount?: number;
}

export interface ItemJson {
  id: string;
  /** Display name (default: prettified id). */
  name?: string;
  max_stack?: number;
  /** Sprite path override (default sprites/item/<id>.png). */
  sprite?: string;
  /** Block id (string) this item places. */
  places_block?: string;
  tool?: { kind: "pickaxe" | "axe" | "shovel" | "sword" | "hammer"; tier: number; mining_speed: number };
  weapon?: { damage: number; knockback?: number };
  food?: { hunger: number; saturation?: number; eat_ticks?: number; returns?: string };
  armor?: { absorb: number };
  shield?: { block: number };
  grapple?: { range: number };
  effect?: { id: string; ticks: number; returns?: string };
  /** Container for scooping/pouring liquids; capacity in whole blocks. */
  bucket?: { capacity: number };
  /** Nested inventory this item carries (backpacks); slot count. */
  container?: { slots: number };
  fuel_ticks?: number;
  enchants?: string[];
  recipes?: RecipeJson[];
}

export interface BlockJson {
  id: string;
  name?: string;
  sprite?: string;
  solid: boolean;
  hardness: number;
  tool?: "pickaxe" | "axe" | "shovel";
  required_tier?: number;
  /** "none", or { item, amount }; default: 1x the block's own item. */
  drops?: "none" | { item: string; amount: number };
  side_permeable?: boolean;
  slab?: boolean;
  tall?: boolean;
  toggle_to?: string;
  liquid?: { kind: "water" | "lava"; level: number };
}

class SchemaError extends Error {
  constructor(source: string, message: string) {
    super(`datapack ${source}: ${message}`);
  }
}

function checkKeys(source: string, path: string, value: object, allowed: readonly string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new SchemaError(source, `unknown field "${path}${key}"`);
    }
  }
}

function need<T>(source: string, path: string, value: unknown, type: string): T {
  const actual = Array.isArray(value) ? "array" : typeof value;
  if (actual !== type) {
    throw new SchemaError(source, `"${path}" must be ${type}, got ${actual}`);
  }
  return value as T;
}

function needNumber(source: string, path: string, value: unknown, min: number, max: number): number {
  const n = need<number>(source, path, value, "number");
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new SchemaError(source, `"${path}" out of range [${min}, ${max}]`);
  }
  return n;
}

function needOneOf<T extends string>(source: string, path: string, value: unknown, options: readonly T[]): T {
  const s = need<string>(source, path, value, "string");
  if (!options.includes(s as T)) {
    throw new SchemaError(source, `"${path}" must be one of ${options.join("|")}, got "${s}"`);
  }
  return s as T;
}

const ID_PATTERN = /^[a-z0-9_]+$/;

function needId(source: string, path: string, value: unknown): string {
  const s = need<string>(source, path, value, "string");
  if (!ID_PATTERN.test(s)) {
    throw new SchemaError(source, `"${path}" must be a lowercase snake_case id, got "${s}"`);
  }
  return s;
}

/** "item:stick" or "tag:planks", namespace prefix optional. */
function needIngredientRef(source: string, path: string, value: unknown): string {
  const s = need<string>(source, path, value, "string");
  const cleaned = s.replace(/^flatcraft:/, "");
  if (!/^(item|tag):[a-z0-9_]+$/.test(cleaned)) {
    throw new SchemaError(source, `"${path}" must look like "item:stick" or "tag:planks", got "${s}"`);
  }
  return cleaned;
}

function validateRecipeJson(raw: unknown, source: string, index: number): RecipeJson {
  const path = `recipes[${index}].`;
  const value = need<Record<string, unknown>>(source, `recipes[${index}]`, raw, "object");
  checkKeys(source, path, value, ["station", "style", "recipe", "key", "ingredients", "input", "cooking_ticks", "amount"]);
  const station = needOneOf(source, `${path}station`, value["station"], ["inventory", "crafting_table", "furnace", "brewing_stand"] as const);
  const out: RecipeJson = { station };
  if (value["amount"] !== undefined) out.amount = needNumber(source, `${path}amount`, value["amount"], 1, 64);

  if (station === "furnace") {
    out.input = needIngredientRef(source, `${path}input`, value["input"]);
    if (value["cooking_ticks"] !== undefined) {
      out.cooking_ticks = needNumber(source, `${path}cooking_ticks`, value["cooking_ticks"], 1, 100_000);
    }
    return out;
  }
  if (station === "brewing_stand") {
    const list = need<unknown[]>(source, `${path}ingredients`, value["ingredients"], "array");
    out.ingredients = list.map((entry, i) => needIngredientRef(source, `${path}ingredients[${i}]`, entry));
    return out;
  }
  const style = needOneOf(source, `${path}style`, value["style"], ["shaped", "shapeless"] as const);
  out.style = style;
  if (style === "shapeless") {
    const list = need<unknown[]>(source, `${path}ingredients`, value["ingredients"], "array");
    if (list.length === 0 || list.length > 9) {
      throw new SchemaError(source, `${path}ingredients needs 1-9 entries`);
    }
    out.ingredients = list.map((entry, i) => needIngredientRef(source, `${path}ingredients[${i}]`, entry));
    return out;
  }
  const rows = need<unknown[]>(source, `${path}recipe`, value["recipe"], "array");
  if (rows.length === 0 || rows.length > 3) {
    throw new SchemaError(source, `${path}recipe needs 1-3 rows`);
  }
  out.recipe = rows.map((row, i) => {
    const s = need<string>(source, `${path}recipe[${i}]`, row, "string");
    if (s.length === 0 || s.length > 3) {
      throw new SchemaError(source, `${path}recipe[${i}] must be 1-3 characters`);
    }
    return s;
  });
  const key = need<Record<string, unknown>>(source, `${path}key`, value["key"], "object");
  out.key = {};
  for (const [letter, ref] of Object.entries(key)) {
    out.key[letter] = needIngredientRef(source, `${path}key.${letter}`, ref);
  }
  return out;
}

export function validateItemJson(raw: unknown, source: string): ItemJson {
  const value = need<Record<string, unknown>>(source, "(root)", raw, "object");
  checkKeys(source, "", value, [
    "id", "name", "max_stack", "sprite", "places_block", "tool", "weapon", "food",
    "armor", "shield", "grapple", "effect", "bucket", "container", "fuel_ticks", "enchants", "recipes",
  ]);
  const out: ItemJson = { id: needId(source, "id", value["id"]) };
  if (value["name"] !== undefined) out.name = need<string>(source, "name", value["name"], "string");
  if (value["max_stack"] !== undefined) out.max_stack = needNumber(source, "max_stack", value["max_stack"], 1, 64);
  if (value["sprite"] !== undefined) out.sprite = need<string>(source, "sprite", value["sprite"], "string");
  if (value["places_block"] !== undefined) out.places_block = needId(source, "places_block", value["places_block"]);
  if (value["tool"] !== undefined) {
    const tool = need<Record<string, unknown>>(source, "tool", value["tool"], "object");
    checkKeys(source, "tool.", tool, ["kind", "tier", "mining_speed"]);
    out.tool = {
      kind: needOneOf(source, "tool.kind", tool["kind"], ["pickaxe", "axe", "shovel", "sword", "hammer"] as const),
      tier: needNumber(source, "tool.tier", tool["tier"], 1, 8),
      mining_speed: needNumber(source, "tool.mining_speed", tool["mining_speed"], 1, 100),
    };
  }
  if (value["weapon"] !== undefined) {
    const weapon = need<Record<string, unknown>>(source, "weapon", value["weapon"], "object");
    checkKeys(source, "weapon.", weapon, ["damage", "knockback"]);
    out.weapon = { damage: needNumber(source, "weapon.damage", weapon["damage"], 0, 100) };
    if (weapon["knockback"] !== undefined) {
      out.weapon.knockback = needNumber(source, "weapon.knockback", weapon["knockback"], 0, 2);
    }
  }
  if (value["food"] !== undefined) {
    const food = need<Record<string, unknown>>(source, "food", value["food"], "object");
    checkKeys(source, "food.", food, ["hunger", "saturation", "eat_ticks", "returns"]);
    out.food = { hunger: needNumber(source, "food.hunger", food["hunger"], 0, 20) };
    if (food["saturation"] !== undefined) out.food.saturation = needNumber(source, "food.saturation", food["saturation"], 0, 20);
    if (food["eat_ticks"] !== undefined) out.food.eat_ticks = needNumber(source, "food.eat_ticks", food["eat_ticks"], 1, 200);
    if (food["returns"] !== undefined) out.food.returns = needId(source, "food.returns", food["returns"]);
  }
  if (value["armor"] !== undefined) {
    const armor = need<Record<string, unknown>>(source, "armor", value["armor"], "object");
    checkKeys(source, "armor.", armor, ["absorb"]);
    out.armor = { absorb: needNumber(source, "armor.absorb", armor["absorb"], 0, 0.95) };
  }
  if (value["shield"] !== undefined) {
    const shield = need<Record<string, unknown>>(source, "shield", value["shield"], "object");
    checkKeys(source, "shield.", shield, ["block"]);
    out.shield = { block: needNumber(source, "shield.block", shield["block"], 0, 0.95) };
  }
  if (value["grapple"] !== undefined) {
    const grapple = need<Record<string, unknown>>(source, "grapple", value["grapple"], "object");
    checkKeys(source, "grapple.", grapple, ["range"]);
    out.grapple = { range: needNumber(source, "grapple.range", grapple["range"], 1, 128) };
  }
  if (value["effect"] !== undefined) {
    const effect = need<Record<string, unknown>>(source, "effect", value["effect"], "object");
    checkKeys(source, "effect.", effect, ["id", "ticks", "returns"]);
    out.effect = {
      id: needId(source, "effect.id", effect["id"]),
      ticks: needNumber(source, "effect.ticks", effect["ticks"], 1, 1_000_000),
    };
    if (effect["returns"] !== undefined) out.effect.returns = needId(source, "effect.returns", effect["returns"]);
  }
  if (value["bucket"] !== undefined) {
    const bucket = need<Record<string, unknown>>(source, "bucket", value["bucket"], "object");
    checkKeys(source, "bucket.", bucket, ["capacity"]);
    out.bucket = { capacity: needNumber(source, "bucket.capacity", bucket["capacity"], 1, 64) };
  }
  if (value["container"] !== undefined) {
    const container = need<Record<string, unknown>>(source, "container", value["container"], "object");
    checkKeys(source, "container.", container, ["slots"]);
    out.container = { slots: needNumber(source, "container.slots", container["slots"], 1, 54) };
  }
  if (value["fuel_ticks"] !== undefined) out.fuel_ticks = needNumber(source, "fuel_ticks", value["fuel_ticks"], 1, 100_000);
  if (value["enchants"] !== undefined) {
    const list = need<unknown[]>(source, "enchants", value["enchants"], "array");
    out.enchants = list.map((entry, i) => needId(source, `enchants[${i}]`, entry));
  }
  if (value["recipes"] !== undefined) {
    const list = need<unknown[]>(source, "recipes", value["recipes"], "array");
    out.recipes = list.map((entry, i) => validateRecipeJson(entry, source, i));
  }
  return out;
}

export function validateBlockJson(raw: unknown, source: string): BlockJson {
  const value = need<Record<string, unknown>>(source, "(root)", raw, "object");
  checkKeys(source, "", value, [
    "id", "name", "sprite", "solid", "hardness", "tool", "required_tier", "drops",
    "side_permeable", "slab", "tall", "toggle_to", "liquid",
  ]);
  const out: BlockJson = {
    id: needId(source, "id", value["id"]),
    solid: need<boolean>(source, "solid", value["solid"], "boolean"),
    hardness: needNumber(source, "hardness", value["hardness"], -1, 100_000),
  };
  if (value["name"] !== undefined) out.name = need<string>(source, "name", value["name"], "string");
  if (value["sprite"] !== undefined) out.sprite = need<string>(source, "sprite", value["sprite"], "string");
  if (value["tool"] !== undefined) out.tool = needOneOf(source, "tool", value["tool"], ["pickaxe", "axe", "shovel"] as const);
  if (value["required_tier"] !== undefined) out.required_tier = needNumber(source, "required_tier", value["required_tier"], 0, 8);
  if (value["drops"] !== undefined) {
    if (value["drops"] === "none") {
      out.drops = "none";
    } else {
      const drops = need<Record<string, unknown>>(source, "drops", value["drops"], "object");
      checkKeys(source, "drops.", drops, ["item", "amount"]);
      out.drops = {
        item: needId(source, "drops.item", drops["item"]),
        amount: needNumber(source, "drops.amount", drops["amount"], 1, 64),
      };
    }
  }
  for (const flag of ["side_permeable", "slab", "tall"] as const) {
    if (value[flag] !== undefined) out[flag] = need<boolean>(source, flag, value[flag], "boolean");
  }
  if (value["toggle_to"] !== undefined) out.toggle_to = needId(source, "toggle_to", value["toggle_to"]);
  if (value["liquid"] !== undefined) {
    const liquid = need<Record<string, unknown>>(source, "liquid", value["liquid"], "object");
    checkKeys(source, "liquid.", liquid, ["kind", "level"]);
    out.liquid = {
      kind: needOneOf(source, "liquid.kind", liquid["kind"], ["water", "lava"] as const),
      level: needNumber(source, "liquid.level", liquid["level"], 1, 8),
    };
  }
  return out;
}
