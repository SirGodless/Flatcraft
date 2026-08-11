import { BlockId } from "./world/block.js";

/**
 * Item registry. Item ids are strings ("oak_planks"), written with the
 * "flatcraft:" namespace in data files - the same convention Minecraft
 * uses, so recipe JSON reads exactly like a datapack.
 */
export type ToolKind = "pickaxe" | "axe" | "shovel" | "sword";

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
  // Materials
  stick: material("stick"),
  coal: material("coal"),
  ironIngot: material("iron_ingot"),
  goldIngot: material("gold_ingot"),
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
} as const;

export function itemDef(id: string): ItemDef | undefined {
  return defs.get(id);
}

export function allItems(): Iterable<ItemDef> {
  return defs.values();
}
