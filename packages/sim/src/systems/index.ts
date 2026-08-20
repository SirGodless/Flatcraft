/**
 * Registers every built-in tick system, in execution order - see
 * registry.ts: registration order is execution order, there's no
 * separate priority mechanism. This exact order matches the sequence
 * that was previously hardcoded in Simulation.tick(). Two real
 * constraints, not just convention, must be preserved if this ever
 * gets reordered:
 *   - entities must stay separate from players (players have very
 *     different, input-driven physics - see stepEntities' own comment)
 *   - gear_sync must run last among anything that can change inventory/
 *     held-item/facing (mining, entities' item pickup, players), so it
 *     reports each player's final state for the tick, not a stale one
 */
import "./mining.js";
import "./furnaces.js";
import "./liquids.js";
import "./entities.js";
import "./players.js";
import "./gearSync.js";
import "./spawning.js";
