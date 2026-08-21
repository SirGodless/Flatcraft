import { validateCommandHandlers } from "./commands/registry.js";
import { validateAllRefs } from "./registry/generic.js";
import { validateDefaultDimension } from "./world/dimension.js";

/**
 * Every dependency-style content reference (multiblock handlers, dimension
 * generators/arrival/spawn-point/spawn generators, portal links, structure
 * dimensions, biome tree-wood/extra-vein references, item enchant lists -
 * every `ref` field any content type declares) that must resolve to
 * something actually registered, checked exhaustively in one pass rather
 * than stopping at the first miss - see validateAllRefs for why that
 * matters and why it's one generic pass instead of one bespoke
 * validateXReferences() per relationship. A host (see the dedicated
 * server) should refuse to start when this returns anything: silently
 * running with some content broken is exactly the "why isn't my item in
 * the game" confusion this exists to prevent.
 *
 * Two checks stay separate, deliberately not expressible as a `ref`
 * field: validateCommandHandlers confirms every literal Command.type (a
 * closed TS union, not a content-declared field) has exactly one
 * registered handler; validateDefaultDimension confirms exactly one
 * dimension is marked the default respawn target and that it actually
 * has a working spawn point - both are structural invariants over a
 * whole registry, not "does this one field's value exist somewhere".
 */
export function validateAllContent(): string[] {
  return [...validateAllRefs(), ...validateCommandHandlers(), ...validateDefaultDimension()];
}
