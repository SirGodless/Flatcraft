import { itemDef } from "../items.js";
import { blockByName, type BlockId } from "../world/block.js";
import type { Dimension } from "../world/world.js";

/**
 * World structures, defined in JSON (src/data/structures/*.json):
 *
 *   {
 *     "dimension": "overworld",
 *     "placement": { "type": "surface", "chance": 0.05, "biomes": ["plains"] },
 *     "anchor": [2, 3],
 *     "pattern": ["CCC", "C.C", "CCC"],
 *     "key": {
 *       "C": { "block": "flatcraft:cobblestone" },
 *       ".": { "block": "flatcraft:air" },
 *       "n": { "block": "flatcraft:chest",
 *              "loot": [{ "item": "flatcraft:diamond", "count": 2, "chance": 0.5 }] }
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

const NAMESPACE = "flatcraft:";

function stripNs(raw: string): string {
  return raw.startsWith(NAMESPACE) ? raw.slice(NAMESPACE.length) : raw;
}

export function parseStructure(id: string, json: StructureJson): Structure {
  if (typeof json.dimension !== "string" || json.dimension.length === 0) {
    throw new Error(`structure ${id}: "dimension" is required`);
  }
  if (json.placement.type !== "surface" && json.placement.type !== "underground") {
    throw new Error(`structure ${id}: unknown placement type "${json.placement.type}"`);
  }
  const width = Math.max(...json.pattern.map((r) => r.length));
  const cells: (StructureCell | null)[][] = json.pattern.map((row) => {
    const line: (StructureCell | null)[] = [];
    for (let i = 0; i < width; i++) {
      const char = row[i] ?? " ";
      if (char === " ") {
        line.push(null);
        continue;
      }
      const entry = json.key[char];
      if (!entry) {
        throw new Error(`structure ${id}: symbol "${char}" missing from key`);
      }
      const block = blockByName(stripNs(entry.block));
      if (block === undefined) {
        throw new Error(`structure ${id}: unknown block "${entry.block}"`);
      }
      for (const loot of entry.loot ?? []) {
        if (!itemDef(stripNs(loot.item))) {
          throw new Error(`structure ${id}: unknown loot item "${loot.item}"`);
        }
      }
      line.push({
        block,
        ...(entry.loot
          ? { loot: entry.loot.map((l) => ({ ...l, item: stripNs(l.item) })) }
          : {}),
      });
    }
    return line;
  });
  const [ax = -1, ay = -1] = json.anchor;
  if (ax < 0 || ax >= width || ay < 0 || ay >= cells.length) {
    throw new Error(`structure ${id}: anchor out of bounds`);
  }
  return {
    id,
    dimension: json.dimension,
    placement: {
      type: json.placement.type,
      chance: json.placement.chance,
      minY: json.placement.minY ?? 40,
      maxY: json.placement.maxY ?? 200,
      ...(json.placement.biomes ? { biomes: json.placement.biomes } : {}),
    },
    anchor: [ax, ay],
    cells,
    width,
    height: cells.length,
  };
}
