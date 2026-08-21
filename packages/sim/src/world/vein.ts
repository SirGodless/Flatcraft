import { createInstanceStore, registerContentType, validateContentInstance } from "../registry/generic.js";
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
      id: { kind: "qualified_id", required: true },
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

const DEFS = createInstanceStore<VeinDef>("vein");

/** Register a vein from datapack JSON (content package files or server
 * mods) - the generic content-type engine confirms the raw shape;
 * block-existence checks stay hand-written residual work (same split as
 * every other migrated type). */
export function registerVeinJson(raw: unknown, source = "content"): VeinDef {
  const v = validateContentInstance("vein", raw, source);
  const id = v["id"] as string;
  const blockName = v["block"] as string;
  const block = blockByName(blockName);
  if (block === undefined) throw new Error(`vein "${id}": unknown block "${blockName}"`);
  const hostName = v["host"] as string | undefined;
  const host = hostName !== undefined ? blockByName(hostName) : BlockId.Stone;
  if (host === undefined) throw new Error(`vein "${id}": unknown host block "${hostName}"`);
  const def: VeinDef = {
    id,
    block,
    attempts: v["attempts"] as number,
    sizeMin: v["size_min"] as number,
    sizeMax: v["size_max"] as number,
    minY: v["min_y"] as number,
    maxY: v["max_y"] as number,
    host,
  };
  return DEFS.register(def);
}

export function veinDef(id: string): VeinDef | undefined {
  return DEFS.get(id);
}

export function allVeinIds(): readonly string[] {
  return [...DEFS.keys()];
}

/** Veins placed in every chunk, in placement order - this order is part
 * of world generation determinism (each vein's placement consumes a
 * fixed slice of the per-chunk rng stream, see world/gen.ts placeOres),
 * so it must stay exactly this order for existing worlds to keep
 * generating identically. */
export const GLOBAL_VEIN_IDS: readonly string[] = [
  "flatcraft:vein:obsidian",
  "flatcraft:vein:clay",
  "flatcraft:vein:gravel",
  "flatcraft:vein:coal_ore",
  "flatcraft:vein:copper_ore",
  "flatcraft:vein:iron_ore",
  "flatcraft:vein:lapis_ore",
  "flatcraft:vein:gold_ore",
  "flatcraft:vein:redstone_ore",
  "flatcraft:vein:diamond_ore",
];
