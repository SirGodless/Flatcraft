import { blockByName, type BlockId } from "./block.js";
import { veinDef } from "./vein.js";
import { woodDef } from "./wood.js";

/**
 * Biomes: which surface/underground layers a column gets, whether it
 * snows, what trees grow there and how often, plus any extra ore veins
 * on top of the global set (see world/vein.ts). Selection is a single
 * 1D noise value per column (gen.ts's biomeNoise) mapped to a biome by
 * an ascending noise_max threshold - the biome with the highest
 * registered noise_max also catches everything above its own threshold,
 * so there's always exactly one match.
 *
 * Not namespaced ("flatcraft:desert" etc.) - unlike a multiblock/command/
 * dimension id, biome ids already appear as plain content references in
 * structure placement data (data/structures/house.json's "biomes" list),
 * the same category as block/item names, not a behavior reference.
 *
 * Block references (layers, floor, wall_layer, snow) resolve eagerly
 * here, same reasoning as world/wood.ts and world/vein.ts: blocks are a
 * self-contained registry, always fully loaded first. tree_woods/
 * extra_veins reference the wood/vein registries instead, which - like
 * dimensions/structures - are independently populated by their own
 * data-directory index.ts modules with no guaranteed load order
 * relative to biomes, so those stay unresolved strings here and are checked
 * exhaustively by validateBiomeReferences (see validate.ts).
 */

export interface BiomeLayerJson {
  to_depth: number;
  block: string;
}

export interface BiomeLayer {
  toDepth: number;
  block: BlockId;
}

export interface TreeWoodJson {
  wood: string;
  weight: number;
}

export interface BiomeJson {
  id: string;
  noise_max: number;
  layers: BiomeLayerJson[];
  floor: string;
  wall_layer?: BiomeLayerJson;
  snow?: { at_or_below_surface: number; block: string };
  tree_chance: number;
  tree_woods?: TreeWoodJson[];
  extra_veins?: string[];
}

export interface BiomeDef {
  id: string;
  noiseMax: number;
  layers: BiomeLayer[];
  floor: BlockId;
  wallLayer?: BiomeLayer;
  snow?: { atOrBelowSurface: number; block: BlockId };
  treeChance: number;
  /** Wood ids, still unresolved strings - see validateBiomeReferences. */
  treeWoods: TreeWoodJson[];
  /** Vein ids, still unresolved strings - see validateBiomeReferences. */
  extraVeins: string[];
}

function parseLayer(context: string, json: BiomeLayerJson): BiomeLayer {
  const block = blockByName(json.block);
  if (block === undefined) throw new Error(`${context}: unknown block "${json.block}"`);
  return { toDepth: json.to_depth, block };
}

export function parseBiome(id: string, json: BiomeJson): BiomeDef {
  if (typeof json.noise_max !== "number") {
    throw new Error(`biome "${id}": "noise_max" is required`);
  }
  const floor = blockByName(json.floor);
  if (floor === undefined) throw new Error(`biome "${id}": unknown floor block "${json.floor}"`);
  return {
    id,
    noiseMax: json.noise_max,
    layers: json.layers.map((l) => parseLayer(`biome "${id}"`, l)),
    floor,
    ...(json.wall_layer ? { wallLayer: parseLayer(`biome "${id}" wall_layer`, json.wall_layer) } : {}),
    ...(json.snow
      ? {
          snow: {
            atOrBelowSurface: json.snow.at_or_below_surface,
            block: parseLayer(`biome "${id}" snow`, { to_depth: 0, block: json.snow.block }).block,
          },
        }
      : {}),
    treeChance: json.tree_chance,
    treeWoods: json.tree_woods ?? [],
    extraVeins: json.extra_veins ?? [],
  };
}

const DEFS = new Map<string, BiomeDef>();

export function registerBiome(def: BiomeDef): void {
  if (DEFS.has(def.id)) {
    throw new Error(`biome "${def.id}" is already registered`);
  }
  DEFS.set(def.id, def);
}

export function biomeDef(id: string): BiomeDef | undefined {
  return DEFS.get(id);
}

export function allBiomes(): Iterable<BiomeDef> {
  return DEFS.values();
}

export function allBiomeIds(): readonly string[] {
  return [...DEFS.keys()];
}

/** The biome whose noise_max range covers b - see the module doc for
 * why the highest-threshold biome is always a safe catch-all. */
export function biomeForNoise(b: number): BiomeDef {
  const sorted = [...DEFS.values()].sort((a, c) => a.noiseMax - c.noiseMax);
  if (sorted.length === 0) throw new Error("no biomes registered");
  for (const def of sorted) {
    if (b < def.noiseMax) return def;
  }
  return sorted[sorted.length - 1]!;
}

/** Every registered biome's tree-wood and extra-vein references must
 * resolve - collected exhaustively, same pattern as
 * validateDimensionGenerators/validateStructureDimensions. */
export function validateBiomeReferences(): string[] {
  const problems: string[] = [];
  for (const def of DEFS.values()) {
    for (const tw of def.treeWoods) {
      if (!woodDef(tw.wood)) problems.push(`biome "${def.id}" references unknown wood "${tw.wood}"`);
    }
    for (const veinId of def.extraVeins) {
      if (!veinDef(veinId)) problems.push(`biome "${def.id}" references unknown vein "${veinId}"`);
    }
  }
  return problems;
}
