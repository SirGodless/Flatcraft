import { fbm2, hash01 } from "../math/noise.js";
import { hashSeed } from "../math/rng.js";
import { registerContentType, validateContentInstance } from "../registry/generic.js";
import { blockByName, type BlockId } from "./block.js";

/**
 * Nether material layers: which block (if any) fills a solid (non-open-
 * cavern) tile, e.g. glowstone near the ceiling, soul sand and basalt
 * patches near the lava sea, rare ancient debris scattered through it.
 * Previously an if/else-if chain of hardcoded noise-threshold checks in
 * generateNetherChunk; now a data-driven, ordered list (first match
 * wins, same as the chain it replaces), consumed by a generic evaluator.
 *
 * Deliberately its own small registry, not a reuse of world/biome.ts's
 * BiomeDef or world/vein.ts's VeinDef: biomes are column-based (a
 * surface height plus depth layers) and veins are random-walk clusters
 * seeded per chunk - neither model fits the nether, whose terrain is a
 * 2D noise field with no "surface" and where materials like ancient
 * debris are placed by an independent per-tile threshold roll, not a
 * clustered walk. Reusing either would have required changing the
 * actual placement algorithm, which would change existing worlds'
 * generated terrain - not an option (see the module doc comment on
 * world/biome.ts for the same constraint applied there).
 *
 * The cavern-carving noise itself (generateNetherChunk's `open` check)
 * stays engine code, same "data composes trusted behavior, but the
 * noise math itself isn't data" boundary the overworld's carveCaves
 * already draws.
 */

export interface NetherLayerJson {
  id: string;
  block: string;
  /** Applies only where y is strictly less than this (e.g. near the
   * ceiling). */
  y_less_than?: number;
  /** Applies only where y is strictly greater than this (e.g. near the
   * lava sea). */
  y_greater_than?: number;
  /** Not typed as the literal union here - imported JSON modules widen
   * string literals to `string`, so the union only exists on the parsed
   * NetherLayerDef, checked at runtime in parseNetherLayer. */
  noise: string;
  /** hashSeed(seed, this) decorrelates this layer's noise field from
   * the others - must stay a fixed literal per layer, not derived from
   * the id, or existing worlds' terrain would shift. */
  seed_offset: number;
  /** Required for noise "fbm2". */
  period?: number;
  octaves?: number;
  threshold: number;
  /** true: this layer's noise value must be above threshold (glowstone/
   * soul sand/basalt). false: below (ancient debris - a rare-hit roll). */
  above_threshold: boolean;
}

export interface NetherLayerDef {
  id: string;
  block: BlockId;
  yLessThan?: number;
  yGreaterThan?: number;
  noise: "fbm2" | "hash01";
  seedOffset: number;
  period?: number;
  octaves?: number;
  threshold: number;
  aboveThreshold: boolean;
}

registerContentType(
  {
    id: "nether_layer",
    fields: {
      id: { kind: "qualified_id", required: true },
      block: { kind: "ref", ref_type: "block", required: true },
      y_less_than: { kind: "number", min: -100000, max: 100000 },
      y_greater_than: { kind: "number", min: -100000, max: 100000 },
      noise: { kind: "enum", values: ["fbm2", "hash01"], required: true },
      seed_offset: { kind: "number", min: -1e9, max: 1e9, required: true },
      period: { kind: "number", min: 0, max: 100000 },
      octaves: { kind: "number", min: 0, max: 100 },
      threshold: { kind: "number", min: -1000, max: 1000, required: true },
      above_threshold: { kind: "boolean", required: true },
    },
  },
  "engine/types/nether_layer",
);

export function parseNetherLayer(id: string, json: NetherLayerJson): NetherLayerDef {
  const v = validateContentInstance("nether_layer", json, `nether layer "${id}"`);
  const blockName = v["block"] as string;
  const block = blockByName(blockName);
  if (block === undefined) throw new Error(`nether layer "${id}": unknown block "${blockName}"`);
  const noise = v["noise"] as "fbm2" | "hash01";
  const period = v["period"] as number | undefined;
  const octaves = v["octaves"] as number | undefined;
  // Cross-field rule ("fbm2" needs period+octaves) - the generic DSL
  // doesn't (yet) express "field X required only if field Y is Z", so
  // this one stays a small residual check here rather than growing the
  // DSL for a single caller.
  if (noise === "fbm2" && (period === undefined || octaves === undefined)) {
    throw new Error(`nether layer "${id}": noise "fbm2" requires "period" and "octaves"`);
  }
  return {
    id,
    block,
    ...(v["y_less_than"] !== undefined ? { yLessThan: v["y_less_than"] as number } : {}),
    ...(v["y_greater_than"] !== undefined ? { yGreaterThan: v["y_greater_than"] as number } : {}),
    noise,
    seedOffset: v["seed_offset"] as number,
    ...(period !== undefined ? { period } : {}),
    ...(octaves !== undefined ? { octaves } : {}),
    threshold: v["threshold"] as number,
    aboveThreshold: v["above_threshold"] as boolean,
  };
}

/** Registration order is placement priority - first match wins, same as
 * the if/else-if chain this replaces. */
const LAYERS: NetherLayerDef[] = [];

export function registerNetherLayer(def: NetherLayerDef): void {
  if (LAYERS.some((l) => l.id === def.id)) {
    throw new Error(`nether layer "${def.id}" is already registered`);
  }
  LAYERS.push(def);
}

/** The material at (x, y) from the first matching layer, or undefined
 * (falls through to netherrack) - see generateNetherChunk. */
export function netherLayerBlock(seed: number, x: number, y: number): BlockId | undefined {
  for (const layer of LAYERS) {
    if (layer.yLessThan !== undefined && !(y < layer.yLessThan)) continue;
    if (layer.yGreaterThan !== undefined && !(y > layer.yGreaterThan)) continue;
    const s = hashSeed(seed, layer.seedOffset);
    const value = layer.noise === "fbm2" ? fbm2(s, x, y, layer.period!, layer.octaves!) : hash01(s, x, y);
    const hit = layer.aboveThreshold ? value > layer.threshold : value < layer.threshold;
    if (hit) return layer.block;
  }
  return undefined;
}
