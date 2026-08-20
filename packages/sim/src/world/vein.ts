import { registerContentType, validateContentInstance } from "../registry/generic.js";
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

registerContentType(
  {
    id: "vein",
    fields: {
      id: { kind: "id", required: true },
      block: { kind: "ref", ref_type: "block", required: true },
      attempts: { kind: "number", min: 0, max: 100000, required: true },
      size_min: { kind: "number", min: 0, max: 100000, required: true },
      size_max: { kind: "number", min: 0, max: 100000, required: true },
      min_y: { kind: "number", min: -100000, max: 100000, required: true },
      max_y: { kind: "number", min: -100000, max: 100000, required: true },
      host: { kind: "ref", ref_type: "block" },
    },
  },
  "engine/types/vein",
);

export function parseVein(id: string, json: VeinJson): VeinDef {
  const v = validateContentInstance("vein", json, `vein "${id}"`);
  const blockName = v["block"] as string;
  const block = blockByName(blockName);
  if (block === undefined) throw new Error(`vein "${id}": unknown block "${blockName}"`);
  const hostName = v["host"] as string | undefined;
  const host = hostName !== undefined ? blockByName(hostName) : BlockId.Stone;
  if (host === undefined) throw new Error(`vein "${id}": unknown host block "${hostName}"`);
  return {
    id,
    block,
    attempts: v["attempts"] as number,
    sizeMin: v["size_min"] as number,
    sizeMax: v["size_max"] as number,
    minY: v["min_y"] as number,
    maxY: v["max_y"] as number,
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
