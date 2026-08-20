import { CHUNK_HEIGHT, CHUNK_WIDTH } from "../constants.js";
import { STRUCTURES } from "../data/structures/index.js";
import type { ItemStack } from "../inventory.js";
import { hash01 } from "../math/noise.js";
import { createRng, hashSeed } from "../math/rng.js";
import { biomeAt, surfaceHeight } from "../world/gen.js";
import type { Chunk } from "../world/chunk.js";
import type { Dimension } from "../world/world.js";
import type { LootEntry, Structure } from "./structure.js";

/**
 * Deterministic structure placement. Each chunk may host each structure's
 * anchor with placement.chance, at a hash-derived offset; any chunk that
 * a structure overlaps stamps its slice, so results never depend on the
 * order chunks are generated in.
 */

export interface Placement {
  structure: Structure;
  /** World tile of the pattern's top-left cell. */
  originX: number;
  originY: number;
}

function anchorPlacement(seed: number, structure: Structure, index: number, cx: number, cy: number): Placement | null {
  const roll = hash01(seed, cx, cy, 0x57a0 + index);
  if (roll >= structure.placement.chance) return null;

  const lx = Math.floor(hash01(seed, cx, cy, 0x57a1 + index) * CHUNK_WIDTH);
  const anchorX = cx * CHUNK_WIDTH + lx;

  let anchorY: number;
  if (structure.placement.type === "surface") {
    // Surface structures anchor on the terrain; only the chunk containing
    // the surface hosts them (so each x spawns at most once).
    anchorY = surfaceHeight(seed, anchorX) - 1;
    if (Math.floor(anchorY / CHUNK_HEIGHT) !== cy) return null;
    if (structure.placement.biomes) {
      const biome = biomeAt(seed, anchorX);
      if (!structure.placement.biomes.includes(biome)) return null;
    }
  } else {
    const { minY, maxY } = structure.placement;
    anchorY = minY + Math.floor(hash01(seed, cx, cy, 0x57a2 + index) * (maxY - minY));
    if (Math.floor(anchorY / CHUNK_HEIGHT) !== cy) return null;
  }

  return {
    structure,
    originX: anchorX - structure.anchor[0],
    originY: anchorY - structure.anchor[1],
  };
}

/** All placements whose pattern could intersect the given chunk. */
export function placementsNear(seed: number, dimension: Dimension, cx: number, cy: number): Placement[] {
  const result: Placement[] = [];
  STRUCTURES.forEach((structure, index) => {
    if (structure.dimension !== dimension) return;
    // Structures are smaller than a chunk, so anchors within one chunk
    // radius cover all possible overlaps.
    for (let acy = cy - 1; acy <= cy + 1; acy++) {
      for (let acx = cx - 1; acx <= cx + 1; acx++) {
        const placement = anchorPlacement(seed, structure, index, acx, acy);
        if (placement) result.push(placement);
      }
    }
  });
  return result;
}

/** Stamp every intersecting structure slice into a freshly generated chunk. */
export function stampStructures(seed: number, dimension: Dimension, chunk: Chunk): void {
  const x0 = chunk.cx * CHUNK_WIDTH;
  const y0 = chunk.cy * CHUNK_HEIGHT;
  for (const { structure, originX, originY } of placementsNear(seed, dimension, chunk.cx, chunk.cy)) {
    for (let row = 0; row < structure.height; row++) {
      const y = originY + row;
      if (y < y0 || y >= y0 + CHUNK_HEIGHT) continue;
      for (let col = 0; col < structure.width; col++) {
        const x = originX + col;
        if (x < x0 || x >= x0 + CHUNK_WIDTH) continue;
        const cell = structure.cells[row]![col];
        if (!cell) continue;
        chunk.setBlock(x - x0, y - y0, cell.block);
      }
    }
  }
}

/** The rolled loot for a structure chest at (x, y), if one is placed there. */
export function structureLootAt(seed: number, dimension: Dimension, x: number, y: number): ItemStack[] | null {
  const cx = Math.floor(x / CHUNK_WIDTH);
  const cy = Math.floor(y / CHUNK_HEIGHT);
  for (const { structure, originX, originY } of placementsNear(seed, dimension, cx, cy)) {
    const col = x - originX;
    const row = y - originY;
    if (col < 0 || col >= structure.width || row < 0 || row >= structure.height) continue;
    const cell = structure.cells[row]?.[col];
    if (!cell?.loot) continue;
    return rollLoot(seed, x, y, cell.loot);
  }
  return null;
}

function rollLoot(seed: number, x: number, y: number, loot: LootEntry[]): ItemStack[] {
  const rng = createRng(hashSeed(seed, x, y, 0x1007));
  const stacks: ItemStack[] = [];
  for (const entry of loot) {
    const roll = rng();
    const countRoll = rng();
    if (roll < (entry.chance ?? 1)) {
      stacks.push({ item: entry.item, count: 1 + Math.floor(countRoll * entry.count) });
    }
  }
  return stacks;
}
