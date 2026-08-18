import { registerMultiblockHandler } from "./multiblock.js";
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
 * Lit frames become side-permeable (PortalFrame), so players walk into
 * the interior; standing within this range of a portal block counts.
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

  // Frames are built from obsidian; once lit they turn into the
  // side-permeable PortalFrame - both count as frame material.
  const isFrame = (bx: number, by: number): boolean => {
    const b = world.getBlockGenerating(bx, by);
    return b === BlockId.Obsidian || b === BlockId.PortalFrame;
  };
  for (let ty = top; ty <= bottom; ty++) {
    for (let tx = left; tx <= right; tx++) {
      if (!isInner(tx, ty)) return null;
    }
    if (!isFrame(left - 1, ty) || !isFrame(right + 1, ty)) return null;
  }
  for (let tx = left; tx <= right; tx++) {
    if (!isFrame(tx, top - 1) || !isFrame(tx, bottom + 1)) return null;
  }
  return { left, right, top, bottom };
}

/**
 * Convert the frame of a lit interior to side-permeable PortalFrame
 * blocks, so players can walk in. Returns the changed tiles.
 */
export function convertFrame(
  world: World,
  interior: PortalInterior,
): Array<{ x: number; y: number; block: BlockId }> {
  const changes: Array<{ x: number; y: number; block: BlockId }> = [];
  const convert = (x: number, y: number): void => {
    if (world.getBlockGenerating(x, y) === BlockId.Obsidian) {
      world.setBlock(x, y, BlockId.PortalFrame);
      changes.push({ x, y, block: BlockId.PortalFrame });
    }
  };
  for (let ty = interior.top; ty <= interior.bottom; ty++) {
    convert(interior.left - 1, ty);
    convert(interior.right + 1, ty);
  }
  for (let tx = interior.left; tx <= interior.right; tx++) {
    convert(tx, interior.top - 1);
    convert(tx, interior.bottom + 1);
  }
  return changes;
}

// Registered under data/multiblocks/nether_portal.json's "handler" id -
// the multiblock engine's generic trigger_on dispatch (place_block +
// flint_and_steel) reaches this, not a hardcoded item check in
// simulation.ts. No `states` pattern for this def (see multiblock.ts's
// doc comment: frame size varies 2-4 x 3-5 and corners don't matter, so
// it doesn't fit a fixed rectangle) - this handler does its own shape
// check with findPortalInterior, which already only reads through
// World.getBlockGenerating, so it's exactly as safe as a pattern-matched
// multiblock would be.
registerMultiblockHandler("flatcraft:nether_portal", {
  activate({ world, x, y, dimension, sim, broadcast }) {
    const interior = findPortalInterior(world, x, y);
    if (!interior) return false;
    for (let ty = interior.top; ty <= interior.bottom; ty++) {
      for (let tx = interior.left; tx <= interior.right; tx++) {
        world.setBlock(tx, ty, BlockId.NetherPortal);
        broadcast({ type: "block_changed", dim: dimension, x: tx, y: ty, block: BlockId.NetherPortal });
      }
    }
    // Lit frames turn side-permeable so players can walk in.
    for (const change of convertFrame(world, interior)) {
      broadcast({ type: "block_changed", dim: dimension, x: change.x, y: change.y, block: change.block });
    }
    sim.portals[dimension].set(`${interior.left},${interior.bottom}`, { x: interior.left, y: interior.bottom });
    return true;
  },
});

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
  // Frame: interior is x in [bx, bx+1], y in [by-2, by]. Lit frames are
  // PortalFrame (side-permeable), so players walk straight in. The floor
  // row extends one tile to each side so arriving players have footing.
  for (let y = by - 3; y <= by + 1; y++) {
    set(bx - 1, y, BlockId.PortalFrame);
    set(bx + 2, y, BlockId.PortalFrame);
  }
  for (let x = bx - 1; x <= bx + 2; x++) {
    set(x, by - 3, BlockId.PortalFrame);
  }
  for (let x = bx - 3; x <= bx + 4; x++) {
    set(x, by + 1, x >= bx - 1 && x <= bx + 2 ? BlockId.PortalFrame : BlockId.Obsidian);
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
