import { registerContentType, validateContentInstance } from "../registry/generic.js";
import { getHandler, hasHandler, registerHandler } from "../registry/handlers.js";
import type { World } from "./world.js";
import type { Chunk } from "./chunk.js";

/**
 * Dimensions: named, JSON-defined worlds with their own generation,
 * mob spawning, portal linkage, entry point and sky. The built-in
 * overworld and nether are registered exactly the same way a mod's own
 * dimension would be (see data/dimensions/*.json) - no privileged
 * shortcut for vanilla content. Nothing dimension-specific is expressed
 * directly in JSON as code; every behavior is referenced by an id
 * resolving to a trusted, pre-registered function - the same "data
 * composes trusted behavior, never injects new code" rule multiblocks
 * already follow, for the same reason (this server can load datapacks;
 * running code referenced from a data file would be arbitrary code
 * execution). Mob spawning is the one exception living outside this
 * file - see spawning.ts for why.
 *
 * Namespaced like every other content type: "flatcraft:dimension:overworld",
 * "flatcraft:dimension:nether". These ids are baked into the save format,
 * chunk file directory names, and every SimEvent carrying a `dim` field,
 * same as a block name is baked into every chunk's palette - the uniform-
 * namespacing decision covers this too, and there is no save-compat
 * concern weighing against it (old saves are not expected to load).
 */

export interface DimensionPortal {
  /** Dimension id a standard nether-portal-style multiblock leads to
   * from here. No portal field at all means this dimension isn't
   * reachable/leaveable that way (a mod could still add its own
   * multiblock and dimension-switch logic through the multiblock/
   * command registries directly). */
  to: string;
  /** Multiply this dimension's x coordinate by this to get the target
   * dimension's x coordinate (e.g. nether -> overworld is 8, the
   * reverse is 1/8). */
  scale: number;
}

export interface DimensionSkyJson {
  /** "cycle" blends toward night using the shared day/night clock
   * (daylightFactor, see time.ts) - the default a new dimension with
   * has_sky:true would want. "fixed" renders a constant background/veil
   * regardless of time of day (the nether has no sky). Not typed as the
   * literal union here (like Structure.placement.type) - imported JSON
   * modules widen string literals to `string`, so the union only exists
   * on the parsed DimensionSky, checked at runtime below. */
  type: string;
  /** Required for type "fixed": CSS hex color, e.g. "#2a0f0f". */
  background?: string;
  veil_color?: string;
  veil_alpha?: number;
}

export interface DimensionSky {
  type: "cycle" | "fixed";
  background?: string;
  veilColor?: string;
  veilAlpha?: number;
}

export interface DimensionJson {
  id: string;
  generator: string;
  /** Mob spawn generator id, see spawning.ts. */
  spawns: string;
  /** Portal arrival-height generator id: given a world and a target x,
   * finds/carves a safe y to arrive at. Every dimension needs one, even
   * if nothing links to it yet - a future mod's portal might. */
  arrival: string;
  /** Whether this dimension has a day/night cycle at all - gates
   * daylight-sensitive gameplay (undead burning) and is the default for
   * client sky rendering when `sky` isn't given. */
  has_sky: boolean;
  /** Exactly one registered dimension must set this true: where a fresh
   * join or a death respawn lands. */
  respawn?: boolean;
  /** Required on the respawn dimension: spawn-point generator id (seed
   * -> a full, dry-land-searched (x, y), distinct from `arrival` which
   * places relative to a known portal x). */
  spawn_point?: string;
  portal?: DimensionPortal;
  sky?: DimensionSkyJson;
}

export interface DimensionDef {
  id: string;
  generator: string;
  spawns: string;
  arrival: string;
  hasSky: boolean;
  respawn: boolean;
  spawnPoint?: string;
  portal?: DimensionPortal;
  sky?: DimensionSky;
}

export type DimensionGenerator = (seed: number, cx: number, cy: number) => Chunk;

/** Given a world and a target x, returns the y to arrive at - e.g. the
 * overworld surface, or a carved-out pocket in the nether. */
export type ArrivalGenerator = (world: World, xt: number) => number;

/** A full spawn point for a fresh player in this dimension (join, or a
 * death respawn landing back at the default dimension). */
export type SpawnPointGenerator = (seed: number) => { x: number; y: number };

registerContentType(
  {
    id: "dimension",
    fields: {
      id: { kind: "qualified_id", required: true },
      generator: { kind: "ref", ref_type: "dimension_generator", ref_kind: "handler", required: true },
      spawns: { kind: "ref", ref_type: "spawn_generator", ref_kind: "handler", required: true },
      arrival: { kind: "ref", ref_type: "arrival_generator", ref_kind: "handler", required: true },
      has_sky: { kind: "boolean", required: true },
      respawn: { kind: "boolean" },
      spawn_point: { kind: "ref", ref_type: "spawn_point_generator", ref_kind: "handler" },
      portal: {
        kind: "object",
        fields: {
          to: { kind: "ref", ref_type: "dimension", required: true },
          scale: { kind: "number", min: -100000, max: 100000, required: true },
        },
      },
      sky: {
        kind: "object",
        fields: {
          type: { kind: "enum", values: ["cycle", "fixed"], required: true },
          background: { kind: "string" },
          veil_color: { kind: "string" },
          veil_alpha: { kind: "number", min: 0, max: 1 },
        },
      },
    },
  },
  "engine/types/dimension",
);

/** Register a dimension from datapack JSON (content package files or
 * server mods). */
export function registerDimensionJson(raw: unknown, source = "content"): DimensionDef {
  const v = validateContentInstance("dimension", raw, source) as {
    id: string;
    generator: string;
    spawns: string;
    arrival: string;
    has_sky: boolean;
    respawn?: boolean;
    spawn_point?: string;
    portal?: { to: string; scale: number };
    sky?: { type: "cycle" | "fixed"; background?: string; veil_color?: string; veil_alpha?: number };
  };
  const id = v.id;
  // Cross-field rule the DSL doesn't express yet (see nether_layer's
  // fbm2 check for the same pattern) - kept as a small residual check.
  if (v.sky?.type === "fixed" && v.sky.background === undefined) {
    throw new Error(`dimension "${id}": sky type "fixed" requires "background"`);
  }
  const def: DimensionDef = {
    id,
    generator: v.generator,
    spawns: v.spawns,
    arrival: v.arrival,
    hasSky: v.has_sky,
    respawn: v.respawn === true,
    ...(v.spawn_point !== undefined ? { spawnPoint: v.spawn_point } : {}),
    ...(v.portal !== undefined ? { portal: { to: v.portal.to, scale: v.portal.scale } } : {}),
    ...(v.sky !== undefined
      ? {
          sky: {
            type: v.sky.type,
            ...(v.sky.background !== undefined ? { background: v.sky.background } : {}),
            ...(v.sky.veil_color !== undefined ? { veilColor: v.sky.veil_color } : {}),
            ...(v.sky.veil_alpha !== undefined ? { veilAlpha: v.sky.veil_alpha } : {}),
          },
        }
      : {}),
  };
  if (DEFS.has(def.id)) {
    throw new Error(`dimension "${def.id}" is already registered`);
  }
  DEFS.set(def.id, def);
  return def;
}

const DEFS = new Map<string, DimensionDef>();

export function registerDimensionGenerator(id: string, generator: DimensionGenerator): void {
  registerHandler("dimension_generator", id, generator);
}

export function registerArrivalGenerator(id: string, generator: ArrivalGenerator): void {
  registerHandler("arrival_generator", id, generator);
}

export function registerSpawnPointGenerator(id: string, generator: SpawnPointGenerator): void {
  registerHandler("spawn_point_generator", id, generator);
}

export function dimensionDef(id: string): DimensionDef | undefined {
  return DEFS.get(id);
}

export function allDimensions(): Iterable<DimensionDef> {
  return DEFS.values();
}

export function allDimensionIds(): readonly string[] {
  return [...DEFS.keys()];
}

/** Generates one chunk for the given dimension id via its registered
 * generator. Throws for an unregistered dimension id or generator id -
 * unlike a multiblock's runtime handler lookup (which skips safely, so
 * one broken interaction doesn't take down a live game), there is no
 * sane soft-fallback for "can't generate this terrain at all", and
 * validateDimensionGenerators (see validateAllContent) already
 * guarantees this can't happen on a server that passed boot validation -
 * hitting it here means something registered a dimension without ever
 * validating, which is a coding error worth failing loudly on. */
export function generateDimensionChunk(dim: string, seed: number, cx: number, cy: number): Chunk {
  const def = dimensionDef(dim);
  if (!def) throw new Error(`unknown dimension "${dim}"`);
  const generator = getHandler<DimensionGenerator>("dimension_generator", def.generator);
  if (!generator) throw new Error(`dimension "${dim}" references unknown generator "${def.generator}"`);
  return generator(seed, cx, cy);
}

/** Finds the arrival y for a portal into `dim` at world x `xt` - same
 * "trust boot validation, throw loudly if unreachable" reasoning as
 * generateDimensionChunk. */
export function generateArrival(dim: string, world: World, xt: number): number {
  const def = dimensionDef(dim);
  if (!def) throw new Error(`unknown dimension "${dim}"`);
  const generator = getHandler<ArrivalGenerator>("arrival_generator", def.arrival);
  if (!generator) throw new Error(`dimension "${dim}" references unknown arrival generator "${def.arrival}"`);
  return generator(world, xt);
}

/** The dimension exactly one registered dimension must flag `respawn`
 * (see parseDimension) - where fresh joins and death respawns land. */
export function defaultDimensionId(): string {
  for (const def of DEFS.values()) {
    if (def.respawn) return def.id;
  }
  throw new Error("no dimension is marked as the default respawn dimension");
}

/** The default dimension's full spawn point - same "trust boot
 * validation" reasoning as generateDimensionChunk. */
export function generateDefaultSpawnPoint(seed: number): { x: number; y: number } {
  const id = defaultDimensionId();
  const def = dimensionDef(id)!;
  const generatorId = def.spawnPoint;
  const generator = generatorId ? getHandler<SpawnPointGenerator>("spawn_point_generator", generatorId) : undefined;
  if (!generator) {
    throw new Error(`dimension "${id}" is the default respawn dimension but has no working "spawn_point"`);
  }
  return generator(seed);
}

/** Every registered dimension's generator/arrival references must
 * resolve to something actually registered - same exhaustive-collect-
 * all pattern as validateMultiblockHandlers/validateCommandHandlers. */
export function validateDimensionGenerators(): string[] {
  const problems: string[] = [];
  for (const def of DEFS.values()) {
    if (!hasHandler("dimension_generator", def.generator)) {
      problems.push(`dimension "${def.id}" references unknown generator "${def.generator}"`);
    }
    if (!hasHandler("arrival_generator", def.arrival)) {
      problems.push(`dimension "${def.id}" references unknown arrival generator "${def.arrival}"`);
    }
    if (def.spawnPoint !== undefined && !hasHandler("spawn_point_generator", def.spawnPoint)) {
      problems.push(`dimension "${def.id}" references unknown spawn point generator "${def.spawnPoint}"`);
    }
  }
  return problems;
}

/** A dimension's portal must lead somewhere registered. */
export function validatePortalLinks(): string[] {
  const problems: string[] = [];
  for (const def of DEFS.values()) {
    if (def.portal && !DEFS.has(def.portal.to)) {
      problems.push(`dimension "${def.id}" has a portal to unregistered dimension "${def.portal.to}"`);
    }
  }
  return problems;
}

/** Exactly one dimension must be the default respawn target, and it
 * must actually be able to produce a spawn point. */
export function validateDefaultDimension(): string[] {
  const respawnDims = [...DEFS.values()].filter((d) => d.respawn);
  if (respawnDims.length !== 1) {
    return [`exactly one dimension must be marked "respawn": true (found ${respawnDims.length})`];
  }
  const [only] = respawnDims;
  if (only!.spawnPoint === undefined) {
    return [`dimension "${only!.id}" is the default respawn dimension but declares no "spawn_point"`];
  }
  return [];
}
