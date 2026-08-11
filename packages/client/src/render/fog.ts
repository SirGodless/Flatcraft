import { Container, Sprite, Texture } from "pixi.js";
import { blockDef, BlockId, CHUNK_HEIGHT, CHUNK_WIDTH } from "@flatcraft/sim";
import { TILE_PX } from "./textures.js";
import type { WorldView } from "./worldView.js";

/**
 * Fog of war: simple line-of-sight visibility around the player, capped
 * at FOG_RADIUS tiles. Computed as a BFS through non-solid tiles (solid
 * tiles at the boundary stay visible, so cave walls read correctly).
 * Purely cosmetic and client-side.
 *
 * Tiles seen once are remembered per dimension: explored-but-not-visible
 * areas render dimmed instead of black (persisted alongside the world).
 *
 * The active miner potion effect reveals ore tiles through the fog.
 */
export const FOG_RADIUS = 40;

/** Veil alpha over never-seen tiles. */
const UNSEEN_ALPHA = 0.96;
/** Veil alpha over explored tiles that are out of sight right now. */
const EXPLORED_ALPHA = 0.8;

const REVEALED_ORES = new Set<number>([
  BlockId.CoalOre,
  BlockId.IronOre,
  BlockId.GoldOre,
  BlockId.LapisOre,
  BlockId.RedstoneOre,
  BlockId.DiamondOre,
  BlockId.EmeraldOre,
  BlockId.Obsidian,
]);

const SIZE = FOG_RADIUS * 2 + 1;

export class FogOfWar {
  readonly container = new Container();

  private readonly canvas = document.createElement("canvas");
  private readonly texture: Texture;
  private readonly sprite: Sprite;
  private readonly oreLayer = new Container();
  private readonly dist = new Float64Array(SIZE * SIZE);
  private readonly queue = new Int32Array(SIZE * SIZE * 2);
  /** Explored tiles per chunk, keyed "dim:cx,cy" (1 byte per tile). */
  private explored = new Map<string, Uint8Array>();

  constructor(private readonly blockTextures: Map<BlockId, Texture>) {
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.texture = Texture.from(this.canvas);
    this.sprite = new Sprite(this.texture);
    // 1 canvas pixel = 1 tile; linear filtering gives soft fog edges.
    this.sprite.scale.set(TILE_PX);
    this.container.addChild(this.sprite);
    this.container.addChild(this.oreLayer);
  }

  /** The exploration memory, for persisting (typed arrays survive IndexedDB). */
  get memory(): Map<string, Uint8Array> {
    return this.explored;
  }

  setMemory(data: Map<string, Uint8Array>): void {
    this.explored = data;
  }

  private markExplored(dim: string, wx: number, wy: number): void {
    const cx = Math.floor(wx / CHUNK_WIDTH);
    const cy = Math.floor(wy / CHUNK_HEIGHT);
    const key = `${dim}:${cx},${cy}`;
    let chunk = this.explored.get(key);
    if (!chunk) {
      chunk = new Uint8Array(CHUNK_WIDTH * CHUNK_HEIGHT);
      this.explored.set(key, chunk);
    }
    chunk[(wy - cy * CHUNK_HEIGHT) * CHUNK_WIDTH + (wx - cx * CHUNK_WIDTH)] = 1;
  }

  private isExplored(dim: string, wx: number, wy: number): boolean {
    const cx = Math.floor(wx / CHUNK_WIDTH);
    const cy = Math.floor(wy / CHUNK_HEIGHT);
    const chunk = this.explored.get(`${dim}:${cx},${cy}`);
    return chunk !== undefined && chunk[(wy - cy * CHUNK_HEIGHT) * CHUNK_WIDTH + (wx - cx * CHUNK_WIDTH)] === 1;
  }

  /** Recompute visibility around the player (feet-center tile coords). */
  update(px: number, py: number, world: WorldView, minerActive: boolean, dim: string): void {
    const cx = Math.floor(px);
    const cy = Math.floor(py);
    const dist = this.dist;
    dist.fill(Infinity);

    // BFS from the player through passable tiles.
    let head = 0;
    let tail = 0;
    const push = (gx: number, gy: number, d: number): void => {
      dist[gy * SIZE + gx] = d;
      this.queue[tail * 2] = gx;
      this.queue[tail * 2 + 1] = gy;
      tail++;
    };
    push(FOG_RADIUS, FOG_RADIUS, 0);
    while (head < tail) {
      const gx = this.queue[head * 2]!;
      const gy = this.queue[head * 2 + 1]!;
      head++;
      const d = dist[gy * SIZE + gx]!;
      if (d >= FOG_RADIUS) continue;
      const block = world.getBlock(cx - FOG_RADIUS + gx, cy - FOG_RADIUS + gy);
      // Solid tiles are visible but light doesn't pass through them.
      if (blockDef(block).solid && !(gx === FOG_RADIUS && gy === FOG_RADIUS)) continue;
      if (gx > 0 && dist[gy * SIZE + gx - 1] === Infinity) push(gx - 1, gy, d + 1);
      if (gx < SIZE - 1 && dist[gy * SIZE + gx + 1] === Infinity) push(gx + 1, gy, d + 1);
      if (gy > 0 && dist[(gy - 1) * SIZE + gx] === Infinity) push(gx, gy - 1, d + 1);
      if (gy < SIZE - 1 && dist[(gy + 1) * SIZE + gx] === Infinity) push(gx, gy + 1, d + 1);
    }

    // Paint the veil: never seen = near-black, explored = dimmed,
    // visible fades in near the rim.
    const ctx = this.canvas.getContext("2d")!;
    ctx.clearRect(0, 0, SIZE, SIZE);
    for (let gy = 0; gy < SIZE; gy++) {
      for (let gx = 0; gx < SIZE; gx++) {
        const d = dist[gy * SIZE + gx]!;
        const wx = cx - FOG_RADIUS + gx;
        const wy = cy - FOG_RADIUS + gy;
        let alpha: number;
        if (d === Infinity) {
          alpha = this.isExplored(dim, wx, wy) ? EXPLORED_ALPHA : UNSEEN_ALPHA;
        } else {
          this.markExplored(dim, wx, wy);
          const rim = d / FOG_RADIUS;
          alpha = rim < 0.7 ? 0 : Math.min(UNSEEN_ALPHA, ((rim - 0.7) / 0.3) * UNSEEN_ALPHA);
        }
        if (alpha > 0.01) {
          ctx.fillStyle = `rgba(4,4,10,${alpha.toFixed(3)})`;
          ctx.fillRect(gx, gy, 1, 1);
        }
      }
    }
    this.texture.source.update();
    this.sprite.position.set((cx - FOG_RADIUS) * TILE_PX, (cy - FOG_RADIUS) * TILE_PX);

    // Miner potion: ores glow through the fog.
    this.oreLayer.removeChildren().forEach((c) => c.destroy());
    if (minerActive) {
      for (let gy = 0; gy < SIZE; gy++) {
        for (let gx = 0; gx < SIZE; gx++) {
          const wx = cx - FOG_RADIUS + gx;
          const wy = cy - FOG_RADIUS + gy;
          const block = world.getBlock(wx, wy);
          if (!REVEALED_ORES.has(block)) continue;
          const texture = this.blockTextures.get(block);
          if (!texture) continue;
          const sprite = new Sprite(texture);
          sprite.position.set(wx * TILE_PX, wy * TILE_PX);
          sprite.alpha = 0.95;
          this.oreLayer.addChild(sprite);
        }
      }
    }
  }
}
