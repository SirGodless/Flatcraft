import type { Chunk } from "./chunk.js";

/**
 * Dimensions: named, JSON-defined worlds with their own generation. The
 * built-in overworld and nether are registered exactly the same way a
 * mod's own dimension would be (see data/dimensions/*.json) - no
 * privileged shortcut for vanilla content. A dimension's actual terrain
 * generation is never expressed in JSON, only referenced by a
 * `generator` id resolving to a trusted, pre-registered function - the
 * same "data composes trusted behavior, never injects new code" rule
 * multiblocks already follow, for the same reason (this server can load
 * datapacks; running code referenced from a data file would be
 * arbitrary code execution).
 *
 * Deliberately not namespaced as "flatcraft:overworld"/"flatcraft:nether"
 * - unlike a multiblock id, these dimension ids are already baked into
 * the save format, chunk file directory names, and every SimEvent that
 * carries a `dim` field. Renaming them would be a real save-compat
 * break for no benefit ("overworld"/"nether" are about as collision-
 * proof as a name gets); a mod adding a third dimension just picks its
 * own namespaced id, same as any other content.
 */

export interface DimensionJson {
  id: string;
  generator: string;
}

export interface DimensionDef {
  id: string;
  generator: string;
}

export type DimensionGenerator = (seed: number, cx: number, cy: number) => Chunk;

export function parseDimension(id: string, json: DimensionJson): DimensionDef {
  if (typeof json.generator !== "string" || json.generator.length === 0) {
    throw new Error(`dimension ${id}: "generator" is required`);
  }
  return { id, generator: json.generator };
}

const DEFS = new Map<string, DimensionDef>();
const GENERATORS = new Map<string, DimensionGenerator>();

export function registerDimension(def: DimensionDef): void {
  if (DEFS.has(def.id)) {
    throw new Error(`dimension "${def.id}" is already registered`);
  }
  DEFS.set(def.id, def);
}

export function registerDimensionGenerator(id: string, generator: DimensionGenerator): void {
  if (GENERATORS.has(id)) {
    throw new Error(`dimension generator "${id}" is already registered`);
  }
  GENERATORS.set(id, generator);
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
  const generator = GENERATORS.get(def.generator);
  if (!generator) throw new Error(`dimension "${dim}" references unknown generator "${def.generator}"`);
  return generator(seed, cx, cy);
}

/** Every registered dimension's generator must resolve to something
 * actually registered - same exhaustive-collect-all pattern as
 * validateMultiblockHandlers/validateCommandHandlers. */
export function validateDimensionGenerators(): string[] {
  const problems: string[] = [];
  for (const def of DEFS.values()) {
    if (!GENERATORS.has(def.generator)) {
      problems.push(`dimension "${def.id}" references unknown generator "${def.generator}"`);
    }
  }
  return problems;
}
