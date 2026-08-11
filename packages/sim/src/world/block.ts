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
}

export interface BlockDef {
  readonly id: BlockId;
  readonly name: string;
  readonly solid: boolean;
  /** Base mining time in ticks; -1 = unbreakable (and not placeable). */
  readonly hardness: number;
}

const defs = new Map<BlockId, BlockDef>();

function register(def: BlockDef): BlockDef {
  defs.set(def.id, def);
  return def;
}

export const Blocks = {
  air: register({ id: BlockId.Air, name: "air", solid: false, hardness: 0 }),
  stone: register({ id: BlockId.Stone, name: "stone", solid: true, hardness: 30 }),
  dirt: register({ id: BlockId.Dirt, name: "dirt", solid: true, hardness: 10 }),
  grass: register({ id: BlockId.Grass, name: "grass", solid: true, hardness: 12 }),
  bedrock: register({ id: BlockId.Bedrock, name: "bedrock", solid: true, hardness: -1 }),
  sand: register({ id: BlockId.Sand, name: "sand", solid: true, hardness: 8 }),
  sandstone: register({ id: BlockId.Sandstone, name: "sandstone", solid: true, hardness: 24 }),
  gravel: register({ id: BlockId.Gravel, name: "gravel", solid: true, hardness: 9 }),
  // Static for now; fluid flow (and buckets) come later, so water can be
  // neither broken nor placed (hardness -1).
  water: register({ id: BlockId.Water, name: "water", solid: false, hardness: -1 }),
  // Trees are background scenery in a 2D world: they never block movement.
  oakLog: register({ id: BlockId.OakLog, name: "oak_log", solid: false, hardness: 25 }),
  oakLeaves: register({ id: BlockId.OakLeaves, name: "oak_leaves", solid: false, hardness: 3 }),
  snow: register({ id: BlockId.Snow, name: "snow", solid: true, hardness: 6 }),
  coalOre: register({ id: BlockId.CoalOre, name: "coal_ore", solid: true, hardness: 35 }),
  ironOre: register({ id: BlockId.IronOre, name: "iron_ore", solid: true, hardness: 40 }),
  goldOre: register({ id: BlockId.GoldOre, name: "gold_ore", solid: true, hardness: 40 }),
  lapisOre: register({ id: BlockId.LapisOre, name: "lapis_ore", solid: true, hardness: 40 }),
  redstoneOre: register({ id: BlockId.RedstoneOre, name: "redstone_ore", solid: true, hardness: 40 }),
  diamondOre: register({ id: BlockId.DiamondOre, name: "diamond_ore", solid: true, hardness: 45 }),
  emeraldOre: register({ id: BlockId.EmeraldOre, name: "emerald_ore", solid: true, hardness: 45 }),
} as const;

export function blockDef(id: BlockId): BlockDef {
  return defs.get(id) ?? Blocks.air;
}
