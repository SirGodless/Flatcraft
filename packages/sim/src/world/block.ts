/**
 * Block type ids. Stored per tile as a uint16, so the registry can grow to
 * cover the full 1.16-era content set without changing the storage format.
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
}

export interface BlockDef {
  readonly id: BlockId;
  readonly name: string;
  readonly solid: boolean;
  /** Base mining time in ticks; -1 = unbreakable (and not placeable). */
  readonly hardness: number;
  /**
   * What breaking this block yields. Omitted = an item with the block's
   * own name; null = nothing (e.g. leaves for now).
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
}

const defs = new Map<BlockId, BlockDef>();

function register(def: BlockDef): BlockDef {
  defs.set(def.id, def);
  return def;
}

export const Blocks = {
  air: register({ id: BlockId.Air, name: "air", solid: false, hardness: 0 }),
  stone: register({ id: BlockId.Stone, name: "stone", solid: true, hardness: 30, drops: { item: "cobblestone", count: 1 }, tool: "pickaxe", requiredTier: 1 }),
  dirt: register({ id: BlockId.Dirt, name: "dirt", solid: true, hardness: 10, tool: "shovel" }),
  grass: register({ id: BlockId.Grass, name: "grass", solid: true, hardness: 12, drops: { item: "dirt", count: 1 }, tool: "shovel" }),
  bedrock: register({ id: BlockId.Bedrock, name: "bedrock", solid: true, hardness: -1, drops: null }),
  sand: register({ id: BlockId.Sand, name: "sand", solid: true, hardness: 8, tool: "shovel" }),
  sandstone: register({ id: BlockId.Sandstone, name: "sandstone", solid: true, hardness: 24, tool: "pickaxe", requiredTier: 1 }),
  gravel: register({ id: BlockId.Gravel, name: "gravel", solid: true, hardness: 9, tool: "shovel" }),
  // Static for now; fluid flow (and buckets) come later, so water can be
  // neither broken nor placed (hardness -1).
  water: register({ id: BlockId.Water, name: "water", solid: false, hardness: -1, drops: null }),
  // Trees are background scenery in a 2D world: they never block movement.
  oakLog: register({ id: BlockId.OakLog, name: "oak_log", solid: false, hardness: 25, tool: "axe" }),
  oakLeaves: register({ id: BlockId.OakLeaves, name: "oak_leaves", solid: false, hardness: 3, drops: null }),
  snow: register({ id: BlockId.Snow, name: "snow", solid: true, hardness: 6, tool: "shovel" }),
  coalOre: register({ id: BlockId.CoalOre, name: "coal_ore", solid: true, hardness: 35, drops: { item: "coal", count: 1 }, tool: "pickaxe", requiredTier: 1 }),
  ironOre: register({ id: BlockId.IronOre, name: "iron_ore", solid: true, hardness: 40, tool: "pickaxe", requiredTier: 2 }),
  goldOre: register({ id: BlockId.GoldOre, name: "gold_ore", solid: true, hardness: 40, tool: "pickaxe", requiredTier: 3 }),
  lapisOre: register({ id: BlockId.LapisOre, name: "lapis_ore", solid: true, hardness: 40, drops: { item: "lapis_lazuli", count: 6 }, tool: "pickaxe", requiredTier: 2 }),
  redstoneOre: register({ id: BlockId.RedstoneOre, name: "redstone_ore", solid: true, hardness: 40, drops: { item: "redstone", count: 4 }, tool: "pickaxe", requiredTier: 3 }),
  diamondOre: register({ id: BlockId.DiamondOre, name: "diamond_ore", solid: true, hardness: 45, drops: { item: "diamond", count: 1 }, tool: "pickaxe", requiredTier: 3 }),
  emeraldOre: register({ id: BlockId.EmeraldOre, name: "emerald_ore", solid: true, hardness: 45, drops: { item: "emerald", count: 1 }, tool: "pickaxe", requiredTier: 3 }),
  oakPlanks: register({ id: BlockId.OakPlanks, name: "oak_planks", solid: true, hardness: 30, tool: "axe" }),
  craftingTable: register({ id: BlockId.CraftingTable, name: "crafting_table", solid: true, hardness: 30, tool: "axe" }),
  cobblestone: register({ id: BlockId.Cobblestone, name: "cobblestone", solid: true, hardness: 32, tool: "pickaxe", requiredTier: 1 }),
  furnace: register({ id: BlockId.Furnace, name: "furnace", solid: true, hardness: 35, tool: "pickaxe", requiredTier: 1 }),
  // Like Minecraft, glass shatters: it drops nothing.
  glass: register({ id: BlockId.Glass, name: "glass", solid: true, hardness: 5, drops: null }),
  netherrack: register({ id: BlockId.Netherrack, name: "netherrack", solid: true, hardness: 8, tool: "pickaxe", requiredTier: 1 }),
  soulSand: register({ id: BlockId.SoulSand, name: "soul_sand", solid: true, hardness: 10, tool: "shovel" }),
  glowstone: register({ id: BlockId.Glowstone, name: "glowstone", solid: true, hardness: 6, drops: { item: "glowstone_dust", count: 3 } }),
  obsidian: register({ id: BlockId.Obsidian, name: "obsidian", solid: true, hardness: 250, tool: "pickaxe", requiredTier: 4 }),
  // Portal blocks are placed/removed by portal logic, never mined.
  netherPortal: register({ id: BlockId.NetherPortal, name: "nether_portal", solid: false, hardness: -1, drops: null }),
  // Static lava; damages anything inside it. Not minable or placeable.
  lava: register({ id: BlockId.Lava, name: "lava", solid: false, hardness: -1, drops: null }),
  basalt: register({ id: BlockId.Basalt, name: "basalt", solid: true, hardness: 25, tool: "pickaxe", requiredTier: 1 }),
  chest: register({ id: BlockId.Chest, name: "chest", solid: true, hardness: 25, tool: "axe" }),
  brewingStand: register({ id: BlockId.BrewingStand, name: "brewing_stand", solid: true, hardness: 20, tool: "pickaxe" }),
  enchantingTable: register({ id: BlockId.EnchantingTable, name: "enchanting_table", solid: true, hardness: 40, tool: "pickaxe", requiredTier: 1 }),
} as const;

export function blockDef(id: BlockId): BlockDef {
  return defs.get(id) ?? Blocks.air;
}

export function blockByName(name: string): BlockId | undefined {
  for (const def of defs.values()) {
    if (def.name === name) return def.id;
  }
  return undefined;
}

/** The item stack breaking this block yields, or null for nothing. */
export function blockDrops(id: BlockId): { item: string; count: number } | null {
  const def = defs.get(id);
  if (!def || def.id === BlockId.Air) return null;
  if (def.drops === null) return null;
  return def.drops ?? { item: def.name, count: 1 };
}
