import { itemDef } from "../items.js";
import { registerContentType, validateContentInstance } from "../registry/generic.js";
import { allDimensionIds } from "../world/dimension.js";
import { blockByName, type BlockId } from "../world/block.js";
import type { Dimension } from "../world/world.js";

/**
 * World structures, defined in JSON (content/flatcraft/structures/*.json):
 *
 *   {
 *     "id": "flatcraft:structure:house",
 *     "dimension": "flatcraft:dimension:overworld",
 *     "placement": { "type": "surface", "chance": 0.05, "biomes": ["flatcraft:biome:plains"] },
 *     "anchor": [2, 3],
 *     "pattern": ["CCC", "C.C", "CCC"],
 *     "key": {
 *       "C": { "block": "flatcraft:block:cobblestone" },
 *       ".": { "block": "flatcraft:block:air" },
 *       "n": { "block": "flatcraft:block:chest",
 *              "loot": [{ "item": "flatcraft:item:diamond", "count": 2, "chance": 0.5 }] }
 *     }
 *   }
 *
 * pattern: rows of symbols; space = leave terrain untouched. The anchor
 * cell [col, row] is the tile that lands on the placement point (the
 * surface for surface structures, the rolled y for underground ones).
 * placement.chance is the probability per chunk of hosting an anchor.
 */

export interface LootEntry {
  item: string;
  /** Maximum count; 1..count is rolled. */
  count: number;
  /** Probability this entry appears at all (default 1). */
  chance?: number;
}

export interface StructureJson {
  id: string;
  dimension: string;
  placement: {
    type: string;
    chance: number;
    minY?: number;
    maxY?: number;
    biomes?: string[];
  };
  anchor: number[];
  pattern: string[];
  key: Record<string, { block: string; loot?: LootEntry[] }>;
}

export interface StructureCell {
  block: BlockId;
  loot?: LootEntry[];
}

export interface Structure {
  id: string;
  dimension: Dimension;
  placement: {
    type: "surface" | "underground";
    chance: number;
    minY: number;
    maxY: number;
    biomes?: string[];
  };
  anchor: [number, number];
  /** rows x cols; null = leave terrain untouched. */
  cells: (StructureCell | null)[][];
  width: number;
  height: number;
}

const LOOT_ENTRY_FIELDS = {
  item: { kind: "ref", ref_type: "item", required: true },
  count: { kind: "number", min: 1, max: 999, required: true },
  chance: { kind: "number", min: 0, max: 1 },
};

registerContentType(
  {
    id: "structure",
    fields: {
      id: { kind: "qualified_id", required: true },
      dimension: { kind: "ref", ref_type: "dimension", required: true },
      placement: {
        kind: "object",
        required: true,
        fields: {
          type: { kind: "enum", values: ["surface", "underground"], required: true },
          chance: { kind: "number", min: 0, max: 1, required: true },
          minY: { kind: "number", min: -100000, max: 100000 },
          maxY: { kind: "number", min: -100000, max: 100000 },
          biomes: { kind: "array", items: { kind: "ref", ref_type: "biome" } },
        },
      },
      anchor: { kind: "array", required: true, items: { kind: "number", min: -100000, max: 100000 } },
      pattern: { kind: "array", required: true, items: { kind: "string" } },
      key: {
        kind: "record",
        required: true,
        values: {
          kind: "object",
          fields: {
            block: { kind: "ref", ref_type: "block", required: true },
            loot: { kind: "array", items: { kind: "object", fields: LOOT_ENTRY_FIELDS } },
          },
        },
      },
    },
  },
  "engine/types/structure",
);

const DEFS = new Map<string, Structure>();

/** Register a structure from datapack JSON (content package files or
 * server mods). Building the actual cell grid from pattern+key is real
 * algorithmic work, not schema validation, so it stays hand-written
 * after the generic engine confirms the raw shape is sound. */
export function registerStructureJson(raw: unknown, source = "content"): Structure {
  const v = validateContentInstance("structure", raw, source) as {
    id: string;
    dimension: string;
    placement: { type: "surface" | "underground"; chance: number; minY?: number; maxY?: number; biomes?: string[] };
    anchor: number[];
    pattern: string[];
    key: Record<string, { block: string; loot?: LootEntry[] }>;
  };
  const id = v.id;
  const width = Math.max(...v.pattern.map((r) => r.length));
  const cells: (StructureCell | null)[][] = v.pattern.map((row) => {
    const line: (StructureCell | null)[] = [];
    for (let i = 0; i < width; i++) {
      const char = row[i] ?? " ";
      if (char === " ") {
        line.push(null);
        continue;
      }
      const entry = v.key[char];
      if (!entry) {
        throw new Error(`structure ${id}: symbol "${char}" missing from key`);
      }
      const block = blockByName(entry.block);
      if (block === undefined) {
        throw new Error(`structure ${id}: unknown block "${entry.block}"`);
      }
      for (const loot of entry.loot ?? []) {
        if (!itemDef(loot.item)) {
          throw new Error(`structure ${id}: unknown loot item "${loot.item}"`);
        }
      }
      line.push({ block, ...(entry.loot ? { loot: entry.loot } : {}) });
    }
    return line;
  });
  const [ax = -1, ay = -1] = v.anchor;
  if (ax < 0 || ax >= width || ay < 0 || ay >= cells.length) {
    throw new Error(`structure ${id}: anchor out of bounds`);
  }
  const def: Structure = {
    id,
    dimension: v.dimension,
    placement: {
      type: v.placement.type,
      chance: v.placement.chance,
      minY: v.placement.minY ?? 40,
      maxY: v.placement.maxY ?? 200,
      ...(v.placement.biomes ? { biomes: v.placement.biomes } : {}),
    },
    anchor: [ax, ay],
    cells,
    width,
    height: cells.length,
  };
  if (DEFS.has(def.id)) {
    throw new Error(`structure "${def.id}" is already registered`);
  }
  DEFS.set(def.id, def);
  return def;
}

export function allStructures(): Iterable<Structure> {
  return DEFS.values();
}

/** Every structure's `dimension` must name an actually registered
 * dimension - same exhaustive-collect-all pattern as
 * validateMultiblockHandlers. */
export function validateStructureDimensions(): string[] {
  const known = new Set(allDimensionIds());
  return [...DEFS.values()]
    .filter((s) => !known.has(s.dimension))
    .map((s) => `structure "${s.id}" references unknown dimension "${s.dimension}"`);
}
