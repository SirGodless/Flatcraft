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
  // Materials
  stick: material("stick"),
  coal: material("coal"),
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
} as const;

export function itemDef(id: string): ItemDef | undefined {
  return defs.get(id);
}

export function allItems(): Iterable<ItemDef> {
  return defs.values();
}
