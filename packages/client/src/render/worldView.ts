import { Container, RenderTexture, Sprite, type Renderer as PixiRenderer, type Texture } from "pixi.js";
import { BlockId, CHUNK_HEIGHT, CHUNK_WIDTH, chunkKey } from "@flatcraft/sim";
import { TILE_PX } from "./textures.js";

export const CHUNK_PX_W = CHUNK_WIDTH * TILE_PX;
export const CHUNK_PX_H = CHUNK_HEIGHT * TILE_PX;

interface ChunkView {
  tiles: Uint16Array;
  walls: Uint16Array;
  sprite: Sprite;
  target: RenderTexture;
}

/**
 * The client's mirror of the visible world. Each chunk it has received is
 * baked into a RenderTexture (one draw per chunk per frame instead of one
 * per tile) and re-baked when a block in it changes.
 */
export class WorldView {
  readonly container = new Container();

  private readonly chunks = new Map<string, ChunkView>();

  constructor(
    private readonly renderer: PixiRenderer,
    private readonly blockTextures: Map<BlockId, Texture>,
  ) {}

  hasChunk(cx: number, cy: number): boolean {
    return this.chunks.has(chunkKey(cx, cy));
  }

  /** Drop all chunks (dimension switch). */
  clear(): void {
    for (const view of this.chunks.values()) {
      view.sprite.destroy();
      view.target.destroy(true);
    }
    this.chunks.clear();
  }

  /** The client's view of a tile (Air for unloaded chunks). */
  getBlock(x: number, y: number): BlockId {
    const cx = Math.floor(x / CHUNK_WIDTH);
    const cy = Math.floor(y / CHUNK_HEIGHT);
    const view = this.chunks.get(chunkKey(cx, cy));
    if (!view) return BlockId.Air;
    const lx = x - cx * CHUNK_WIDTH;
    const ly = y - cy * CHUNK_HEIGHT;
    return (view.tiles[ly * CHUNK_WIDTH + lx] ?? 0) as BlockId;
  }

  setChunk(cx: number, cy: number, tiles: readonly number[], walls?: readonly number[]): void {
    const key = chunkKey(cx, cy);
    let view = this.chunks.get(key);
    if (!view) {
      const target = RenderTexture.create({ width: CHUNK_PX_W, height: CHUNK_PX_H });
      target.source.scaleMode = "nearest";
      const sprite = new Sprite(target);
      sprite.position.set(cx * CHUNK_PX_W, cy * CHUNK_PX_H);
      this.container.addChild(sprite);
      view = {
        tiles: new Uint16Array(tiles),
        walls: walls ? new Uint16Array(walls) : new Uint16Array(tiles.length),
        sprite,
        target,
      };
      this.chunks.set(key, view);
    } else {
      view.tiles.set(tiles);
      if (walls) view.walls.set(walls);
    }
    this.bake(view);
  }

  setBlock(x: number, y: number, block: BlockId): void {
    const cx = Math.floor(x / CHUNK_WIDTH);
    const cy = Math.floor(y / CHUNK_HEIGHT);
    const view = this.chunks.get(chunkKey(cx, cy));
    if (!view) return;
    const lx = x - cx * CHUNK_WIDTH;
    const ly = y - cy * CHUNK_HEIGHT;
    view.tiles[ly * CHUNK_WIDTH + lx] = block;
    this.bake(view);
  }

  private bake(view: ChunkView): void {
    const scratch = new Container();
    // Background walls first, darkened, so caves show earth instead of sky.
    for (let ly = 0; ly < CHUNK_HEIGHT; ly++) {
      for (let lx = 0; lx < CHUNK_WIDTH; lx++) {
        const wall = (view.walls[ly * CHUNK_WIDTH + lx] ?? 0) as BlockId;
        if (wall === BlockId.Air) continue;
        const texture = this.blockTextures.get(wall);
        if (!texture) continue;
        const sprite = new Sprite(texture);
        sprite.tint = 0x5a5a66;
        sprite.position.set(lx * TILE_PX, ly * TILE_PX);
        scratch.addChild(sprite);
      }
    }
    for (let ly = 0; ly < CHUNK_HEIGHT; ly++) {
      for (let lx = 0; lx < CHUNK_WIDTH; lx++) {
        const id = (view.tiles[ly * CHUNK_WIDTH + lx] ?? 0) as BlockId;
        if (id === BlockId.Air) continue;
        const texture = this.blockTextures.get(id);
        if (!texture) continue;
        const sprite = new Sprite(texture);
        sprite.position.set(lx * TILE_PX, ly * TILE_PX);
        scratch.addChild(sprite);
      }
    }
    this.renderer.render({ container: scratch, target: view.target, clear: true });
    scratch.destroy({ children: true });
  }
}
