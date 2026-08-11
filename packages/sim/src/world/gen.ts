import { CHUNK_HEIGHT, CHUNK_WIDTH } from "../constants.js";
import { hashSeed } from "../math/rng.js";
import { BlockId } from "./block.js";
import { Chunk } from "./chunk.js";

/**
 * Placeholder terrain generation: a smooth heightmap of grass/dirt/stone.
 * Deliberately simple - real world generation (biomes, caves, ores, nether)
 * is roadmap step 3 and will replace the interior of generateChunk.
 *
 * Coordinate convention: y grows downward. The surface sits around y = 0,
 * negative y is sky, positive y is underground.
 */

const BEDROCK_Y = 256;
const DIRT_DEPTH = 4;

function latticeValue(seed: number, period: number, index: number): number {
  return hashSeed(seed, period, index) / 0xffffffff;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 1D value noise in [0, 1], continuous in x, fully determined by the seed. */
function valueNoise(seed: number, x: number, period: number): number {
  const i = Math.floor(x / period);
  const t = (x - i * period) / period;
  const a = latticeValue(seed, period, i);
  const b = latticeValue(seed, period, i + 1);
  return a + (b - a) * smoothstep(t);
}

/** Surface height (the y of the grass block) at column x. */
export function surfaceHeight(seed: number, x: number): number {
  const coarse = (valueNoise(seed, x, 64) - 0.5) * 2 * 16;
  const fine = (valueNoise(hashSeed(seed, 0x5eed), x, 16) - 0.5) * 2 * 4;
  return Math.round(coarse + fine);
}

export function generateChunk(seed: number, cx: number, cy: number): Chunk {
  const chunk = new Chunk(cx, cy);
  for (let lx = 0; lx < CHUNK_WIDTH; lx++) {
    const x = cx * CHUNK_WIDTH + lx;
    const surface = surfaceHeight(seed, x);
    for (let ly = 0; ly < CHUNK_HEIGHT; ly++) {
      const y = cy * CHUNK_HEIGHT + ly;
      let block: BlockId;
      if (y < surface) {
        block = BlockId.Air;
      } else if (y >= BEDROCK_Y) {
        block = BlockId.Bedrock;
      } else if (y === surface) {
        block = BlockId.Grass;
      } else if (y <= surface + DIRT_DEPTH) {
        block = BlockId.Dirt;
      } else {
        block = BlockId.Stone;
      }
      chunk.setBlock(lx, ly, block);
    }
  }
  return chunk;
}
