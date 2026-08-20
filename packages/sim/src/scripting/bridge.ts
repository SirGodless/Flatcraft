/**
 * The bridge API contract: everything a content package's script is
 * allowed to do, as a plain message-shaped interface with no
 * host-specific types leaking in (no `Simulation`, no `World`, no Node
 * or browser globals - just strings, numbers, and plain objects/
 * functions). This is *only* the contract this stage delivers - nothing
 * here is wired to a real Simulation yet, and nothing runs inside a
 * sandbox yet. That's Stage 8 (isolated-vm, dedicated server) and
 * Stage 9 (Worker + iframe, browser client): both hosts implement this
 * exact same interface, so a script written once behaves identically
 * wherever it runs.
 *
 * Scope is deliberately narrow (see the plan's "v1-Bridge-Umfang"):
 *
 *   IN:  register a content instance (same shape as JSON content today),
 *        register a tick hook, register the handler *body* for an
 *        EXISTING command type (never a new Command variant - see
 *        commands/registry.ts's own doc comment on why Command stays a
 *        closed union), register a multiblock handler or dimension
 *        generator/arrival/spawn-point/spawn function, read/write world
 *        blocks and walls, spawn an item, deterministic RNG.
 *
 *   OUT: custom rendering, custom UI panels, new Command/SimEvent
 *        variants - all explicitly deferred past v1 (plan Stufe 11+).
 *
 * Every method here is meant to be a thin, curated re-export of
 * something Simulation/World already does for a compiled-in TS command
 * handler or tick system today (see commands/registry.ts's
 * CommandContext, systems/registry.ts's TickSystem) - this is not a new
 * capability surface, it's the SAME capability surface narrowed down to
 * what's safe to also hand to code this engine didn't compile itself.
 * Block/item ids cross this boundary as their qualified string form
 * ("flatcraft:block:stone"), never as the engine-internal numeric
 * BlockId - a script has no reason to know that storage detail exists.
 */

/** One tile's read/write surface for a single dimension - obtained via
 * BridgeContext.world(dimensionId). Mirrors World.getBlock/setBlock/
 * getWall/setWall exactly, just block-name-typed instead of BlockId-typed. */
export interface BridgeWorld {
  getBlock(x: number, y: number): string;
  setBlock(x: number, y: number, block: string): boolean;
  getWall(x: number, y: number): string;
  setWall(x: number, y: number, block: string): boolean;
}

/** Mirrors world/dimension.ts's DimensionGenerator/ArrivalGenerator/
 * SpawnPointGenerator and spawning.ts's SpawnGenerator - one of these
 * gets registered under a qualified id via BridgeContext.registerXHandler
 * and is later looked up the exact same way a compiled-in one is (see
 * registry/handlers.ts), whichever host actually calls it. */
export type BridgeDimensionGenerator = (seed: number, cx: number, cy: number) => void;
export type BridgeArrivalGenerator = (world: BridgeWorld, xt: number) => number;
export type BridgeSpawnPointGenerator = (seed: number) => { x: number; y: number };

/** Mirrors multiblock.ts's MultiblockHandler.activate, narrowed to the
 * bridge-safe subset of MultiblockActivateContext (no direct Simulation
 * access - anything a handler needs from the wider sim state has to be
 * an explicit bridge method instead). */
export interface BridgeMultiblockContext {
  world: BridgeWorld;
  dimension: string;
  x: number;
  y: number;
}
export type BridgeMultiblockHandler = (ctx: BridgeMultiblockContext) => boolean;

/** Mirrors systems/registry.ts's TickSystem.step - runs once per tick,
 * registration order among script-registered hooks matching call order,
 * same rule the compiled-in registry already follows. */
export type BridgeTickHook = (ctx: BridgeContext) => void;

/** Mirrors commands/registry.ts's CommandHandler.handle, but only for a
 * command `type` the engine already declares - see the module doc
 * comment on why this can't introduce a wholly new Command variant.
 * Open question this stage deliberately leaves for Stage 8/9's real
 * wiring, not resolved here: every existing Command.type already has
 * exactly one compiled-in handler (registerCommandHandler throws on a
 * second registration for the same type today), so "register a body for
 * an existing type" needs an actual replace/wrap/chain decision before
 * it can be implemented - this type only names the shape a handler body
 * would have once that's settled. */
export type BridgeCommandHandlerBody = (ctx: BridgeContext, command: unknown, player: string) => void;

export interface BridgeContext {
  /** The world for one dimension, by its qualified id
   * ("flatcraft:dimension:overworld") - undefined for an unregistered
   * dimension id, never a crash. */
  world(dimension: string): BridgeWorld | undefined;

  /** Deterministic PRNG draw, [0, 1) - the ONLY source of randomness a
   * sim-mutating hook (tick hook, command handler body, multiblock
   * handler, dimension/arrival/spawn-point generator) may use. Never
   * Date.now()/Math.random() - those would desync client prediction
   * from the authoritative server and break replay determinism. Purely
   * cosmetic, client-only hooks (Stage 11+, not in this bridge yet) are
   * the one place real time/randomness would ever be acceptable. */
  rng(): number;

  /** Spawns an item entity lying in the world (drops, given items, ...). */
  spawnItem(dimension: string, x: number, y: number, item: string, count: number): void;

  /** Registers one instance of an existing content type (block/item/
   * mob/...) - the exact same validated shape a JSON file in that
   * type's content-package directory would provide (see
   * registry/generic.ts's registerContentType/validateContentInstance).
   * A script can populate/extend a type's registry; it cannot declare a
   * wholly new type through this call (that's registerContentType
   * itself, not yet part of this bridge). */
  registerContentInstance(typeId: string, instance: Record<string, unknown>): void;

  registerTickHook(id: string, hook: BridgeTickHook): void;
  registerCommandHandlerBody(commandType: string, id: string, handler: BridgeCommandHandlerBody): void;
  registerMultiblockHandler(id: string, handler: BridgeMultiblockHandler): void;
  registerDimensionGenerator(id: string, generator: BridgeDimensionGenerator): void;
  registerArrivalGenerator(id: string, generator: BridgeArrivalGenerator): void;
  registerSpawnPointGenerator(id: string, generator: BridgeSpawnPointGenerator): void;
}
