import { CHUNK_HEIGHT, CHUNK_WIDTH } from "../constants.js";
import { BlockId } from "./block.js";

/**
 * A fixed-size grid of tiles. Chunks are flat typed arrays so they can be
 * serialized cheaply (network sync later, save files now).
 */
export class Chunk {
  readonly cx: number;
  readonly cy: number;
  readonly tiles: Uint16Array;
  /** Background wall layer (purely visual backdrop, e.g. cave walls). */
  readonly walls: Uint16Array;

  constructor(cx: number, cy: number, tiles?: Uint16Array, walls?: Uint16Array) {
    this.cx = cx;
    this.cy = cy;
    this.tiles = tiles ?? new Uint16Array(CHUNK_WIDTH * CHUNK_HEIGHT);
    this.walls = walls ?? new Uint16Array(CHUNK_WIDTH * CHUNK_HEIGHT);
  }

  getBlock(localX: number, localY: number): BlockId {
    return (this.tiles[localY * CHUNK_WIDTH + localX] ?? 0) as BlockId;
  }

  setBlock(localX: number, localY: number, id: BlockId): void {
    this.tiles[localY * CHUNK_WIDTH + localX] = id;
  }

  getWall(localX: number, localY: number): BlockId {
    return (this.walls[localY * CHUNK_WIDTH + localX] ?? 0) as BlockId;
  }

  setWall(localX: number, localY: number, id: BlockId): void {
    this.walls[localY * CHUNK_WIDTH + localX] = id;
  }
}

export function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}
