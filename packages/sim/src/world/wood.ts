import { blockByName, type BlockId } from "./block.js";

/**
 * Wood types: log/leaves block pair plus tree-shape tuning, referenced
 * by id from biome tree data (see world/biome.ts). Block names resolve
 * eagerly here - blocks are a self-contained registry (world/block.ts
 * imports and registers its own JSON data at module load, before
 * anything else can import it), so a bad block name already throws
 * immediately instead of needing a boot-time validator.
 */

export type CanopyShape = "round" | "narrow";

export interface WoodJson {
  id: string;
  log: string;
  leaves: string;
  /** Added to the base trunk height roll (spruces grow a bit taller). */
  extra_height?: number;
  /** "narrow" = a pointy canopy (spruce); default "round". */
  canopy_shape?: string;
}

export interface WoodDef {
  id: string;
  log: BlockId;
  leaves: BlockId;
  extraHeight: number;
  canopyShape: CanopyShape;
}

export function parseWood(id: string, json: WoodJson): WoodDef {
  const log = blockByName(json.log);
  if (log === undefined) throw new Error(`wood "${id}": unknown log block "${json.log}"`);
  const leaves = blockByName(json.leaves);
  if (leaves === undefined) throw new Error(`wood "${id}": unknown leaves block "${json.leaves}"`);
  const canopyShape = json.canopy_shape ?? "round";
  if (canopyShape !== "round" && canopyShape !== "narrow") {
    throw new Error(`wood "${id}": canopy_shape must be "round" or "narrow"`);
  }
  return { id, log, leaves, extraHeight: json.extra_height ?? 0, canopyShape };
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
