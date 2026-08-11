import { BlockId } from "./world/block.js";

/**
 * Item registry. Item ids are strings ("oak_planks"), written with the
 * "flatcraft:" namespace in data files - the same convention Minecraft
 * uses, so recipe JSON reads exactly like a datapack.
 */
export interface ItemDef {
  readonly id: string;
  readonly name: string;
  readonly maxStack: number;
  /** Set for items that place a block when used. */
  readonly block?: BlockId;
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

function tool(id: string): ItemDef {
  return register({ id, name: id, maxStack: 1 });
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
  // Materials
  stick: material("stick"),
  coal: material("coal"),
  lapisLazuli: material("lapis_lazuli"),
  redstone: material("redstone"),
  diamond: material("diamond"),
  emerald: material("emerald"),
  // Tools (no function yet; mining speed and tiers come with the
  // block-interaction milestone)
  woodenPickaxe: tool("wooden_pickaxe"),
  woodenAxe: tool("wooden_axe"),
  woodenShovel: tool("wooden_shovel"),
  woodenSword: tool("wooden_sword"),
  stonePickaxe: tool("stone_pickaxe"),
  stoneAxe: tool("stone_axe"),
  stoneShovel: tool("stone_shovel"),
  stoneSword: tool("stone_sword"),
} as const;

export function itemDef(id: string): ItemDef | undefined {
  return defs.get(id);
}

export function allItems(): Iterable<ItemDef> {
  return defs.values();
}
