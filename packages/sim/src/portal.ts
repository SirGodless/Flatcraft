import { multiblockDef, registerMultiblockHandler, stampBuildPattern } from "./multiblock.js";
import { BlockId } from "./world/block.js";
import type { World } from "./world/world.js";

/**
 * Nether portals: an obsidian frame with a 2-4 x 3-5 air interior can be
 * lit with flint and steel; standing in the portal for a tuned number of
 * ticks teleports between dimensions at an 1:8 coordinate scale. Frame
 * detection bounds and timing are data (data/multiblocks/nether_portal.json's
 * "config"), read through portalConfig() below - not module constants -
 * so a datapack can retune portals without touching this file.
 */

const DEFAULT_CONFIG: PortalConfig = { minW: 2, maxW: 4, minH: 3, maxH: 5, ticks: 60, range: 2.0, cooldown: 100 };

export interface PortalConfig {
  minW: number;
  maxW: number;
  minH: number;
  maxH: number;
  /** Ticks a player must stand at a portal before teleporting. */
  ticks: number;
  /**
   * Lit frames become side-permeable (PortalFrame), so players walk into
   * the interior; standing within this range of a portal block counts.
   */
  range: number;
  /** Ticks after arrival before the return trip can start. */
  cooldown: number;
}

function numOr(raw: Record<string, unknown> | undefined, key: string, def: number): number {
  const v = raw?.[key];
  if (v === undefined) return def;
  if (typeof v !== "number") throw new Error(`nether portal config: "${key}" must be a number`);
  return v;
}

function parsePortalConfig(raw: Record<string, unknown> | undefined): PortalConfig {
  return {
    minW: numOr(raw, "min_w", DEFAULT_CONFIG.minW),
    maxW: numOr(raw, "max_w", DEFAULT_CONFIG.maxW),
    minH: numOr(raw, "min_h", DEFAULT_CONFIG.minH),
    maxH: numOr(raw, "max_h", DEFAULT_CONFIG.maxH),
    ticks: numOr(raw, "ticks", DEFAULT_CONFIG.ticks),
    range: numOr(raw, "range", DEFAULT_CONFIG.range),
    cooldown: numOr(raw, "cooldown", DEFAULT_CONFIG.cooldown),
  };
}

let cachedConfig: PortalConfig | null = null;

/**
 * The active portal tuning, read from data/multiblocks/nether_portal.json's
 * "config" and cached on first call. Looking this up lazily (rather than
 * at module load) matters: this module is imported well before
 * data/multiblocks/index.ts registers that def, so an eager read here
 * would race the registration - every caller below only reaches this at
 * actual gameplay time, long after boot-time registration has finished.
 */
export function portalConfig(): PortalConfig {
  if (!cachedConfig) {
    cachedConfig = parsePortalConfig(multiblockDef("flatcraft:multiblock:nether_portal")?.config);
  }
  return cachedConfig;
}

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
  const cfg = portalConfig();
  const isInner = (bx: number, by: number): boolean => {
    const b = world.getBlockGenerating(bx, by);
    return b === BlockId.Air || b === BlockId.NetherPortal;
  };
  if (!isInner(x, y)) return null;

  let left = x;
  while (left > x - cfg.maxW && isInner(left - 1, y)) left--;
  let right = x;
  while (right < left + cfg.maxW - 1 && isInner(right + 1, y)) right++;
  let top = y;
  while (top > y - cfg.maxH && isInner(left, top - 1)) top--;
  let bottom = y;
  while (bottom < top + cfg.maxH - 1 && isInner(left, bottom + 1)) bottom++;

  const width = right - left + 1;
  const height = bottom - top + 1;
  if (width < cfg.minW || width > cfg.maxW) return null;
  if (height < cfg.minH || height > cfg.maxH) return null;

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
registerMultiblockHandler("flatcraft:multiblock_handler:nether_portal", {
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
    sim.portalsOf(dimension).set(`${interior.left},${interior.bottom}`, { x: interior.left, y: interior.bottom });
    return true;
  },
});

/**
 * Build a standard 2x3 portal (frame + lit interior) with its interior
 * bottom-left at (bx, by). Returns the tiles changed. The frame/interior
 * shape itself is data (data/multiblocks/nether_portal.json's
 * "build_pattern") - findPortalInterior's detection bounds and this
 * construction shape used to be two independently hand-maintained
 * definitions of "what a portal looks like"; now both trace back to the
 * same JSON def, so they can't drift apart.
 */
export function buildPortal(world: World, bx: number, by: number): Array<{ x: number; y: number; block: BlockId }> {
  const changes: Array<{ x: number; y: number; block: BlockId }> = [];
  // Clear breathing room around the portal.
  for (let x = bx - 2; x <= bx + 3; x++) {
    for (let y = by - 4; y <= by; y++) {
      world.ensureChunk(Math.floor(x / 32), Math.floor(y / 32));
      world.setBlock(x, y, BlockId.Air);
      changes.push({ x, y, block: BlockId.Air });
    }
  }
  const pattern = multiblockDef("flatcraft:multiblock:nether_portal")?.buildPattern;
  if (!pattern) throw new Error('nether portal def is missing its "build_pattern"');
  changes.push(...stampBuildPattern(world, pattern, bx, by));
  return changes;
}

/** Whether a portal block is within the configured range of the given center. */
export function nearPortal(world: World, cx: number, cy: number): boolean {
  const range = portalConfig().range;
  const tx0 = Math.floor(cx - range);
  const tx1 = Math.ceil(cx + range);
  const ty0 = Math.floor(cy - range);
  const ty1 = Math.ceil(cy + range);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (world.getBlockGenerating(tx, ty) !== BlockId.NetherPortal) continue;
      if (Math.hypot(tx + 0.5 - cx, ty + 0.5 - cy) <= range) return true;
    }
  }
  return false;
}
