/**
 * Generic behavior-hook registry: "a namespaced id resolves to a
 * trusted, already-registered function", the exact pattern dimension
 * generators/arrival generators/spawn-point generators/spawn generators/
 * multiblock handlers all independently reimplemented (own Map, own
 * register function, own "already registered" throw) before this file
 * existed. One shared Map-of-Maps instead, keyed by `kind` (e.g.
 * "dimension_generator", "multiblock_handler" - matching the `ref_kind:
 * "handler"` field's `ref_type` in registry/generic.ts's content-type
 * declarations, see world/dimension.ts/multiblock.ts) so a lookup never
 * crosses kinds (two different kinds can reuse the same id text without
 * colliding).
 *
 * This is host-independent on purpose: whether a handler function was
 * compiled into @flatcraft/sim (every built-in generator/handler today)
 * or - once Stage 7/8/9 land - transpiled from a content package's own
 * script and run inside a sandbox, registration goes through the exact
 * same registerHandler() call, under the exact same namespaced id space.
 * Nothing here knows or cares which one it was.
 *
 * Command handlers (commands/registry.ts) and tick systems
 * (systems/registry.ts) are deliberately NOT routed through this: command
 * handlers are keyed by a closed, exhaustively-validated Command.type
 * enum rather than an open namespaced id (see that file's own doc
 * comment on why Command stays closed), and tick systems are an ordered
 * list every entry of which runs every tick, not a "look up the one
 * handler this id names" lookup - forcing either onto this Map-of-Maps
 * shape would fit neither.
 */

const REGISTRIES = new Map<string, Map<string, unknown>>();

/** Register `handler` under `id` within the given `kind`'s namespace.
 * Throws if `id` is already taken within that kind. */
export function registerHandler<T>(kind: string, id: string, handler: T): void {
  let registry = REGISTRIES.get(kind);
  if (!registry) {
    registry = new Map();
    REGISTRIES.set(kind, registry);
  }
  if (registry.has(id)) {
    throw new Error(`${kind} handler "${id}" is already registered`);
  }
  registry.set(id, handler);
}

export function getHandler<T>(kind: string, id: string): T | undefined {
  return REGISTRIES.get(kind)?.get(id) as T | undefined;
}

export function hasHandler(kind: string, id: string): boolean {
  return REGISTRIES.get(kind)?.has(id) ?? false;
}
