import { blockByName, type BlockId } from "./block.js";

/**
 * Wood types: log/leaves block pair, referenced by id from biome tree
 * data (see world/biome.ts). Block names resolve eagerly here - blocks
 * are a self-contained registry (world/block.ts imports and registers
 * its own JSON data at module load, before anything else can import it),
 * so a bad block name already throws immediately instead of needing a
 * boot-time validator.
 */

export interface WoodJson {
  id: string;
  log: string;
  leaves: string;
}

export interface WoodDef {
  id: string;
  log: BlockId;
  leaves: BlockId;
}

export function parseWood(id: string, json: WoodJson): WoodDef {
  const log = blockByName(json.log);
  if (log === undefined) throw new Error(`wood "${id}": unknown log block "${json.log}"`);
  const leaves = blockByName(json.leaves);
  if (leaves === undefined) throw new Error(`wood "${id}": unknown leaves block "${json.leaves}"`);
  return { id, log, leaves };
}

const DEFS = new Map<string, WoodDef>();

export function registerWood(def: WoodDef): void {
  if (DEFS.has(def.id)) {
    throw new Error(`wood "${def.id}" is already registered`);
  }
  DEFS.set(def.id, def);
}

export function woodDef(id: string): WoodDef | undefined {
  return DEFS.get(id);
}

export function allWoodIds(): readonly string[] {
  return [...DEFS.keys()];
}
