import { BLOCK_JSONS } from "../data/blocks/index.js";
import { validateBlockJson } from "../registry/schema.js";
import type { VisualDef } from "../registry/visual.js";

/**
 * Block registry. The canonical identity of a block is its string id
 * ("copper_ore"); definitions live in datapack JSON files
 * (src/data/blocks/*.json, see registry/schema.ts).
 *
 * The numeric BlockId enum below is a runtime detail: chunks store
 * blocks as uint16 for compact storage/network transfer. Engine code may
 * use the enum constants; persisted data never depends on the numbers -
 * saves carry an id->name palette and are remapped by name on load.
 * Datapack blocks unknown to the enum get dynamic ids (>= 78).
 */
export enum BlockId {
  Air = 0,
  Stone = 1,
  Dirt = 2,
  Grass = 3,
  Bedrock = 4,
  Sand = 5,
  Sandstone = 6,
  Gravel = 7,
  Water = 8,
  OakLog = 9,
  OakLeaves = 10,
  Snow = 11,
  CoalOre = 12,
  IronOre = 13,
  GoldOre = 14,
  LapisOre = 15,
  RedstoneOre = 16,
  DiamondOre = 17,
  EmeraldOre = 18,
  OakPlanks = 19,
  CraftingTable = 20,
  Cobblestone = 21,
  Furnace = 22,
  Glass = 23,
  Netherrack = 24,
  SoulSand = 25,
  Glowstone = 26,
  Obsidian = 27,
  NetherPortal = 28,
  Lava = 29,
  Basalt = 30,
  Chest = 31,
  BrewingStand = 32,
  EnchantingTable = 33,
  CopperOre = 34,
  AncientDebris = 35,
  /** Portal frame obsidian: passable from the side, solid from above. */
  PortalFrame = 36,
  BirchLog = 37,
  BirchLeaves = 38,
  BirchPlanks = 39,
  SpruceLog = 40,
  SpruceLeaves = 41,
  SprucePlanks = 42,
  OakStairs = 43,
  OakSlab = 44,
  OakFence = 45,
  OakDoor = 46,
  OakDoorOpen = 47,
  OakTrapdoor = 48,
  OakTrapdoorOpen = 49,
  BirchStairs = 50,
  BirchSlab = 51,
  BirchFence = 52,
  BirchDoor = 53,
  BirchDoorOpen = 54,
  BirchTrapdoor = 55,
  BirchTrapdoorOpen = 56,
  SpruceStairs = 57,
  SpruceSlab = 58,
  SpruceFence = 59,
  SpruceDoor = 60,
  SpruceDoorOpen = 61,
  SpruceTrapdoor = 62,
  SpruceTrapdoorOpen = 63,
  /** Partial water/lava: levels 1..7 (8 = the full Water/Lava blocks). */
  Water1 = 64,
  Water2 = 65,
  Water3 = 66,
  Water4 = 67,
  Water5 = 68,
  Water6 = 69,
  Water7 = 70,
  Lava1 = 71,
  Lava2 = 72,
  Lava3 = 73,
  Lava4 = 74,
  Lava5 = 75,
  Lava6 = 76,
  Lava7 = 77,
  /** Clay: mined for raw Clay, fired in a furnace into Fired Clay. */
  Clay = 78,
}

export interface BlockDef {
  readonly id: BlockId;
  /** Canonical string id ("copper_ore"). */
  readonly name: string;
  /** Human-readable display name. */
  readonly displayName: string;
  readonly solid: boolean;
  /** Base mining time in ticks; -1 = unbreakable (and not placeable). */
  readonly hardness: number;
  /**
   * What breaking this block yields. Omitted = an item with the block's
   * own name; null = nothing (e.g. leaves).
   */
  readonly drops?: { item: string; count: number } | null;
  /** The tool kind that mines this block faster. */
  readonly tool?: "pickaxe" | "axe" | "shovel";
  /**
   * Minimum tier of the matching tool needed to get drops (Minecraft
   * rule: stone-family blocks yield nothing when punched bare-handed).
   * Omitted/0 = always drops.
   */
  readonly requiredTier?: number;
  /** Passable horizontally, solid vertically (portal frame obsidian). */
  readonly sidePermeable?: boolean;
  /** Half-height block: only catches bodies landing onto its top. */
  readonly slab?: boolean;
  /** Doors/trapdoors: right-clicking swaps to this block id. */
  readonly toggleTo?: BlockId;
  /** Doors occupy this tile and the one above. */
  readonly tall?: boolean;
  /** Flowing liquid: kind and fill level 1..8. */
  readonly liquid?: { kind: "water" | "lava"; level: number };
  /** Opens a chest-style storage screen with this many slots. */
  readonly container?: number;
  /** Opens a furnace-style cook screen; speed scales burn/cook rate. */
  readonly furnace?: { speed: number };
  /** Sprite path override (default sprites/block/<name>.png). */
  readonly sprite?: string;
  /** Sprite variants/animation/shader. */
  readonly visual?: VisualDef;
}

const defs = new Map<BlockId, BlockDef>();
const byName = new Map<string, BlockId>();
/** toggle_to targets may be registered later; resolved in a second pass. */
const pendingToggles: Array<{ id: BlockId; target: string; source: string }> = [];
/** Datapack blocks outside the enum get ids from here. */
let nextDynamicId = 79;

/** "OakDoorOpen" -> "oak_door_open", "Water1" -> "water_1". */
function enumKeyToId(key: string): string {
  return key.replace(/([a-z])([A-Z0-9])/g, "$1_$2").toLowerCase();
}

const BUILTIN_IDS = new Map<string, BlockId>();
for (const [key, value] of Object.entries(BlockId)) {
  if (typeof value === "number") {
    BUILTIN_IDS.set(enumKeyToId(key), value as BlockId);
  }
}

/** Air is an engine constant, not a data file. */
const AIR: BlockDef = { id: BlockId.Air, name: "air", displayName: "Air", solid: false, hardness: 0 };
defs.set(BlockId.Air, AIR);
byName.set("air", BlockId.Air);

/** Register a block from datapack JSON. Known names keep their enum id;
 * new names get a dynamic id. Call resolveBlockLinks() after a batch. */
export function registerBlockJson(raw: unknown, source = "datapack"): BlockDef {
  const json = validateBlockJson(raw, source);
  const id = byName.get(json.id) ?? BUILTIN_IDS.get(json.id) ?? (nextDynamicId++ as BlockId);
  const def: BlockDef = {
    id,
    name: json.id,
    displayName: json.name ?? json.id,
    solid: json.solid,
    hardness: json.hardness,
    ...(json.tool !== undefined ? { tool: json.tool } : {}),
    ...(json.required_tier !== undefined ? { requiredTier: json.required_tier } : {}),
    ...(json.drops === "none"
      ? { drops: null }
      : json.drops !== undefined
        ? { drops: { item: json.drops.item, count: json.drops.amount } }
        : {}),
    ...(json.side_permeable ? { sidePermeable: true } : {}),
    ...(json.slab ? { slab: true } : {}),
    ...(json.tall ? { tall: true } : {}),
    ...(json.liquid !== undefined ? { liquid: json.liquid } : {}),
    ...(json.container !== undefined ? { container: json.container.slots } : {}),
    ...(json.furnace !== undefined ? { furnace: { speed: json.furnace.speed ?? 1 } } : {}),
    ...(json.sprite !== undefined ? { sprite: json.sprite } : {}),
    ...(json.visual !== undefined ? { visual: json.visual } : {}),
  };
  defs.set(id, def);
  byName.set(json.id, id);
  if (json.toggle_to !== undefined) {
    pendingToggles.push({ id, target: json.toggle_to, source });
  }
  return def;
}

/** Resolve door/trapdoor toggle targets once all blocks are registered. */
export function resolveBlockLinks(): void {
  while (pendingToggles.length > 0) {
    const { id, target, source } = pendingToggles.pop()!;
    const targetId = byName.get(target);
    if (targetId === undefined) {
      throw new Error(`datapack ${source}: toggle_to target "${target}" is not a known block`);
    }
    defs.set(id, { ...defs.get(id)!, toggleTo: targetId });
  }
}

for (const raw of BLOCK_JSONS) {
  registerBlockJson(raw, "builtin");
}
resolveBlockLinks();

export function blockDef(id: BlockId): BlockDef {
  return defs.get(id) ?? AIR;
}

export function blockByName(name: string): BlockId | undefined {
  return byName.get(name);
}

export function allBlocks(): Iterable<BlockDef> {
  return defs.values();
}

/** The item stack breaking this block yields, or null for nothing. */
export function blockDrops(id: BlockId): { item: string; count: number } | null {
  const def = defs.get(id);
  if (!def || def.id === BlockId.Air) return null;
  if (def.drops === null) return null;
  return def.drops ?? { item: def.name, count: 1 };
}

/** The block id representing this liquid kind at the given level 1..8. */
export function liquidBlock(kind: "water" | "lava", level: number): BlockId {
  if (level >= 8) return kind === "water" ? BlockId.Water : BlockId.Lava;
  const base = kind === "water" ? BlockId.Water1 : BlockId.Lava1;
  return (base + level - 1) as BlockId;
}
