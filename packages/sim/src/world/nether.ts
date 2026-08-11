import { CHUNK_HEIGHT, CHUNK_WIDTH } from "../constants.js";
import { fbm2 } from "../math/noise.js";
import { hashSeed } from "../math/rng.js";
import { BlockId } from "./block.js";
import { Chunk } from "./chunk.js";

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
  const sGlow = hashSeed(seed, 0x0e712);
  const sSoul = hashSeed(seed, 0x0e713);
  const sBasalt = hashSeed(seed, 0x0e714);

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
        } else if (y < NETHER_CEILING + 20 && fbm2(sGlow, x, y, 14, 2) > 0.66) {
          block = BlockId.Glowstone;
        } else if (y > LAVA_LEVEL - 18 && fbm2(sSoul, x, y, 24, 2) > 0.7) {
          block = BlockId.SoulSand;
        } else if (y > LAVA_LEVEL - 24 && fbm2(sBasalt, x, y, 20, 2) > 0.74) {
          block = BlockId.Basalt;
        } else {
          block = BlockId.Netherrack;
        }
      }
      chunk.setBlock(lx, ly, block);
    }
  }
  return chunk;
}
