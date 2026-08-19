import type { MobKind, PlayerEntity } from "./entities.js";
import type { OutboundEvent } from "./events.js";
import type { Simulation } from "./simulation.js";
import type { World } from "./world/world.js";

/**
 * Mob spawning: a dimension's `spawns` field (see world/dimension.ts)
 * references one of these by id. Registered separately from the other
 * per-dimension behavior hooks (generator, arrival, spawn_point) because
 * this one needs the live Simulation - the rest are pure functions of a
 * seed/world, this one calls back into spawnMob, reads player positions,
 * checks the mob cap, etc. Splitting it out here (instead of importing
 * Simulation into world/dimension.ts) keeps that file's dependency
 * direction the same as everywhere else in the world/ folder: leaf types
 * only, nothing simulation-shaped.
 */

export interface SpawnContext {
  sim: Simulation;
  out: OutboundEvent[];
  /** The player whose vicinity is being considered for a new mob. */
  anchor: PlayerEntity;
  world: World;
  /** Column offset from the anchor already rolled for this attempt. */
  x: number;
  pickMob: (kinds: readonly MobKind[]) => MobKind;
  /** Scans y in [yStart, yEnd) for the first open-air-over-solid-floor
   * spot and spawns `kind` there. Returns whether it found one. */
  spawnInPocket: (yStart: number, yEnd: number, kind: MobKind) => boolean;
}

export type SpawnGenerator = (ctx: SpawnContext) => void;

const GENERATORS = new Map<string, SpawnGenerator>();

export function registerSpawnGenerator(id: string, generator: SpawnGenerator): void {
  if (GENERATORS.has(id)) {
    throw new Error(`spawn generator "${id}" is already registered`);
  }
  GENERATORS.set(id, generator);
}

export function spawnGenerator(id: string): SpawnGenerator | undefined {
  return GENERATORS.get(id);
}

/** Every registered dimension's spawn generator must resolve - checked
 * from world/dimension.ts's DEFS via the id it hands back, same
 * exhaustive-collect-all pattern as the other content validators. This
 * takes the (id, dimId) pairs as input rather than importing
 * world/dimension.ts itself, for the same dependency-direction reason
 * described above. */
export function validateSpawnGenerators(dimensions: Iterable<{ id: string; spawns: string }>): string[] {
  const problems: string[] = [];
  for (const dim of dimensions) {
    if (!GENERATORS.has(dim.spawns)) {
      problems.push(`dimension "${dim.id}" references unknown spawn generator "${dim.spawns}"`);
    }
  }
  return problems;
}
