import { BlockId } from "./world/block.js";
import type { World } from "./world/world.js";

/**
 * Nether portals: an obsidian frame with a 2-4 x 3-5 air interior can be
 * lit with flint and steel; standing in the portal for PORTAL_TICKS
 * teleports between dimensions at an 1:8 coordinate scale.
 */

export const PORTAL_MIN_W = 2;
export const PORTAL_MAX_W = 4;
export const PORTAL_MIN_H = 3;
export const PORTAL_MAX_H = 5;
/** Ticks a player must stand at a portal before teleporting. */
export const PORTAL_TICKS = 60;
/**
 * In 2D you cannot walk "through" the frame plane, so standing next to
 * the portal (within this range of any portal block) counts as being in it.
 */
export const PORTAL_RANGE = 2.0;
/** Ticks after arrival before the return trip can start. */
export const PORTAL_COOLDOWN = 100;
export const NETHER_SCALE = 8;

export interface PortalInterior {
  /** Interior bounds (inclusive), all air/portal blocks. */
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Find the obsidian-framed interior containing (x, y), or null.
 * The frame requires full obsidian columns left/right and rows top/bottom
 * (corners don't matter, like Minecraft).
 */
export function findPortalInterior(world: World, x: number, y: number): PortalInterior | null {
  const isInner = (bx: number, by: number): boolean => {
    const b = world.getBlockGenerating(bx, by);
    return b === BlockId.Air || b === BlockId.NetherPortal;
  };
  if (!isInner(x, y)) return null;

  let left = x;
  while (left > x - PORTAL_MAX_W && isInner(left - 1, y)) left--;
  let right = x;
  while (right < left + PORTAL_MAX_W - 1 && isInner(right + 1, y)) right++;
  let top = y;
  while (top > y - PORTAL_MAX_H && isInner(left, top - 1)) top--;
  let bottom = y;
  while (bottom < top + PORTAL_MAX_H - 1 && isInner(left, bottom + 1)) bottom++;

  const width = right - left + 1;
  const height = bottom - top + 1;
  if (width < PORTAL_MIN_W || width > PORTAL_MAX_W) return null;
  if (height < PORTAL_MIN_H || height > PORTAL_MAX_H) return null;

  for (let ty = top; ty <= bottom; ty++) {
    for (let tx = left; tx <= right; tx++) {
      if (!isInner(tx, ty)) return null;
    }
    if (world.getBlockGenerating(left - 1, ty) !== BlockId.Obsidian) return null;
    if (world.getBlockGenerating(right + 1, ty) !== BlockId.Obsidian) return null;
  }
  for (let tx = left; tx <= right; tx++) {
    if (world.getBlockGenerating(tx, top - 1) !== BlockId.Obsidian) return null;
    if (world.getBlockGenerating(tx, bottom + 1) !== BlockId.Obsidian) return null;
  }
  return { left, right, top, bottom };
}

/**
 * Build a standard 2x3 portal (frame + lit interior) with its interior
 * bottom-left at (bx, by). Returns the tiles changed.
 */
export function buildPortal(world: World, bx: number, by: number): Array<{ x: number; y: number; block: BlockId }> {
  const changes: Array<{ x: number; y: number; block: BlockId }> = [];
  const set = (x: number, y: number, block: BlockId): void => {
    world.ensureChunk(Math.floor(x / 32), Math.floor(y / 32));
    world.setBlock(x, y, block);
    changes.push({ x, y, block });
  };
  // Clear breathing room around the portal.
  for (let x = bx - 2; x <= bx + 3; x++) {
    for (let y = by - 4; y <= by; y++) {
      set(x, y, BlockId.Air);
    }
  }
  // Frame: interior is x in [bx, bx+1], y in [by-2, by]. The floor row
  // extends one tile to each side so arriving players have footing.
  for (let y = by - 3; y <= by + 1; y++) {
    set(bx - 1, y, BlockId.Obsidian);
    set(bx + 2, y, BlockId.Obsidian);
  }
  for (let x = bx - 1; x <= bx + 2; x++) {
    set(x, by - 3, BlockId.Obsidian);
  }
  for (let x = bx - 3; x <= bx + 4; x++) {
    set(x, by + 1, BlockId.Obsidian);
  }
  for (let y = by - 2; y <= by; y++) {
    set(bx, y, BlockId.NetherPortal);
    set(bx + 1, y, BlockId.NetherPortal);
  }
  return changes;
}

/** Whether a portal block is within PORTAL_RANGE of the given center. */
export function nearPortal(world: World, cx: number, cy: number): boolean {
  const tx0 = Math.floor(cx) - 2;
  const ty0 = Math.floor(cy) - 2;
  for (let ty = ty0; ty <= ty0 + 4; ty++) {
    for (let tx = tx0; tx <= tx0 + 4; tx++) {
      if (world.getBlockGenerating(tx, ty) !== BlockId.NetherPortal) continue;
      if (Math.hypot(tx + 0.5 - cx, ty + 0.5 - cy) <= PORTAL_RANGE) return true;
    }
  }
  return false;
}
