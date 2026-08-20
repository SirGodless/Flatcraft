import { CHUNK_HEIGHT, CHUNK_WIDTH } from "../constants.js";
import { fbm2 } from "../math/noise.js";
import { hashSeed } from "../math/rng.js";
import { blockDef, BlockId } from "./block.js";
import { Chunk } from "./chunk.js";
import { registerArrivalGenerator, registerDimensionGenerator } from "./dimension.js";
import { netherLayerBlock } from "./netherLayer.js";
import type { World } from "./world.js";

/**
 * Nether generation: a bedrock-capped slab of netherrack with huge
 * noise-carved caverns, a lava sea at the bottom, glowstone near the
 * ceiling and soul sand / basalt patches. Pure per-chunk function of the
 * seed, like the overworld.
 */

export const NETHER_CEILING = -40;
export const NETHER_FLOOR = 88;
export const LAVA_LEVEL = 60;

export function generateNetherChunk(seed: number, cx: number, cy: number): Chunk {
  const chunk = new Chunk(cx, cy);
  const sCarve = hashSeed(seed, 0x0e711);

  for (let lx = 0; lx < CHUNK_WIDTH; lx++) {
    const x = cx * CHUNK_WIDTH + lx;
    for (let ly = 0; ly < CHUNK_HEIGHT; ly++) {
      const y = cy * CHUNK_HEIGHT + ly;

      let block: BlockId;
      if (y <= NETHER_CEILING || y >= NETHER_FLOOR) {
        block = BlockId.Bedrock;
      } else {
        const open = fbm2(sCarve, x, y * 1.3, 44, 3) > 0.53;
        if (open) {
          block = y >= LAVA_LEVEL ? BlockId.Lava : BlockId.Air;
        } else {
          block = netherLayerBlock(seed, x, y) ?? BlockId.Netherrack;
        }
      }
      chunk.setBlock(lx, ly, block);
      if (y > NETHER_CEILING && y < NETHER_FLOOR) {
        chunk.setWall(lx, ly, BlockId.Netherrack);
      }
    }
  }
  return chunk;
}

/** Finds open floor space in the nether band for a portal to arrive on,
 * else carves one at y=40. */
function netherArrival(world: World, xt: number): number {
  for (let y = 10; y < LAVA_LEVEL - 4; y++) {
    const floorSolid = blockDef(world.getBlockGenerating(xt, y + 1)).solid;
    const space =
      world.getBlockGenerating(xt, y) === BlockId.Air && world.getBlockGenerating(xt, y - 1) === BlockId.Air;
    if (floorSolid && space) return y;
  }
  return 40;
}

// Registered under data/dimensions/nether.json's "generator"/"arrival"
// ids - see world/dimension.ts.
registerDimensionGenerator("flatcraft:dimension_generator:nether", generateNetherChunk);
registerArrivalGenerator("flatcraft:arrival_generator:nether_arrival", netherArrival);
