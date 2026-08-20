import { registerContentType, validateContentInstance } from "../registry/generic.js";
import { blockByName, BlockId } from "./block.js";
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
  /** Beach/underwater columns (see gen.ts's terrainBlock): overrides
   * the engine's default sand/sandstone/stone shoreline. Omitted =
   * every biome shares that default, today's behavior. */
  beach_layers?: BiomeLayerJson[];
  beach_floor?: string;
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
  beachLayers?: BiomeLayer[];
  beachFloor?: BlockId;
  snow?: { atOrBelowSurface: number; block: BlockId };
  treeChance: number;
  /** Wood ids, still unresolved strings - see validateBiomeReferences. */
  treeWoods: TreeWoodJson[];
  /** Vein ids, still unresolved strings - see validateBiomeReferences. */
  extraVeins: string[];
}

function parseLayer(context: string, json: { to_depth: number; block: string }): BiomeLayer {
  const block = blockByName(json.block);
  if (block === undefined) throw new Error(`${context}: unknown block "${json.block}"`);
  return { toDepth: json.to_depth, block };
}

const LAYER_FIELDS = {
  to_depth: { kind: "number", min: 0, max: 100000, required: true },
  block: { kind: "ref", ref_type: "block", required: true },
};

registerContentType(
  {
    id: "biome",
    fields: {
      id: { kind: "qualified_id", required: true },
      noise_max: { kind: "number", min: -1000, max: 1000, required: true },
      layers: { kind: "array", required: true, items: { kind: "object", fields: LAYER_FIELDS } },
      floor: { kind: "ref", ref_type: "block", required: true },
      wall_layer: { kind: "object", fields: LAYER_FIELDS },
      beach_layers: { kind: "array", items: { kind: "object", fields: LAYER_FIELDS } },
      beach_floor: { kind: "ref", ref_type: "block" },
      snow: {
        kind: "object",
        fields: {
          at_or_below_surface: { kind: "number", min: -100000, max: 100000, required: true },
          block: { kind: "ref", ref_type: "block", required: true },
        },
      },
      tree_chance: { kind: "number", min: 0, max: 1, required: true },
      tree_woods: {
        kind: "array",
        items: {
          kind: "object",
          fields: { wood: { kind: "ref", ref_type: "wood", required: true }, weight: { kind: "number", min: 0, max: 100000, required: true } },
        },
      },
      extra_veins: { kind: "array", items: { kind: "ref", ref_type: "vein" } },
    },
  },
  "engine/types/biome",
);

/** tree_woods'/extra_veins' wood/vein ids stay unresolved strings after
 * validation (ref fields are syntax-only, see registry/generic.ts) -
 * validateBiomeReferences below still does the exhaustive existence
 * check, unchanged. */
export function parseBiome(id: string, json: BiomeJson): BiomeDef {
  const v = validateContentInstance("biome", json, `biome "${id}"`) as {
    noise_max: number;
    layers: Array<{ to_depth: number; block: string }>;
    floor: string;
    wall_layer?: { to_depth: number; block: string };
    beach_layers?: Array<{ to_depth: number; block: string }>;
    beach_floor?: string;
    snow?: { at_or_below_surface: number; block: string };
    tree_chance: number;
    tree_woods?: TreeWoodJson[];
    extra_veins?: string[];
  };
  const floor = blockByName(v.floor);
  if (floor === undefined) throw new Error(`biome "${id}": unknown floor block "${v.floor}"`);
  let beachFloor: BlockId | undefined;
  if (v.beach_layers) {
    beachFloor = v.beach_floor ? blockByName(v.beach_floor) : BlockId.Stone;
    if (beachFloor === undefined) throw new Error(`biome "${id}": unknown beach_floor block "${v.beach_floor}"`);
  }
  return {
    id,
    noiseMax: v.noise_max,
    layers: v.layers.map((l) => parseLayer(`biome "${id}"`, l)),
    floor,
    ...(v.wall_layer ? { wallLayer: parseLayer(`biome "${id}" wall_layer`, v.wall_layer) } : {}),
    ...(v.beach_layers
      ? { beachLayers: v.beach_layers.map((l) => parseLayer(`biome "${id}" beach_layers`, l)), beachFloor: beachFloor! }
      : {}),
    ...(v.snow
      ? {
          snow: {
            atOrBelowSurface: v.snow.at_or_below_surface,
            block: parseLayer(`biome "${id}" snow`, { to_depth: 0, block: v.snow.block }).block,
          },
        }
      : {}),
    treeChance: v.tree_chance,
    treeWoods: v.tree_woods ?? [],
    extraVeins: v.extra_veins ?? [],
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
