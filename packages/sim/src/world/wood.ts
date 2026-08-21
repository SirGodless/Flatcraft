import { createInstanceStore, registerContentType, validateContentInstance } from "../registry/generic.js";
import { blockByName, type BlockId } from "./block.js";

/**
 * Wood types: log/leaves block pair plus tree-shape tuning, referenced
 * by id from biome tree data (see world/biome.ts). Block names resolve
 * eagerly here (the content loader registers blocks before woods - see
 * registry/load.ts's DIR_ORDER), so a bad block name already throws
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

registerContentType(
  {
    id: "wood",
    fields: {
      id: { kind: "qualified_id", required: true },
      log: { kind: "ref", ref_type: "block", required: true },
      leaves: { kind: "ref", ref_type: "block", required: true },
      extra_height: { kind: "number", min: -1000, max: 1000 },
      canopy_shape: { kind: "enum", values: ["round", "narrow"] },
    },
  },
  "engine/types/wood",
);

const DEFS = createInstanceStore<WoodDef>("wood");

/** Register a wood type from datapack JSON (content package files or
 * server mods). */
export function registerWoodJson(raw: unknown, source = "content"): WoodDef {
  const v = validateContentInstance("wood", raw, source);
  const id = v["id"] as string;
  const logName = v["log"] as string;
  const log = blockByName(logName);
  if (log === undefined) throw new Error(`wood "${id}": unknown log block "${logName}"`);
  const leavesName = v["leaves"] as string;
  const leaves = blockByName(leavesName);
  if (leaves === undefined) throw new Error(`wood "${id}": unknown leaves block "${leavesName}"`);
  const canopyShape = (v["canopy_shape"] as "round" | "narrow" | undefined) ?? "round";
  const def: WoodDef = { id, log, leaves, extraHeight: (v["extra_height"] as number | undefined) ?? 0, canopyShape };
  return DEFS.register(def);
}

export function woodDef(id: string): WoodDef | undefined {
  return DEFS.get(id);
}

export function allWoodIds(): readonly string[] {
  return [...DEFS.keys()];
}
