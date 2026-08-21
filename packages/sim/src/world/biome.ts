import { createInstanceStore, registerContentType, validateContentInstance } from "../registry/generic.js";
import { blockByName, BlockId } from "./block.js";

/**
 * Biomes: which surface/underground layers a column gets, whether it
 * snows, what trees grow there and how often, plus any extra ore veins
 * on top of the global set (see world/vein.ts). Selection is a single
 * 1D noise value per column (gen.ts's biomeNoise) mapped to a biome by
 * an ascending noise_max threshold - the biome with the highest
 * registered noise_max also catches everything above its own threshold,
 * so there's always exactly one match.
 *
 * Block references (layers, floor, wall_layer, snow) resolve eagerly
 * here (the content loader registers blocks before biomes - see
 * registry/load.ts's DIR_ORDER). tree_woods/extra_veins reference the
 * wood/vein registries instead; those load in the same pass and aren't
 * given a guaranteed order relative to biomes, so those stay unresolved
 * strings here and are checked exhaustively later, once everything has
 * loaded, by registry/generic.ts's validateAllRefs (see validate.ts).
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
  /** Wood ids, still unresolved strings - see validateAllRefs. */
  treeWoods: TreeWoodJson[];
  /** Vein ids, still unresolved strings - see validateAllRefs. */
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

const DEFS = createInstanceStore<BiomeDef>("biome");

/** Register a biome from datapack JSON (content package files or server
 * mods). tree_woods'/extra_veins' wood/vein ids stay unresolved strings
 * after validation - registry/generic.ts's validateAllRefs does the
 * exhaustive existence check later, once every type has loaded. */
export function registerBiomeJson(raw: unknown, source = "content"): BiomeDef {
  const v = validateContentInstance("biome", raw, source) as {
    id: string;
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
  const id = v.id;
  const floor = blockByName(v.floor);
  if (floor === undefined) throw new Error(`biome "${id}": unknown floor block "${v.floor}"`);
  let beachFloor: BlockId | undefined;
  if (v.beach_layers) {
    beachFloor = v.beach_floor ? blockByName(v.beach_floor) : BlockId.Stone;
    if (beachFloor === undefined) throw new Error(`biome "${id}": unknown beach_floor block "${v.beach_floor}"`);
  }
  const def: BiomeDef = {
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
  return DEFS.register(def);
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

// A biome's tree_woods[].wood and extra_veins[] fields are declared as
// `ref` fields (see the registerContentType call above), so their
// existence is checked generically by registry/generic.ts's
// validateAllRefs (see validate.ts) - no bespoke validateBiomeReferences()
// needed here anymore.
