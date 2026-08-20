import { CHUNK_HEIGHT, CHUNK_WIDTH } from "../constants.js";
import { GLOBAL_VEIN_IDS } from "../data/veins/index.js";
import { fbm2, hash01, smoothstep01, valueNoise1, valueNoise2 } from "../math/noise.js";
import { createRng, hashSeed } from "../math/rng.js";
import { biomeForNoise, type BiomeDef } from "./biome.js";
import { BlockId } from "./block.js";
import { Chunk } from "./chunk.js";
import { registerArrivalGenerator, registerDimensionGenerator, registerSpawnPointGenerator } from "./dimension.js";
import { veinDef, type VeinDef } from "./vein.js";
import { woodDef } from "./wood.js";
import type { World } from "./world.js";

/**
 * Overworld generation: biome-shaped heightmap terrain, lakes at sea level,
 * noise-carved caves, per-chunk ore veins and per-column trees.
 *
 * Everything here is a pure function of (seed, coordinates). Columns are
 * decided independently of chunks (surface, biome, trees), so neighboring
 * chunks always agree no matter which one is generated first.
 *
 * Coordinate convention: y grows downward. The surface sits around y = 0,
 * negative y is sky/mountain tops, positive y is underground.
 *
 * What's data (data/biomes/*.json, data/veins/*.json, data/woods/*.json,
 * see world/biome.ts, world/vein.ts, world/wood.ts) vs what stays code
 * here: which layers/trees/veins a biome has is data: a mod adds a
 * biome by dropping a JSON file, no code. The placement algorithm itself
 * (noise formulas, cave carving, the surface-height amplitude blend)
 * stays generic engine code that consumes that data - same "data
 * composes trusted behavior" split as multiblocks/dimensions/commands,
 * not because it *could* be data too, but because turning noise math
 * into a JSON DSL would just be a worse programming language.
 */

export const SEA_LEVEL = 6;
export const BEDROCK_Y = 256;

function biomeNoise(seed: number, x: number): number {
  return valueNoise1(hashSeed(seed, 0xb107e), x, 192);
}

function biomeDefAt(seed: number, x: number): BiomeDef {
  return biomeForNoise(biomeNoise(seed, x));
}

/** The registered biome id at column x - e.g. for structure placement
 * rules (structures/place.ts) or mob spawn gating (simulation.ts). */
export function biomeAt(seed: number, x: number): string {
  return biomeDefAt(seed, x).id;
}

/** Surface height (the y of the topmost solid block) at column x. */
export function surfaceHeight(seed: number, x: number): number {
  const b = biomeNoise(seed, x);
  // Blend amplitude by the same noise that picks biomes, so terrain
  // character changes smoothly instead of stepping at biome borders.
  // This blend is deliberately generic rather than per-biome data - it's
  // about smoothing the transition *between* biomes, not a property of
  // any one of them.
  const mountain = smoothstep01((b - 0.78) / 0.22);
  const flat = smoothstep01((0.26 - b) / 0.26);
  const coarse = (valueNoise1(seed, x, 64) - 0.5) * 2;
  const fine = (valueNoise1(hashSeed(seed, 0x5eed), x, 16) - 0.5) * 2;
  const amp = 10 * (1 - 0.55 * flat) + mountain * 30;
  return Math.round(coarse * amp + fine * (3 - 2 * flat) - mountain * 10);
}

/** First column at or near x = 0 that is dry land, used as world spawn. */
export function findSpawnX(seed: number): number {
  for (let r = 0; r <= 256; r++) {
    for (const x of r === 0 ? [0] : [r, -r]) {
      if (surfaceHeight(seed, x) <= SEA_LEVEL - 1) return x;
    }
  }
  return 0;
}

interface ColumnInfo {
  x: number;
  surface: number;
  biome: BiomeDef;
}

/** Patchy clay pockets in the sand layer right at the waterline. */
function isClayPatch(seed: number, x: number, y: number): boolean {
  return valueNoise2(hashSeed(seed, 0xc1a4), x, y, 5) > 0.72;
}

function terrainBlock(seed: number, y: number, col: ColumnInfo): BlockId {
  const { surface, biome } = col;
  if (y >= BEDROCK_Y) return BlockId.Bedrock;
  if (y < surface) {
    return y >= SEA_LEVEL ? BlockId.Water : BlockId.Air;
  }
  const depth = y - surface;
  const underwater = surface > SEA_LEVEL;
  const beach = !underwater && surface >= SEA_LEVEL - 1;
  if (underwater || beach) {
    if (biome.beachLayers) {
      for (const layer of biome.beachLayers) {
        if (depth <= layer.toDepth) return layer.block;
      }
      return biome.beachFloor!;
    }
    if (depth <= 2) return isClayPatch(seed, col.x, y) ? BlockId.Clay : BlockId.Sand;
    if (depth <= 5) return BlockId.Sandstone;
    return BlockId.Stone;
  }
  if (biome.snow && depth === 0 && surface <= biome.snow.atOrBelowSurface) return biome.snow.block;
  for (const layer of biome.layers) {
    if (depth <= layer.toDepth) return layer.block;
  }
  return biome.floor;
}

/** Spaghetti tunnels (ridged noise) plus deep caverns.
 * Note fbm concentrates values around 0.5, so the ridge band must be
 * narrow - a wide band carves most of the underground. */
function carveCaves(seed: number, chunk: Chunk, cols: readonly ColumnInfo[]): void {
  const s1 = hashSeed(seed, 0xca1e1);
  const s3 = hashSeed(seed, 0xca1e3);
  for (let lx = 0; lx < CHUNK_WIDTH; lx++) {
    const col = cols[lx]!;
    for (let ly = 0; ly < CHUNK_HEIGHT; ly++) {
      const y = chunk.cy * CHUNK_HEIGHT + ly;
      const depth = y - col.surface;
      if (depth < 4 || y >= BEDROCK_Y - 2) continue;
      const id = chunk.getBlock(lx, ly);
      if (id === BlockId.Air || id === BlockId.Water || id === BlockId.Bedrock) continue;
      // Stretch y so tunnels run mostly horizontally.
      const ys = y * 1.7;
      const width = 0.014 + Math.min(0.008, depth * 0.00006);
      const tunnel = Math.abs(fbm2(s1, col.x, ys, 56, 2) - 0.5) < width;
      const cavern = y > 120 && valueNoise2(s3, col.x, y * 1.4, 40) > 0.88;
      if (tunnel || cavern) {
        chunk.setBlock(lx, ly, BlockId.Air);
      }
    }
  }
}

function placeVeins(chunk: Chunk, rng: () => number, spec: VeinDef): void {
  for (let a = 0; a < spec.attempts; a++) {
    // Always draw the same number of samples so the rng stream stays
    // aligned regardless of whether this chunk intersects the y-range.
    const rx = rng();
    const ry = rng();
    const rs = rng();
    const lyMin = Math.max(0, spec.minY - chunk.cy * CHUNK_HEIGHT);
    const lyMax = Math.min(CHUNK_HEIGHT - 1, spec.maxY - chunk.cy * CHUNK_HEIGHT);
    if (lyMin > lyMax) continue;
    let lx = Math.floor(rx * CHUNK_WIDTH);
    let ly = lyMin + Math.floor(ry * (lyMax - lyMin + 1));
    const size = spec.sizeMin + Math.floor(rs * (spec.sizeMax - spec.sizeMin + 1));
    for (let i = 0; i < size; i++) {
      if (chunk.getBlock(lx, ly) === spec.host) {
        chunk.setBlock(lx, ly, spec.block);
      }
      const dir = Math.floor(rng() * 4);
      if (dir === 0) lx = Math.min(CHUNK_WIDTH - 1, lx + 1);
      else if (dir === 1) lx = Math.max(0, lx - 1);
      else if (dir === 2) ly = Math.min(CHUNK_HEIGHT - 1, ly + 1);
      else ly = Math.max(0, ly - 1);
    }
  }
}

function placeOres(seed: number, chunk: Chunk): void {
  const rng = createRng(hashSeed(seed, chunk.cx, chunk.cy, 0x03e5));
  // Placement order (global veins in their registered order, then this
  // column's biome's own extra veins) is part of world generation
  // determinism - each vein consumes a fixed slice of this rng stream,
  // see placeVeins - so it must stay stable for existing worlds to keep
  // generating identically.
  for (const id of GLOBAL_VEIN_IDS) {
    placeVeins(chunk, rng, veinDef(id)!);
  }
  const centerX = chunk.cx * CHUNK_WIDTH + CHUNK_WIDTH / 2;
  for (const veinId of biomeDefAt(seed, centerX).extraVeins) {
    placeVeins(chunk, rng, veinDef(veinId)!);
  }
}

const TREE_HASH = 0x7ee;
const TREE_CANOPY_RADIUS = 2;

/** Which wood grows at this column, weighted-picked from the biome's
 * tree_woods list in order - matches the pre-data-driven behavior
 * exactly when a biome has one dominant wood plus optional minority
 * woods before it (see data/biomes/forest.json). */
function treeWood(seed: number, x: number, biome: BiomeDef): string {
  const roll = hash01(seed, x, 0x7ee3);
  let cumulative = 0;
  for (const tw of biome.treeWoods) {
    cumulative += tw.weight;
    if (roll < cumulative) return tw.wood;
  }
  return biome.treeWoods[biome.treeWoods.length - 1]!.wood;
}

function hasTreeSeed(seed: number, x: number): boolean {
  const biome = biomeDefAt(seed, x);
  const p = biome.treeChance;
  if (p === 0) return false;
  if (surfaceHeight(seed, x) >= SEA_LEVEL - 1) return false; // no beach/underwater trees
  return hash01(seed, x, TREE_HASH) < p;
}

export interface Tree {
  x: number;
  surface: number;
  /** Total height above the surface, trunk plus canopy. */
  height: number;
  /** Wood id, see data/woods/*.json. */
  wood: string;
}

/** The tree rooted at column x, if any. Column-deterministic. */
export function treeAt(seed: number, x: number): Tree | null {
  if (!hasTreeSeed(seed, x)) return null;
  // Keep at least two columns between trunks (left neighbor wins).
  if (hasTreeSeed(seed, x - 1) || hasTreeSeed(seed, x - 2)) return null;
  const biome = biomeDefAt(seed, x);
  const wood = treeWood(seed, x, biome);
  const extra = woodDef(wood)?.extraHeight ?? 0;
  const height = 4 + extra + Math.floor(hash01(seed, x, 0x7ee2) * 3);
  return { x, surface: surfaceHeight(seed, x), height, wood };
}

function stampIfAir(chunk: Chunk, x: number, y: number, block: BlockId): void {
  const lx = x - chunk.cx * CHUNK_WIDTH;
  const ly = y - chunk.cy * CHUNK_HEIGHT;
  if (lx < 0 || lx >= CHUNK_WIDTH || ly < 0 || ly >= CHUNK_HEIGHT) return;
  if (chunk.getBlock(lx, ly) === BlockId.Air) {
    chunk.setBlock(lx, ly, block);
  }
}

function stampTrees(seed: number, chunk: Chunk): void {
  const x0 = chunk.cx * CHUNK_WIDTH;
  for (let x = x0 - TREE_CANOPY_RADIUS; x < x0 + CHUNK_WIDTH + TREE_CANOPY_RADIUS; x++) {
    const tree = treeAt(seed, x);
    if (!tree) continue;
    const { log, leaves, canopyShape } = woodDef(tree.wood)!;
    const topY = tree.surface - tree.height;
    for (let y = tree.surface - 1; y > topY; y--) {
      stampIfAir(chunk, x, y, log);
    }
    for (let dy = -2; dy <= 1; dy++) {
      // Narrow woods (e.g. spruce) get a pointy canopy.
      const rowRadius =
        canopyShape === "narrow"
          ? dy <= -1
            ? 1
            : TREE_CANOPY_RADIUS
          : dy === -2 || dy === 1
            ? 1
            : TREE_CANOPY_RADIUS;
      for (let dx = -rowRadius; dx <= rowRadius; dx++) {
        stampIfAir(chunk, x + dx, topY + dy, leaves);
      }
    }
  }
}

export function generateChunk(seed: number, cx: number, cy: number): Chunk {
  const chunk = new Chunk(cx, cy);

  const cols: ColumnInfo[] = [];
  for (let lx = 0; lx < CHUNK_WIDTH; lx++) {
    const x = cx * CHUNK_WIDTH + lx;
    cols.push({ x, surface: surfaceHeight(seed, x), biome: biomeDefAt(seed, x) });
  }

  for (let lx = 0; lx < CHUNK_WIDTH; lx++) {
    const col = cols[lx]!;
    for (let ly = 0; ly < CHUNK_HEIGHT; ly++) {
      const y = cy * CHUNK_HEIGHT + ly;
      chunk.setBlock(lx, ly, terrainBlock(seed, y, col));
      // Background walls: caves show earth instead of sky.
      if (y >= col.surface && y < BEDROCK_Y) {
        const depth = y - col.surface;
        const wall =
          col.biome.wallLayer && depth <= col.biome.wallLayer.toDepth ? col.biome.wallLayer.block : BlockId.Stone;
        chunk.setWall(lx, ly, wall);
      }
    }
  }

  carveCaves(seed, chunk, cols);
  placeOres(seed, chunk);
  stampTrees(seed, chunk);
  return chunk;
}

function overworldArrival(world: World, xt: number): number {
  return surfaceHeight(world.seed, xt) - 1;
}

function overworldSpawnPoint(seed: number): { x: number; y: number } {
  const spawnX = findSpawnX(seed);
  return { x: spawnX + 0.5, y: surfaceHeight(seed, spawnX) };
}

// Registered under data/dimensions/overworld.json's "generator"/
// "arrival"/"spawn_point" ids - see world/dimension.ts for why
// generation is referenced by id rather than the overworld dimension
// calling this function directly.
registerDimensionGenerator("flatcraft:overworld", generateChunk);
registerArrivalGenerator("flatcraft:overworld_arrival", overworldArrival);
registerSpawnPointGenerator("flatcraft:overworld_spawn_point", overworldSpawnPoint);
