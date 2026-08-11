import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { blockDef, BlockId, CHUNK_HEIGHT, CHUNK_WIDTH } from "@flatcraft/sim";
import { TILE_PX } from "./textures.js";
import type { WorldView } from "./worldView.js";

/**
 * Fog of war: full 360-degree line-of-sight vision around the player,
 * capped at FOG_RADIUS tiles. A tile is visible when the straight ray
 * from the player's eye to it crosses no solid tile - so the whole
 * panorama opens up (it's 2D, the player sees in every direction), while
 * cave walls still occlude what lies behind them. The first solid tile a
 * ray hits stays visible, so wall faces and ores in them read correctly.
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
  /** Solidity of the window's tiles, sampled once per update. */
  private readonly solid = new Uint8Array(SIZE * SIZE);
  /** Explored tiles per chunk, keyed "dim:cx,cy" (1 byte per tile). */
  private explored = new Map<string, Uint8Array>();

  private readonly border = new Graphics();

  constructor(private readonly blockTextures: Map<BlockId, Texture>) {
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.texture = Texture.from(this.canvas);
    this.sprite = new Sprite(this.texture);
    // 1 canvas pixel = 1 tile; linear filtering gives soft fog edges.
    this.sprite.scale.set(TILE_PX);
    this.container.addChild(this.sprite);
    // Full veil outside the fog window, so zooming far out never shows
    // uncovered world beyond the canvas edges.
    const w = SIZE * TILE_PX;
    const b = 20000;
    this.border
      .rect(-b, -b, w + 2 * b, b)
      .rect(-b, w, w + 2 * b, b)
      .rect(-b, 0, b, w)
      .rect(w, 0, b, w)
      .fill({ color: 0x04040a, alpha: UNSEEN_ALPHA });
    this.container.addChild(this.border);
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

  /** Recompute visibility around the player (eye position, tile coords). */
  update(px: number, py: number, world: WorldView, minerActive: boolean, dim: string): void {
    const cx = Math.floor(px);
    const cy = Math.floor(py);
    const dist = this.dist;
    dist.fill(Infinity);

    // Sample the window's solidity once, so the rays below only touch a
    // flat array instead of doing a map lookup per step.
    const solid = this.solid;
    for (let gy = 0; gy < SIZE; gy++) {
      for (let gx = 0; gx < SIZE; gx++) {
        const block = world.getBlock(cx - FOG_RADIUS + gx, cy - FOG_RADIUS + gy);
        solid[gy * SIZE + gx] = blockDef(block).solid ? 1 : 0;
      }
    }

    // 360-degree vision: march a straight ray from the player's eye to
    // every tile in the radius. The tile is visible unless a solid tile
    // lies strictly between - the first solid tile a ray reaches is
    // itself visible (wall faces, ores in them).
    const ox = px - (cx - FOG_RADIUS); // eye position in window coords
    const oy = py - (cy - FOG_RADIUS);
    const STEP = 0.3;
    for (let gy = 0; gy < SIZE; gy++) {
      for (let gx = 0; gx < SIZE; gx++) {
        const dx = gx + 0.5 - ox;
        const dy = gy + 0.5 - oy;
        const d = Math.hypot(dx, dy);
        if (d > FOG_RADIUS) continue;
        let visible = true;
        const steps = Math.ceil(d / STEP);
        for (let s = 1; s < steps; s++) {
          const t = (s * STEP) / d;
          const sx = Math.floor(ox + dx * t);
          const sy = Math.floor(oy + dy * t);
          if (sx === gx && sy === gy) break; // reached the target cell
          if (solid[sy * SIZE + sx] === 1) {
            visible = false;
            break;
          }
        }
        if (visible) dist[gy * SIZE + gx] = d;
      }
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
    this.border.position.copyFrom(this.sprite.position);

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
