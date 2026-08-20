import { blockByName, BlockId } from "./block.js";

/**
 * Ore/mineral veins: a block type placed as a random walk of a given
 * size, some number of attempts per chunk, within a y-range, replacing
 * a host block (stone by default). Applied either everywhere (see
 * gen.ts's GLOBAL_VEIN_IDS) or only within a specific biome (a biome's
 * extra_veins list, e.g. emerald under mountains) - both paths
 * reference this same registry by id.
 */

export interface VeinJson {
  id: string;
  block: string;
  attempts: number;
  size_min: number;
  size_max: number;
  min_y: number;
  max_y: number;
  /** Block this vein replaces; default "stone". */
  host?: string;
}

export interface VeinDef {
  id: string;
  block: BlockId;
  attempts: number;
  sizeMin: number;
  sizeMax: number;
  minY: number;
  maxY: number;
  host: BlockId;
}

export function parseVein(id: string, json: VeinJson): VeinDef {
  const block = blockByName(json.block);
  if (block === undefined) throw new Error(`vein "${id}": unknown block "${json.block}"`);
  const host = json.host !== undefined ? blockByName(json.host) : BlockId.Stone;
  if (host === undefined) throw new Error(`vein "${id}": unknown host block "${json.host}"`);
  return {
    id,
    block,
    attempts: json.attempts,
    sizeMin: json.size_min,
    sizeMax: json.size_max,
    minY: json.min_y,
    maxY: json.max_y,
    host,
  };
}

const DEFS = new Map<string, VeinDef>();

export function registerVein(def: VeinDef): void {
  if (DEFS.has(def.id)) {
    throw new Error(`vein "${def.id}" is already registered`);
  }
  DEFS.set(def.id, def);
}

export function veinDef(id: string): VeinDef | undefined {
  return DEFS.get(id);
}

export function allVeinIds(): readonly string[] {
  return [...DEFS.keys()];
}
