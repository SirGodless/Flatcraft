/**
 * Datapack schemas: every item and block is defined by a JSON file
 * (src/data/items/*.json, src/data/blocks/*.json - or, on a dedicated
 * server, DATA_DIR/datapack/...). Capabilities are optional components:
 * what isn't declared, the item can't do.
 *
 * Validation is strict - unknown fields or wrong types fail the load
 * with the source file named, so typos never fail silently.
 */

export interface AnimationClipJson {
  /** Total frame count in this state's strip. */
  frames: number;
  /** Pixel width of one frame (frames tile horizontally in the sheet). */
  frame_width: number;
  fps: number;
  /** Loop (idle/walk) or play once and hold/signal done (hurt/death). Default true. */
  loop?: boolean;
}

export interface VisualJson {
  /** Declared count of numbered sprite variants at the sprite's base
   * path (sprites/<type>/<id>_0.png .. _<variants-1>.png), for visual
   * variety (e.g. ore that doesn't look identical every tile). Default
   * 1 (today's single-sprite behavior). */
  variants?: number;
  /** Named animation states (idle/walk/hurt/death/...), each its own
   * sprite-sheet strip. */
  animation?: { states: Record<string, AnimationClipJson> };
  /** A named client-side shader effect (e.g. "shimmer"); unknown ids
   * simply render with no effect, same as a missing sprite falls back
   * to the procedural shape - never an error. */
  shader?: { id: string; params?: Record<string, number | string | boolean> };
}

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
  /** Variants/animation/shader - see VisualJson. */
  visual?: VisualJson;
  /** Block id (string) this item places. */
  places_block?: string;
  tool?: { kind: "pickaxe" | "axe" | "shovel" | "sword" | "hammer"; tier: number; mining_speed: number };
  weapon?: { damage: number; knockback?: number };
  /** Fires an ammo item as an arrow entity on the "shoot" command. */
  ranged?: { damage: number; cooldown_ticks: number; arrow_speed: number; ammo: string };
  food?: { hunger: number; saturation?: number; eat_ticks?: number; returns?: string };
  armor?: { absorb: number };
  shield?: { block: number };
  grapple?: { range: number };
  /** Held while falling + jump: slows descent, boosts horizontal speed. */
  glider?: { sink: number; glide_boost: number };
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
  /** Variants/animation/shader - see VisualJson. */
  visual?: VisualJson;
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
  /** Opens a chest-style storage screen with this many slots. */
  container?: { slots: number };
  /** Opens a furnace-style cook screen. speed scales burn/cook rate
   * (2 = a blast furnace that burns and cooks twice as fast). */
  furnace?: { speed?: number };
  /** Marks this block as the one providing a named station (e.g.
   * "crafting_table", "brewing_stand", "enchanting_table") - recipes/
   * actions that require that station look this up generically instead
   * of naming a block id. */
  station?: string;
  /** Standing on this block multiplies horizontal speed (< 1 slows,
   * e.g. soul sand). */
  movement_slow?: number;
  /** Survives an explosion whose damage falls below this (default:
   * hardness, today's behavior). */
  blast_resistance?: number;
  /** Replaces the normal drop with this item at this chance instead
   * (e.g. gravel sometimes drops flint). */
  alt_drop?: { item: string; amount: number; chance: number };
}

export interface MobJson {
  id: string;
  name?: string;
  sprite?: string;
  /** Variants/animation/shader - see VisualJson. */
  visual?: VisualJson;
  health: number;
  speed: number;
  size: { width: number; height: number };
  /** Chases within follow_range and hits on contact. */
  melee?: { damage: number; cooldown: number; follow_range: number };
  /** Kites: backs off closer than kite_near, closes in past kite_far,
   * fires an arrow whenever in range and off cooldown. */
  ranged?: { damage: number; range: number; shoot_cooldown: number; kite_near: number; kite_far: number };
  /** Approaches within follow_range, ignites within trigger_range, counts
   * down fuse_ticks, then blows. */
  explodes?: { follow_range: number; trigger_range: number; fuse_ticks: number; block_radius: number; damage_radius: number; max_damage: number };
  /** Ambles in a random direction, changing every so often. */
  wanders?: boolean;
  /** Undead: takes damage standing in daylight (dimensions with has_sky). */
  burns_in_daylight?: boolean;
  /** Can be right-clicked to open the trade panel (see data/trades). */
  trades?: boolean;
  /** Death drops: item, max count (1..max rolled), chance. */
  loot?: Array<{ item: string; max: number; chance: number }>;
  /** Gear this mob spawns wearing (armor absorbs damage, offhand blocks
   * like a shield) - dropped again on death, same as a player's. */
  equipment?: { armor?: string; offhand?: string };
  /** Natural-spawn eligibility. group buckets this mob into one of the
   * pools stepSpawning already rolls against; weight repeats it within
   * that pool (2 = twice as likely as weight 1). near_structure anchors
   * spawning to a placed structure (villagers appear near houses)
   * instead of the ambient roll. */
  spawn?: {
    group?: "hostile_surface" | "grass_day" | "nether_pocket";
    weight?: number;
    near_structure?: string;
  };
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

function validateAnimationClipJson(raw: unknown, source: string, path: string): AnimationClipJson {
  const value = need<Record<string, unknown>>(source, path, raw, "object");
  checkKeys(source, `${path}.`, value, ["frames", "frame_width", "fps", "loop"]);
  const out: AnimationClipJson = {
    frames: needNumber(source, `${path}.frames`, value["frames"], 1, 64),
    frame_width: needNumber(source, `${path}.frame_width`, value["frame_width"], 2, 128),
    fps: needNumber(source, `${path}.fps`, value["fps"], 1, 60),
  };
  if (value["loop"] !== undefined) out.loop = need<boolean>(source, `${path}.loop`, value["loop"], "boolean");
  return out;
}

/** Shared `visual` sub-validator, called identically from items/blocks/mobs
 * - see VisualJson for field meanings. */
function validateVisualJson(raw: unknown, source: string): VisualJson {
  const value = need<Record<string, unknown>>(source, "visual", raw, "object");
  checkKeys(source, "visual.", value, ["variants", "animation", "shader"]);
  const out: VisualJson = {};
  if (value["variants"] !== undefined) {
    out.variants = needNumber(source, "visual.variants", value["variants"], 1, 16);
  }
  if (value["animation"] !== undefined) {
    const animation = need<Record<string, unknown>>(source, "visual.animation", value["animation"], "object");
    checkKeys(source, "visual.animation.", animation, ["states"]);
    const states = need<Record<string, unknown>>(source, "visual.animation.states", animation["states"], "object");
    const outStates: Record<string, AnimationClipJson> = {};
    for (const [name, clip] of Object.entries(states)) {
      if (!ID_PATTERN.test(name)) {
        throw new SchemaError(source, `"visual.animation.states" key "${name}" must be a lowercase snake_case id`);
      }
      outStates[name] = validateAnimationClipJson(clip, source, `visual.animation.states.${name}`);
    }
    out.animation = { states: outStates };
  }
  if (value["shader"] !== undefined) {
    const shader = need<Record<string, unknown>>(source, "visual.shader", value["shader"], "object");
    checkKeys(source, "visual.shader.", shader, ["id", "params"]);
    out.shader = { id: needId(source, "visual.shader.id", shader["id"]) };
    if (shader["params"] !== undefined) {
      const params = need<Record<string, unknown>>(source, "visual.shader.params", shader["params"], "object");
      const outParams: Record<string, number | string | boolean> = {};
      for (const [key, entry] of Object.entries(params)) {
        if (typeof entry !== "number" && typeof entry !== "string" && typeof entry !== "boolean") {
          throw new SchemaError(source, `"visual.shader.params.${key}" must be a number, string, or boolean`);
        }
        outParams[key] = entry;
      }
      out.shader.params = outParams;
    }
  }
  return out;
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
    "id", "name", "max_stack", "sprite", "visual", "places_block", "tool", "weapon", "ranged", "food",
    "armor", "shield", "grapple", "glider", "effect", "bucket", "container", "fuel_ticks", "enchants", "recipes",
  ]);
  const out: ItemJson = { id: needId(source, "id", value["id"]) };
  if (value["name"] !== undefined) out.name = need<string>(source, "name", value["name"], "string");
  if (value["max_stack"] !== undefined) out.max_stack = needNumber(source, "max_stack", value["max_stack"], 1, 64);
  if (value["sprite"] !== undefined) out.sprite = need<string>(source, "sprite", value["sprite"], "string");
  if (value["visual"] !== undefined) out.visual = validateVisualJson(value["visual"], source);
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
  if (value["ranged"] !== undefined) {
    const ranged = need<Record<string, unknown>>(source, "ranged", value["ranged"], "object");
    checkKeys(source, "ranged.", ranged, ["damage", "cooldown_ticks", "arrow_speed", "ammo"]);
    out.ranged = {
      damage: needNumber(source, "ranged.damage", ranged["damage"], 0, 100),
      cooldown_ticks: needNumber(source, "ranged.cooldown_ticks", ranged["cooldown_ticks"], 1, 1000),
      arrow_speed: needNumber(source, "ranged.arrow_speed", ranged["arrow_speed"], 0.01, 10),
      ammo: needId(source, "ranged.ammo", ranged["ammo"]),
    };
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
  if (value["glider"] !== undefined) {
    const glider = need<Record<string, unknown>>(source, "glider", value["glider"], "object");
    checkKeys(source, "glider.", glider, ["sink", "glide_boost"]);
    out.glider = {
      sink: needNumber(source, "glider.sink", glider["sink"], 0, 1),
      glide_boost: needNumber(source, "glider.glide_boost", glider["glide_boost"], 0, 10),
    };
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
    "id", "name", "sprite", "visual", "solid", "hardness", "tool", "required_tier", "drops",
    "side_permeable", "slab", "tall", "toggle_to", "liquid", "container", "furnace",
    "station", "movement_slow", "blast_resistance", "alt_drop",
  ]);
  const out: BlockJson = {
    id: needId(source, "id", value["id"]),
    solid: need<boolean>(source, "solid", value["solid"], "boolean"),
    hardness: needNumber(source, "hardness", value["hardness"], -1, 100_000),
  };
  if (value["name"] !== undefined) out.name = need<string>(source, "name", value["name"], "string");
  if (value["sprite"] !== undefined) out.sprite = need<string>(source, "sprite", value["sprite"], "string");
  if (value["visual"] !== undefined) out.visual = validateVisualJson(value["visual"], source);
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
  if (value["container"] !== undefined) {
    const container = need<Record<string, unknown>>(source, "container", value["container"], "object");
    checkKeys(source, "container.", container, ["slots"]);
    out.container = { slots: needNumber(source, "container.slots", container["slots"], 1, 54) };
  }
  if (value["furnace"] !== undefined) {
    const furnace = need<Record<string, unknown>>(source, "furnace", value["furnace"], "object");
    checkKeys(source, "furnace.", furnace, ["speed"]);
    out.furnace = {};
    if (furnace["speed"] !== undefined) out.furnace.speed = needNumber(source, "furnace.speed", furnace["speed"], 0.1, 100);
  }
  if (value["station"] !== undefined) out.station = needId(source, "station", value["station"]);
  if (value["movement_slow"] !== undefined) {
    out.movement_slow = needNumber(source, "movement_slow", value["movement_slow"], 0, 1);
  }
  if (value["blast_resistance"] !== undefined) {
    out.blast_resistance = needNumber(source, "blast_resistance", value["blast_resistance"], -1, 100_000);
  }
  if (value["alt_drop"] !== undefined) {
    const altDrop = need<Record<string, unknown>>(source, "alt_drop", value["alt_drop"], "object");
    checkKeys(source, "alt_drop.", altDrop, ["item", "amount", "chance"]);
    out.alt_drop = {
      item: needId(source, "alt_drop.item", altDrop["item"]),
      amount: needNumber(source, "alt_drop.amount", altDrop["amount"], 1, 64),
      chance: needNumber(source, "alt_drop.chance", altDrop["chance"], 0, 1),
    };
  }
  return out;
}

export function validateMobJson(raw: unknown, source: string): MobJson {
  const value = need<Record<string, unknown>>(source, "(root)", raw, "object");
  checkKeys(source, "", value, [
    "id", "name", "sprite", "visual", "health", "speed", "size", "melee", "ranged",
    "explodes", "wanders", "burns_in_daylight", "trades", "loot", "equipment", "spawn",
  ]);
  const size = need<Record<string, unknown>>(source, "size", value["size"], "object");
  checkKeys(source, "size.", size, ["width", "height"]);
  const out: MobJson = {
    id: needId(source, "id", value["id"]),
    health: needNumber(source, "health", value["health"], 1, 10_000),
    speed: needNumber(source, "speed", value["speed"], 0, 10),
    size: {
      width: needNumber(source, "size.width", size["width"], 0.1, 10),
      height: needNumber(source, "size.height", size["height"], 0.1, 10),
    },
  };
  if (value["name"] !== undefined) out.name = need<string>(source, "name", value["name"], "string");
  if (value["sprite"] !== undefined) out.sprite = need<string>(source, "sprite", value["sprite"], "string");
  if (value["visual"] !== undefined) out.visual = validateVisualJson(value["visual"], source);
  if (value["melee"] !== undefined) {
    const melee = need<Record<string, unknown>>(source, "melee", value["melee"], "object");
    checkKeys(source, "melee.", melee, ["damage", "cooldown", "follow_range"]);
    out.melee = {
      damage: needNumber(source, "melee.damage", melee["damage"], 0, 1000),
      cooldown: needNumber(source, "melee.cooldown", melee["cooldown"], 1, 1000),
      follow_range: needNumber(source, "melee.follow_range", melee["follow_range"], 1, 256),
    };
  }
  if (value["ranged"] !== undefined) {
    const ranged = need<Record<string, unknown>>(source, "ranged", value["ranged"], "object");
    checkKeys(source, "ranged.", ranged, ["damage", "range", "shoot_cooldown", "kite_near", "kite_far"]);
    out.ranged = {
      damage: needNumber(source, "ranged.damage", ranged["damage"], 0, 1000),
      range: needNumber(source, "ranged.range", ranged["range"], 1, 256),
      shoot_cooldown: needNumber(source, "ranged.shoot_cooldown", ranged["shoot_cooldown"], 1, 1000),
      kite_near: needNumber(source, "ranged.kite_near", ranged["kite_near"], 0, 256),
      kite_far: needNumber(source, "ranged.kite_far", ranged["kite_far"], 0, 256),
    };
  }
  if (value["explodes"] !== undefined) {
    const explodes = need<Record<string, unknown>>(source, "explodes", value["explodes"], "object");
    checkKeys(source, "explodes.", explodes, ["follow_range", "trigger_range", "fuse_ticks", "block_radius", "damage_radius", "max_damage"]);
    out.explodes = {
      follow_range: needNumber(source, "explodes.follow_range", explodes["follow_range"], 0, 256),
      trigger_range: needNumber(source, "explodes.trigger_range", explodes["trigger_range"], 0, 256),
      fuse_ticks: needNumber(source, "explodes.fuse_ticks", explodes["fuse_ticks"], 1, 1000),
      block_radius: needNumber(source, "explodes.block_radius", explodes["block_radius"], 0, 64),
      damage_radius: needNumber(source, "explodes.damage_radius", explodes["damage_radius"], 0, 64),
      max_damage: needNumber(source, "explodes.max_damage", explodes["max_damage"], 0, 1000),
    };
  }
  if (value["wanders"] !== undefined) out.wanders = need<boolean>(source, "wanders", value["wanders"], "boolean");
  if (value["burns_in_daylight"] !== undefined) {
    out.burns_in_daylight = need<boolean>(source, "burns_in_daylight", value["burns_in_daylight"], "boolean");
  }
  if (value["trades"] !== undefined) out.trades = need<boolean>(source, "trades", value["trades"], "boolean");
  if (value["loot"] !== undefined) {
    const list = need<unknown[]>(source, "loot", value["loot"], "array");
    out.loot = list.map((entry, i) => {
      const path = `loot[${i}].`;
      const drop = need<Record<string, unknown>>(source, `loot[${i}]`, entry, "object");
      checkKeys(source, path, drop, ["item", "max", "chance"]);
      return {
        item: needId(source, `${path}item`, drop["item"]),
        max: needNumber(source, `${path}max`, drop["max"], 1, 64),
        chance: needNumber(source, `${path}chance`, drop["chance"], 0, 1),
      };
    });
  }
  if (value["equipment"] !== undefined) {
    const equipment = need<Record<string, unknown>>(source, "equipment", value["equipment"], "object");
    checkKeys(source, "equipment.", equipment, ["armor", "offhand"]);
    out.equipment = {};
    if (equipment["armor"] !== undefined) out.equipment.armor = needId(source, "equipment.armor", equipment["armor"]);
    if (equipment["offhand"] !== undefined) out.equipment.offhand = needId(source, "equipment.offhand", equipment["offhand"]);
  }
  if (value["spawn"] !== undefined) {
    const spawn = need<Record<string, unknown>>(source, "spawn", value["spawn"], "object");
    checkKeys(source, "spawn.", spawn, ["group", "weight", "near_structure"]);
    out.spawn = {};
    if (spawn["group"] !== undefined) {
      out.spawn.group = needOneOf(source, "spawn.group", spawn["group"], ["hostile_surface", "grass_day", "nether_pocket"] as const);
    }
    if (spawn["weight"] !== undefined) out.spawn.weight = needNumber(source, "spawn.weight", spawn["weight"], 1, 100);
    if (spawn["near_structure"] !== undefined) out.spawn.near_structure = needId(source, "spawn.near_structure", spawn["near_structure"]);
  }
  return out;
}
