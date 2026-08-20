import type { OutboundEvent } from "../events.js";
import type { Simulation } from "../simulation.js";

/**
 * Tick systems: the same Factorio-style split as commands, applied to
 * what runs every tick. Simulation.tick() used to call a fixed sequence
 * of step*() methods directly; that sequence now lives here as a
 * registered, ordered list instead - the exact same list FlatCraft's own
 * built-in systems (see systems/*.ts) register into, no privileged
 * shortcut for vanilla content.
 *
 * Unlike command handlers (exactly one per closed Command variant), any
 * number of tick systems can coexist, and registration order IS
 * execution order - there's no per-tick "priority" field, just: the
 * order the built-in systems/index.ts imports them in, matching the
 * order that was already load-bearing in the old hardcoded call
 * sequence (see index.ts's comment for the two real ordering
 * constraints that must be preserved).
 *
 * Step bodies themselves stay as public methods on Simulation rather
 * than moving into these files - they're deeply-coupled internal
 * algorithms operating on Simulation's own state, the same category as
 * spawnItem/hurtMob/explode, which command handlers already call into
 * without those bodies having left Simulation either. What moves here
 * is only the *dispatch*: which systems run, and in what order.
 */

export interface TickSystem {
  id: string;
  step(sim: Simulation, out: OutboundEvent[]): void;
}

const SYSTEMS: TickSystem[] = [];
const IDS = new Set<string>();

export function registerTickSystem(system: TickSystem): void {
  if (IDS.has(system.id)) {
    throw new Error(`tick system "${system.id}" is already registered`);
  }
  IDS.add(system.id);
  SYSTEMS.push(system);
}

export function runTickSystems(sim: Simulation, out: OutboundEvent[]): void {
  for (const system of SYSTEMS) system.step(sim, out);
}

/** Ids in registration (= execution) order - test/debug visibility only. */
export function registeredTickSystemIds(): readonly string[] {
  return SYSTEMS.map((s) => s.id);
}
