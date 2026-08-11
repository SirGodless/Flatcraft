/**
 * Block type ids. Stored per tile as a uint16, so the registry can grow to
 * cover the full 1.16-era content set without changing the storage format.
 * Only a handful of placeholder ids exist until world generation lands.
 */
export const enum BlockId {
  Air = 0,
  Stone = 1,
  Dirt = 2,
  Grass = 3,
  Bedrock = 4,
}

export interface BlockDef {
  readonly id: BlockId;
  readonly name: string;
  readonly solid: boolean;
  /** Base mining time in ticks; -1 = unbreakable. */
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
} as const;

export function blockDef(id: BlockId): BlockDef {
  return defs.get(id) ?? Blocks.air;
}
