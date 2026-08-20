import { blockDef } from "./world/block.js";
import type { World } from "./world/world.js";

/**
 * Tile-based AABB physics. Units are tiles and ticks: positions in tiles,
 * velocities in tiles per tick. All constants are per-tick values, so the
 * outcome depends only on the tick sequence - never on frame rate.
 *
 * A body's position is its feet center: the AABB spans
 * [x - w/2, x + w/2] x [y - h, y] (y grows downward).
 */

export const GRAVITY = 0.08;
export const TERMINAL_VELOCITY = 0.9;
export const WALK_SPEED = 0.22;
/**
 * Chosen so the discrete tick integration (gravity already applies on the
 * jump tick) peaks at ~1.3 tiles - comfortably clears one block, never two.
 */
export const JUMP_VELOCITY = -0.5;

export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;

/** Max distance (tiles) from player center at which blocks can be targeted. */
export const REACH = 6;

const EPS = 1e-7;

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  onGround: boolean;
}

/** Blocks horizontal movement: solid, unless passable from the side
 * (portal frames). Slabs never block sideways (they're half-height). */
function blocksHorizontal(world: World, tx: number, ty: number): boolean {
  const def = blockDef(world.getBlockGenerating(tx, ty));
  return def.solid && !def.sidePermeable;
}

/** Blocks vertical movement (portal frames still carry you on top). */
function blocksVertical(world: World, tx: number, ty: number): boolean {
  return blockDef(world.getBlockGenerating(tx, ty)).solid;
}

/**
 * Move a body by its velocity, one axis at a time, clamping against solid
 * tiles. Velocities must stay below 1 tile/tick (TERMINAL_VELOCITY does),
 * so checking the leading edge's tile column/row is sufficient - a body
 * can never tunnel through a full tile in one step.
 */
export function stepBody(world: World, body: Body, width: number, height: number): void {
  body.onGround = false;

  if (body.vx !== 0) {
    body.x += body.vx;
    const top = Math.floor(body.y - height);
    const bottom = Math.floor(body.y - EPS);
    if (body.vx > 0) {
      const tx = Math.floor(body.x + width / 2 - EPS);
      for (let ty = top; ty <= bottom; ty++) {
        if (blocksHorizontal(world, tx, ty)) {
          body.x = tx - width / 2;
          body.vx = 0;
          break;
        }
      }
    } else {
      const tx = Math.floor(body.x - width / 2);
      for (let ty = top; ty <= bottom; ty++) {
        if (blocksHorizontal(world, tx, ty)) {
          body.x = tx + 1 + width / 2;
          body.vx = 0;
          break;
        }
      }
    }
  }

  if (body.vy !== 0) {
    const yBefore = body.y;
    body.y += body.vy;
    const left = Math.floor(body.x - width / 2);
    const right = Math.floor(body.x + width / 2 - EPS);
    if (body.vy > 0) {
      const ty = Math.floor(body.y - EPS);
      for (let tx = left; tx <= right; tx++) {
        if (blocksVertical(world, tx, ty)) {
          body.y = ty;
          body.vy = 0;
          body.onGround = true;
          break;
        }
        // Slabs are half-height: catch bodies falling onto their top.
        const def = blockDef(world.getBlockGenerating(tx, ty));
        if (def.slab) {
          const top = ty + 0.5;
          if (body.y > top && yBefore <= top + EPS) {
            body.y = top;
            body.vy = 0;
            body.onGround = true;
            break;
          }
        }
      }
    } else {
      const ty = Math.floor(body.y - height);
      for (let tx = left; tx <= right; tx++) {
        if (blocksVertical(world, tx, ty)) {
          body.y = ty + 1 + height;
          body.vy = 0;
          break;
        }
      }
    }
  }
}
