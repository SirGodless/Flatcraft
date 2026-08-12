import { blockByName, BlockId } from "./world/block.js";

/**
 * Item registry. Item ids are strings ("oak_planks"), written with the
 * "flatcraft:" namespace in data files - the same convention Minecraft
 * uses, so recipe JSON reads exactly like a datapack.
 */
export type ToolKind = "pickaxe" | "axe" | "shovel" | "sword" | "hammer";

/**
 * The eight material tiers, in upgrade order. Gear availability per item
 * family follows the design doc's 8-digit binary codes over this order:
 * wood, stone, copper, iron, gold, diamond, emerald, netherite.
 */
export const TIER_ORDER = [
  "wooden",
  "stone",
  "copper",
  "iron",
  "golden",
  "diamond",
  "emerald",
  "netherite",
] as const;
export type TierId = (typeof TIER_ORDER)[number];

/** Crafting material per tier ("#planks" = any planks via the tag). */
export const TIER_MATERIAL: Record<TierId, string> = {
  wooden: "#planks",
  stone: "cobblestone",
  copper: "copper_ingot",
  iron: "iron_ingot",
  golden: "gold_ingot",
  diamond: "diamond",
  emerald: "emerald",
  netherite: "netherite_ingot",
};

/** Mining speed per tier (matches the existing tools where they exist). */
export const TIER_SPEED: Record<TierId, number> = {
  wooden: 2,
  stone: 4,
  copper: 5,
  iron: 6,
  golden: 12,
  diamond: 8,
  emerald: 9,
  netherite: 10,
};

export interface ToolDef {
  readonly kind: ToolKind;
  /** Material tier: 1 wood, 2 stone, 3 iron, 4 diamond (Minecraft order). */
  readonly tier: number;
  /** Mining speed multiplier against matching blocks (hand = 1). */
  readonly speed: number;
}

export interface ItemDef {
  readonly id: string;
  readonly name: string;
  readonly maxStack: number;
  /** Set for items that place a block when used. */
  readonly block?: BlockId;
  /** Set for tools. */
  readonly tool?: ToolDef;
  /** Set for edible items: hunger points restored on eating. */
  readonly food?: number;
  /** Armor: fraction of incoming damage absorbed while worn. */
  readonly armor?: number;
  /** Shield: fraction of damage blocked while held in the offhand. */
  readonly shieldBlock?: number;
  /** Grappling hook: max anchor distance in tiles. */
  readonly grapple?: number;
}

const defs = new Map<string, ItemDef>();

function register(def: ItemDef): ItemDef {
  defs.set(def.id, def);
  return def;
}

function blockItem(id: string, block: BlockId): ItemDef {
  return register({ id, name: id, maxStack: 64, block });
}

function material(id: string): ItemDef {
  return register({ id, name: id, maxStack: 64 });
}

function foodItem(id: string, food: number): ItemDef {
  return register({ id, name: id, maxStack: 64, food });
}

function tool(id: string, kind: ToolKind, tier: number, speed: number): ItemDef {
  return register({ id, name: id, maxStack: 1, tool: { kind, tier, speed } });
}

export const Items = {
  // Block items
  dirt: blockItem("dirt", BlockId.Dirt),
  cobblestone: blockItem("cobblestone", BlockId.Cobblestone),
  sand: blockItem("sand", BlockId.Sand),
  sandstone: blockItem("sandstone", BlockId.Sandstone),
  gravel: blockItem("gravel", BlockId.Gravel),
  snow: blockItem("snow", BlockId.Snow),
  oakLog: blockItem("oak_log", BlockId.OakLog),
  oakPlanks: blockItem("oak_planks", BlockId.OakPlanks),
  craftingTable: blockItem("crafting_table", BlockId.CraftingTable),
  ironOre: blockItem("iron_ore", BlockId.IronOre),
  goldOre: blockItem("gold_ore", BlockId.GoldOre),
  furnace: blockItem("furnace", BlockId.Furnace),
  glass: blockItem("glass", BlockId.Glass),
  stone: blockItem("stone", BlockId.Stone),
  netherrack: blockItem("netherrack", BlockId.Netherrack),
  soulSand: blockItem("soul_sand", BlockId.SoulSand),
  glowstone: blockItem("glowstone", BlockId.Glowstone),
  obsidian: blockItem("obsidian", BlockId.Obsidian),
  basalt: blockItem("basalt", BlockId.Basalt),
  // Materials
  stick: material("stick"),
  coal: material("coal"),
  ironIngot: material("iron_ingot"),
  goldIngot: material("gold_ingot"),
  rottenFlesh: foodItem("rotten_flesh", 2),
  porkchop: foodItem("porkchop", 3),
  cookedPorkchop: foodItem("cooked_porkchop", 8),
  flint: material("flint"),
  glowstoneDust: material("glowstone_dust"),
  bone: material("bone"),
  arrow: material("arrow"),
  gunpowder: material("gunpowder"),
  leather: material("leather"),
  beef: foodItem("beef", 3),
  cookedBeef: foodItem("cooked_beef", 8),
  wool: material("wool"),
  chicken: foodItem("chicken", 2),
  cookedChicken: foodItem("cooked_chicken", 6),
  feather: material("feather"),
  string: material("string"),
  bow: register({ id: "bow", name: "bow", maxStack: 1 }),
  goldNugget: material("gold_nugget"),
  flintAndSteel: register({ id: "flint_and_steel", name: "flint_and_steel", maxStack: 1 }),
  chestItem: blockItem("chest", BlockId.Chest),
  /** Portable 9-slot container (a FlatCraft original, not vanilla). */
  backpack: register({ id: "backpack", name: "backpack", maxStack: 1 }),
  brewingStandItem: blockItem("brewing_stand", BlockId.BrewingStand),
  enchantingTableItem: blockItem("enchanting_table", BlockId.EnchantingTable),
  glassBottle: material("glass_bottle"),
  potionSpeed: register({ id: "potion_speed", name: "potion_speed", maxStack: 1 }),
  potionRegeneration: register({ id: "potion_regeneration", name: "potion_regeneration", maxStack: 1 }),
  potionStrength: register({ id: "potion_strength", name: "potion_strength", maxStack: 1 }),
  /** Reveals ores through the fog of war (FlatCraft original). */
  potionMiner: register({ id: "potion_miner", name: "potion_miner", maxStack: 1 }),
  /** Gliding wings; behavior lands with the elytra milestone. */
  elytra: register({ id: "elytra", name: "elytra", maxStack: 1 }),
  lapisLazuli: material("lapis_lazuli"),
  redstone: material("redstone"),
  diamond: material("diamond"),
  emerald: material("emerald"),
  // Tools (Minecraft-like tiers and speeds; no durability by design)
  woodenPickaxe: tool("wooden_pickaxe", "pickaxe", 1, 2),
  woodenAxe: tool("wooden_axe", "axe", 1, 2),
  woodenShovel: tool("wooden_shovel", "shovel", 1, 2),
  woodenSword: tool("wooden_sword", "sword", 1, 1),
  stonePickaxe: tool("stone_pickaxe", "pickaxe", 2, 4),
  stoneAxe: tool("stone_axe", "axe", 2, 4),
  stoneShovel: tool("stone_shovel", "shovel", 2, 4),
  stoneSword: tool("stone_sword", "sword", 2, 1),
  ironPickaxe: tool("iron_pickaxe", "pickaxe", 3, 6),
  ironAxe: tool("iron_axe", "axe", 3, 6),
  ironShovel: tool("iron_shovel", "shovel", 3, 6),
  ironSword: tool("iron_sword", "sword", 3, 1),
  // Gold: blazing fast but wood-level harvesting - authentic Minecraft.
  goldenPickaxe: tool("golden_pickaxe", "pickaxe", 1, 12),
  goldenAxe: tool("golden_axe", "axe", 1, 12),
  goldenShovel: tool("golden_shovel", "shovel", 1, 12),
  goldenSword: tool("golden_sword", "sword", 1, 1),
  diamondPickaxe: tool("diamond_pickaxe", "pickaxe", 4, 8),
  diamondAxe: tool("diamond_axe", "axe", 4, 8),
  diamondShovel: tool("diamond_shovel", "shovel", 4, 8),
  diamondSword: tool("diamond_sword", "sword", 4, 1),
  // New materials
  copperOre: blockItem("copper_ore", BlockId.CopperOre),
  copperIngot: material("copper_ingot"),
  ancientDebris: blockItem("ancient_debris", BlockId.AncientDebris),
  netheriteScrap: material("netherite_scrap"),
  netheriteIngot: material("netherite_ingot"),
  // New wood types
  birchLog: blockItem("birch_log", BlockId.BirchLog),
  birchPlanks: blockItem("birch_planks", BlockId.BirchPlanks),
  spruceLog: blockItem("spruce_log", BlockId.SpruceLog),
  sprucePlanks: blockItem("spruce_planks", BlockId.SprucePlanks),
} as const;

// Wood building sets: stairs, slab, fence, door, trapdoor per wood type.
for (const wood of ["oak", "birch", "spruce"]) {
  for (const kind of ["stairs", "slab", "fence", "door", "trapdoor"]) {
    const name = `${wood}_${kind}`;
    const block = blockByName(name);
    if (block !== undefined) register({ id: name, name, maxStack: 64, block });
  }
}

/** Harvest tier per tier id (hammers, matching the tool tier scheme). */
const TIER_HARVEST: Record<TierId, number> = {
  wooden: 1, stone: 2, copper: 2, iron: 3, golden: 1, diamond: 4, emerald: 4, netherite: 4,
};

// Hammers (all 8 tiers): mine background walls at tool-tier speed.
for (const tier of TIER_ORDER) {
  register({
    id: `${tier}_hammer`,
    name: `${tier}_hammer`,
    maxStack: 1,
    tool: { kind: "hammer", tier: TIER_HARVEST[tier], speed: TIER_SPEED[tier] },
  });
}

// Armor (leather + copper..netherite): one worn piece, flat damage absorb.
const ARMOR_TIERS: ReadonlyArray<[string, number]> = [
  ["leather", 0.15],
  ["copper", 0.2],
  ["iron", 0.3],
  ["golden", 0.35],
  ["diamond", 0.45],
  ["emerald", 0.5],
  ["netherite", 0.6],
];
for (const [tier, absorb] of ARMOR_TIERS) {
  register({ id: `${tier}_armor`, name: `${tier}_armor`, maxStack: 1, armor: absorb });
}

// Shields (all 8 tiers): passive block fraction while in the offhand.
TIER_ORDER.forEach((tier, index) => {
  register({ id: `${tier}_shield`, name: `${tier}_shield`, maxStack: 1, shieldBlock: 0.25 + index * 0.05 });
});

// Grappling hooks (all 8 tiers): 10 tiles range, +2 per tier.
TIER_ORDER.forEach((tier, index) => {
  register({ id: `${tier}_grappling_hook`, name: `${tier}_grappling_hook`, maxStack: 1, grapple: 10 + index * 2 });
});

export function itemDef(id: string): ItemDef | undefined {
  return defs.get(id);
}

export function allItems(): Iterable<ItemDef> {
  return defs.values();
}
