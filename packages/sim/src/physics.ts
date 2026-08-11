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
export const JUMP_VELOCITY = -0.42;

export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;

/** Elytra gliding: capped sink rate and boosted horizontal speed. */
export const ELYTRA_SINK = 0.08;
export const ELYTRA_GLIDE_BOOST = 2.2;

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

function isSolid(world: World, tx: number, ty: number): boolean {
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
        if (isSolid(world, tx, ty)) {
          body.x = tx - width / 2;
          body.vx = 0;
          break;
        }
      }
    } else {
      const tx = Math.floor(body.x - width / 2);
      for (let ty = top; ty <= bottom; ty++) {
        if (isSolid(world, tx, ty)) {
          body.x = tx + 1 + width / 2;
          body.vx = 0;
          break;
        }
      }
    }
  }

  if (body.vy !== 0) {
    body.y += body.vy;
    const left = Math.floor(body.x - width / 2);
    const right = Math.floor(body.x + width / 2 - EPS);
    if (body.vy > 0) {
      const ty = Math.floor(body.y - EPS);
      for (let tx = left; tx <= right; tx++) {
        if (isSolid(world, tx, ty)) {
          body.y = ty;
          body.vy = 0;
          body.onGround = true;
          break;
        }
      }
    } else {
      const ty = Math.floor(body.y - height);
      for (let tx = left; tx <= right; tx++) {
        if (isSolid(world, tx, ty)) {
          body.y = ty + 1 + height;
          body.vy = 0;
          break;
        }
      }
    }
  }
}
