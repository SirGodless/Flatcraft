import { Container, RenderTexture, Sprite, type Renderer as PixiRenderer, type Texture } from "pixi.js";
import { blockDef, BlockId, CHUNK_HEIGHT, CHUNK_WIDTH, chunkKey } from "@flatcraft/sim";
import { pickBlockTexture, TILE_PX } from "./textures.js";

export const CHUNK_PX_W = CHUNK_WIDTH * TILE_PX;
export const CHUNK_PX_H = CHUNK_HEIGHT * TILE_PX;

interface ChunkView {
  cx: number;
  cy: number;
  tiles: Uint16Array;
  walls: Uint16Array;
  sprite: Sprite;
  target: RenderTexture;
}

/** A baked tile whose block def declares visual.animation or visual.shader
 * - the baked chunk texture only ever shows its static base look, so
 * anything that needs to move or shimmer needs a separate always-live
 * sprite on top (see Renderer's blockOverlays). `texture` is exactly what
 * bake() already drew into the chunk at this position (post variant-pick),
 * so the overlay starts out pixel-identical to the base underneath it. */
export interface OverlayTile {
  worldX: number;
  worldY: number;
  id: BlockId;
  texture: Texture;
}

function hasOverlayVisual(id: BlockId): boolean {
  const visual = blockDef(id)?.visual;
  return visual?.animation !== undefined || visual?.shader !== undefined;
}

/**
 * The client's mirror of the visible world. Each chunk it has received is
 * baked into a RenderTexture (one draw per chunk per frame instead of one
 * per tile). Block changes only mark the chunk dirty; flush() re-bakes
 * every dirty chunk at most once per frame, so a burst of changes (e.g.
 * flowing water) costs one bake instead of one per event.
 */
export class WorldView {
  readonly container = new Container();

  private readonly chunks = new Map<string, ChunkView>();
  private readonly dirty = new Set<ChunkView>();
  /** Keyed by "worldX,worldY" - tiles the last bake found with an
   * overlay-worthy visual. Rebuilt per-chunk on every (re-)bake, so a
   * block placed/broken on top of one of these updates it too. */
  private readonly overlayTiles = new Map<string, OverlayTile>();

  constructor(
    private readonly renderer: PixiRenderer,
    private readonly blockTextures: Map<BlockId, Texture>,
    private readonly blockTextureVariants: Map<BlockId, Texture[]>,
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
    this.dirty.clear();
    this.overlayTiles.clear();
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
        cx,
        cy,
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
    this.dirty.add(view);
  }

  setBlock(x: number, y: number, block: BlockId): void {
    const cx = Math.floor(x / CHUNK_WIDTH);
    const cy = Math.floor(y / CHUNK_HEIGHT);
    const view = this.chunks.get(chunkKey(cx, cy));
    if (!view) return;
    const lx = x - cx * CHUNK_WIDTH;
    const ly = y - cy * CHUNK_HEIGHT;
    const index = ly * CHUNK_WIDTH + lx;
    if (view.tiles[index] === block) return;
    view.tiles[index] = block;
    this.dirty.add(view);
  }

  setWall(x: number, y: number, block: BlockId): void {
    const cx = Math.floor(x / CHUNK_WIDTH);
    const cy = Math.floor(y / CHUNK_HEIGHT);
    const view = this.chunks.get(chunkKey(cx, cy));
    if (!view) return;
    const lx = x - cx * CHUNK_WIDTH;
    const ly = y - cy * CHUNK_HEIGHT;
    const index = ly * CHUNK_WIDTH + lx;
    if (view.walls[index] === block) return;
    view.walls[index] = block;
    this.dirty.add(view);
  }

  /** Re-bake every chunk touched since the last call (once per frame). */
  flush(): void {
    for (const view of this.dirty) {
      this.bake(view);
    }
    this.dirty.clear();
  }

  private bake(view: ChunkView): void {
    // Re-scan from scratch: old entries for this chunk's tile range may no
    // longer be valid (block placed/broken since the last bake), and
    // there's no cheap way to diff against the pre-mutation state.
    const originX = view.cx * CHUNK_WIDTH;
    const originY = view.cy * CHUNK_HEIGHT;
    for (let ly = 0; ly < CHUNK_HEIGHT; ly++) {
      for (let lx = 0; lx < CHUNK_WIDTH; lx++) {
        this.overlayTiles.delete(`${originX + lx},${originY + ly}`);
      }
    }
    const scratch = new Container();
    // Background walls first, darkened, so caves show earth instead of sky.
    for (let ly = 0; ly < CHUNK_HEIGHT; ly++) {
      for (let lx = 0; lx < CHUNK_WIDTH; lx++) {
        const wall = (view.walls[ly * CHUNK_WIDTH + lx] ?? 0) as BlockId;
        if (wall === BlockId.Air) continue;
        const worldX = view.cx * CHUNK_WIDTH + lx;
        const worldY = view.cy * CHUNK_HEIGHT + ly;
        const texture = pickBlockTexture(this.blockTextures, this.blockTextureVariants, wall, worldX, worldY);
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
        const worldX = view.cx * CHUNK_WIDTH + lx;
        const worldY = view.cy * CHUNK_HEIGHT + ly;
        const texture = pickBlockTexture(this.blockTextures, this.blockTextureVariants, id, worldX, worldY);
        if (!texture) continue;
        const sprite = new Sprite(texture);
        sprite.position.set(lx * TILE_PX, ly * TILE_PX);
        scratch.addChild(sprite);
        if (hasOverlayVisual(id)) {
          this.overlayTiles.set(`${worldX},${worldY}`, { worldX, worldY, id, texture });
        }
      }
    }
    this.renderer.render({ container: scratch, target: view.target, clear: true });
    scratch.destroy({ children: true });
  }

  /** Overlay-eligible tiles within the given world-tile bounds (inclusive)
   * - Renderer culls to this per frame so the live overlay sprite count
   * tracks the viewport, not the whole explored world. */
  overlaysInView(minX: number, minY: number, maxX: number, maxY: number): OverlayTile[] {
    const result: OverlayTile[] = [];
    for (const tile of this.overlayTiles.values()) {
      if (tile.worldX >= minX && tile.worldX <= maxX && tile.worldY >= minY && tile.worldY <= maxY) {
        result.push(tile);
      }
    }
    return result;
  }
}
