import { CHUNK_HEIGHT, CHUNK_WIDTH } from "../constants.js";
import { fbm2, hash01, smoothstep01, valueNoise1, valueNoise2 } from "../math/noise.js";
import { createRng, hashSeed } from "../math/rng.js";
import { BlockId } from "./block.js";
import { Chunk } from "./chunk.js";

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
 */

export const SEA_LEVEL = 6;
export const BEDROCK_Y = 256;
const DIRT_DEPTH = 4;
const SNOW_LINE = -14;

export enum Biome {
  Desert = 0,
  Plains = 1,
  Forest = 2,
  Mountains = 3,
}

function biomeNoise(seed: number, x: number): number {
  return valueNoise1(hashSeed(seed, 0xb107e), x, 192);
}

export function biomeAt(seed: number, x: number): Biome {
  const b = biomeNoise(seed, x);
  if (b < 0.22) return Biome.Desert;
  if (b < 0.55) return Biome.Plains;
  if (b < 0.8) return Biome.Forest;
  return Biome.Mountains;
}

/** Surface height (the y of the topmost solid block) at column x. */
export function surfaceHeight(seed: number, x: number): number {
  const b = biomeNoise(seed, x);
  // Blend amplitude by the same noise that picks biomes, so terrain
  // character changes smoothly instead of stepping at biome borders.
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
  biome: Biome;
}

function terrainBlock(y: number, col: ColumnInfo): BlockId {
  const { surface, biome } = col;
  if (y >= BEDROCK_Y) return BlockId.Bedrock;
  if (y < surface) {
    return y >= SEA_LEVEL ? BlockId.Water : BlockId.Air;
  }
  const depth = y - surface;
  const underwater = surface > SEA_LEVEL;
  const beach = !underwater && surface >= SEA_LEVEL - 1;
  if (underwater || beach) {
    if (depth <= 2) return BlockId.Sand;
    if (depth <= 5) return BlockId.Sandstone;
    return BlockId.Stone;
  }
  if (biome === Biome.Desert) {
    if (depth <= 3) return BlockId.Sand;
    if (depth <= 7) return BlockId.Sandstone;
    return BlockId.Stone;
  }
  if (biome === Biome.Mountains) {
    if (depth === 0 && surface <= SNOW_LINE) return BlockId.Snow;
    return BlockId.Stone;
  }
  if (depth === 0) return BlockId.Grass;
  if (depth <= DIRT_DEPTH) return BlockId.Dirt;
  return BlockId.Stone;
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

interface VeinSpec {
  block: BlockId;
  attempts: number;
  sizeMin: number;
  sizeMax: number;
  minY: number;
  maxY: number;
}

const VEINS: readonly VeinSpec[] = [
  { block: BlockId.Gravel, attempts: 3, sizeMin: 6, sizeMax: 12, minY: 12, maxY: 255 },
  { block: BlockId.CoalOre, attempts: 5, sizeMin: 4, sizeMax: 10, minY: 2, maxY: 255 },
  { block: BlockId.IronOre, attempts: 4, sizeMin: 3, sizeMax: 6, minY: 24, maxY: 255 },
  { block: BlockId.LapisOre, attempts: 1, sizeMin: 2, sizeMax: 5, minY: 48, maxY: 160 },
  { block: BlockId.GoldOre, attempts: 2, sizeMin: 2, sizeMax: 5, minY: 80, maxY: 255 },
  { block: BlockId.RedstoneOre, attempts: 2, sizeMin: 3, sizeMax: 6, minY: 176, maxY: 255 },
  { block: BlockId.DiamondOre, attempts: 1, sizeMin: 2, sizeMax: 5, minY: 192, maxY: 255 },
];

/** Emerald appears only under mountain biomes, in small veins. */
const EMERALD: VeinSpec = {
  block: BlockId.EmeraldOre,
  attempts: 2,
  sizeMin: 1,
  sizeMax: 2,
  minY: 8,
  maxY: 96,
};

function placeVeins(chunk: Chunk, rng: () => number, spec: VeinSpec): void {
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
      if (chunk.getBlock(lx, ly) === BlockId.Stone) {
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
  for (const spec of VEINS) {
    placeVeins(chunk, rng, spec);
  }
  const centerX = chunk.cx * CHUNK_WIDTH + CHUNK_WIDTH / 2;
  if (biomeAt(seed, centerX) === Biome.Mountains) {
    placeVeins(chunk, rng, EMERALD);
  }
}

const TREE_HASH = 0x7ee;
const TREE_CANOPY_RADIUS = 2;

function treeChance(biome: Biome): number {
  if (biome === Biome.Forest) return 0.16;
  if (biome === Biome.Plains) return 0.04;
  return 0;
}

function hasTreeSeed(seed: number, x: number): boolean {
  const p = treeChance(biomeAt(seed, x));
  if (p === 0) return false;
  if (surfaceHeight(seed, x) >= SEA_LEVEL - 1) return false; // no beach/underwater trees
  return hash01(seed, x, TREE_HASH) < p;
}

export interface Tree {
  x: number;
  surface: number;
  /** Total height above the surface, trunk plus canopy. */
  height: number;
}

/** The tree rooted at column x, if any. Column-deterministic. */
export function treeAt(seed: number, x: number): Tree | null {
  if (!hasTreeSeed(seed, x)) return null;
  // Keep at least two columns between trunks (left neighbor wins).
  if (hasTreeSeed(seed, x - 1) || hasTreeSeed(seed, x - 2)) return null;
  const height = 4 + Math.floor(hash01(seed, x, 0x7ee2) * 3);
  return { x, surface: surfaceHeight(seed, x), height };
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
    const topY = tree.surface - tree.height;
    for (let y = tree.surface - 1; y > topY; y--) {
      stampIfAir(chunk, x, y, BlockId.OakLog);
    }
    for (let dy = -2; dy <= 1; dy++) {
      const rowRadius = dy === -2 || dy === 1 ? 1 : TREE_CANOPY_RADIUS;
      for (let dx = -rowRadius; dx <= rowRadius; dx++) {
        stampIfAir(chunk, x + dx, topY + dy, BlockId.OakLeaves);
      }
    }
  }
}

export function generateChunk(seed: number, cx: number, cy: number): Chunk {
  const chunk = new Chunk(cx, cy);

  const cols: ColumnInfo[] = [];
  for (let lx = 0; lx < CHUNK_WIDTH; lx++) {
    const x = cx * CHUNK_WIDTH + lx;
    cols.push({ x, surface: surfaceHeight(seed, x), biome: biomeAt(seed, x) });
  }

  for (let lx = 0; lx < CHUNK_WIDTH; lx++) {
    const col = cols[lx]!;
    for (let ly = 0; ly < CHUNK_HEIGHT; ly++) {
      chunk.setBlock(lx, ly, terrainBlock(cy * CHUNK_HEIGHT + ly, col));
    }
  }

  carveCaves(seed, chunk, cols);
  placeOres(seed, chunk);
  stampTrees(seed, chunk);
  return chunk;
}
