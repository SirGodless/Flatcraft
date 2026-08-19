import { CHUNK_WIDTH } from "./constants.js";
import { registerSpawnGenerator, type SpawnContext } from "./spawning.js";
import { mobsNearStructure, spawnPool } from "./mobs.js";
import { placementsNear } from "./structures/place.js";
import { isNight } from "./time.js";
import { biomeAt, surfaceHeight } from "./world/gen.js";
import { blockDef, BlockId } from "./world/block.js";

/**
 * The two built-in dimensions' mob spawning, registered under the ids
 * their own data/dimensions/*.json "spawns" field references - same
 * "vanilla content through the same door a mod would use" rule as
 * everywhere else. See spawning.ts for the registry these plug into.
 */

/** Villagers move into houses: if a structure with such a mob stands
 * near the anchor and has no instance around yet, one appears.
 * Generalizes past just villagers/houses to whatever a datapack mob
 * declares via spawn.near_structure. */
function trySpawnStructureResident(ctx: SpawnContext): boolean {
  const { sim, out, anchor, world } = ctx;
  const pcx = Math.floor(anchor.x / CHUNK_WIDTH);
  for (let cx = pcx - 2; cx <= pcx + 2; cx++) {
    for (let cy = -2; cy <= 3; cy++) {
      for (const placement of placementsNear(world.seed, anchor.dimension, cx, cy)) {
        const residents = mobsNearStructure(placement.structure.id);
        if (residents.length === 0) continue;
        const homeX = placement.originX + 3.5;
        const homeY = placement.originY + 4;
        let occupied = false;
        for (const e of sim.entities.values()) {
          if (residents.includes(e.kind) && Math.abs(e.x - homeX) < 20) occupied = true;
        }
        if (!occupied) {
          sim.spawnMob(residents[0]!, homeX, homeY, out, anchor.dimension);
          return true;
        }
      }
    }
  }
  return false;
}

function overworldSpawns(ctx: SpawnContext): void {
  const { sim, out, anchor, world, x, pickMob, spawnInPocket } = ctx;

  if (sim.tickCount % 200 === 0 && trySpawnStructureResident(ctx)) return;

  const surface = surfaceHeight(world.seed, x);
  const night = isNight(sim.timeOfDay);
  const hostiles = spawnPool("hostile_surface");
  if (sim.rng() < 0.5) {
    if (night) {
      // At night, hostile mobs rise on the surface instead of animals.
      const kind = pickMob(hostiles);
      const feetFree = world.getBlockGenerating(x, surface - 1) === BlockId.Air;
      const headFree = world.getBlockGenerating(x, surface - 2) === BlockId.Air;
      if (feetFree && headFree && blockDef(world.getBlockGenerating(x, surface)).solid) {
        sim.spawnMob(kind, x + 0.5, surface, out, anchor.dimension);
      }
      return;
    }
    if (world.getBlockGenerating(x, surface) !== BlockId.Grass) return;
    const biome = biomeAt(world.seed, x);
    if (biome !== "plains" && biome !== "forest") return;
    sim.spawnMob(pickMob(spawnPool("grass_day")), x + 0.5, surface, out, anchor.dimension);
  } else {
    const yStart = surface + 6 + Math.floor(sim.rng() * 40);
    spawnInPocket(yStart, yStart + 12, pickMob(hostiles));
  }
}

function netherSpawns(ctx: SpawnContext): void {
  const { sim, pickMob, spawnInPocket } = ctx;
  const yStart = 10 + Math.floor(sim.rng() * 50);
  spawnInPocket(yStart, yStart + 16, pickMob(spawnPool("nether_pocket")));
}

registerSpawnGenerator("flatcraft:overworld_spawns", overworldSpawns);
registerSpawnGenerator("flatcraft:nether_spawns", netherSpawns);
