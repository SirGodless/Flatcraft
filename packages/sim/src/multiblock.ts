import type { SimEvent } from "./events.js";
import { itemDef } from "./items.js";
import type { Simulation } from "./simulation.js";
import { blockByName, type BlockId } from "./world/block.js";
import type { Dimension, World } from "./world/world.js";

/**
 * Multiblocks: named, JSON-defined patterns of blocks that some player
 * action can activate (nether portals today; anything else later reuses
 * the same engine). See data/multiblocks/*.json for the format:
 *
 *   {
 *     "id": "mymod:example",
 *     "handler": "mymod:example",
 *     "trigger_on": { "type": "place_block", "item": "flint_and_steel" },
 *     "states": {
 *       "off": { "pattern": ["OOO", "O.O", "OOO"], "key": { "O": { "block": "obsidian" }, ".": { "block": "air", "trigger": true } } }
 *     }
 *   }
 *
 * `id` and `handler` are conventionally namespaced `modname:funktion`
 * (built-in content uses `flatcraft:`) - this is a plain naming
 * convention, not something the engine parses or defaults for you: a
 * bare id with no colon is just its own distinct string, so two
 * differently-named mods never collide as long as each prefixes its
 * own ids. registerMultiblock/registerMultiblockHandler both reject an
 * id that's already taken (see below) rather than silently letting a
 * later registration overwrite an earlier one - namespacing is what
 * makes that collision unlikely in the first place, the check is what
 * catches it immediately if it happens anyway (e.g. a copy-pasted id).
 *
 * `states` (like a Structure's pattern) is a fixed-size rectangle - any
 * multiblock whose shape doesn't vary works this way, matched by
 * matchMultiblock() below, which only ever reads the world through
 * World.getBlockGenerating(): a check spanning a chunk boundary always
 * loads whatever it touches before answering, so there's no window where
 * "chunk not loaded yet" could be misread as "block missing" and falsely
 * invalidate a real structure (the failure mode that famously caused
 * Applied Energistics 2's chunk-loading item-duplication crashes in
 * Minecraft). A pattern-driven multiblock never needs custom matching
 * code at all - just JSON plus a registered handler for what happens on
 * activation.
 *
 * `states` is optional for a shape too irregular for a fixed rectangle
 * (nether portals: frame width/height both vary, and corners don't
 * matter) - such a multiblock's handler does its own shape check, using
 * the same safe getBlockGenerating-only rule, and reports back whether
 * it found and activated something. Either way, activation logic itself
 * (what actually happens - teleporting, converting blocks, crafting,
 * whatever) is never expressed in JSON, only referenced by a `handler`
 * id: JSON data can compose *which* trusted, already-registered behavior
 * applies and to *what shape*, never inject new behavior of its own -
 * this server can load datapacks, and running code referenced from a
 * data file would make that arbitrary code execution.
 */

export interface MultiblockStateJson {
  pattern: string[];
  key: Record<string, { block: string; trigger?: boolean }>;
}

export interface MultiblockJson {
  id: string;
  handler: string;
  trigger_on: { type: string; item?: string };
  states?: Record<string, MultiblockStateJson>;
  /** command_rejected reason when this def's trigger matched but no
   * shape did (default: "incomplete structure"). */
  fail_reason?: string;
}

export interface MultiblockCell {
  block: BlockId;
  trigger?: boolean;
}

export interface MultiblockState {
  /** rows x cols; null = any block (untouched/don't-care), like Structure. */
  cells: (MultiblockCell | null)[][];
  width: number;
  height: number;
}

export type MultiblockTrigger = { type: "place_block"; item: string } | { type: "use_block" };

export interface MultiblockDef {
  id: string;
  handler: string;
  triggerOn: MultiblockTrigger;
  states?: Record<string, MultiblockState>;
  failReason: string;
}

export interface MultiblockMatch {
  defId: string;
  state: string;
  /** World tile of the pattern's top-left cell. */
  originX: number;
  originY: number;
}

const NAMESPACE = "flatcraft:";

function stripNs(raw: string): string {
  return raw.startsWith(NAMESPACE) ? raw.slice(NAMESPACE.length) : raw;
}

function parseState(id: string, stateName: string, json: MultiblockStateJson): MultiblockState {
  const width = Math.max(...json.pattern.map((r) => r.length));
  const cells: (MultiblockCell | null)[][] = json.pattern.map((row) => {
    const line: (MultiblockCell | null)[] = [];
    for (let i = 0; i < width; i++) {
      const char = row[i] ?? " ";
      if (char === " ") {
        line.push(null);
        continue;
      }
      const entry = json.key[char];
      if (!entry) {
        throw new Error(`multiblock ${id}/${stateName}: symbol "${char}" missing from key`);
      }
      const block = blockByName(stripNs(entry.block));
      if (block === undefined) {
        throw new Error(`multiblock ${id}/${stateName}: unknown block "${entry.block}"`);
      }
      line.push({ block, ...(entry.trigger ? { trigger: true } : {}) });
    }
    return line;
  });
  return { cells, width, height: cells.length };
}

function parseTrigger(id: string, json: MultiblockJson["trigger_on"]): MultiblockTrigger {
  if (json.type === "place_block") {
    if (typeof json.item !== "string" || !itemDef(stripNs(json.item))) {
      throw new Error(`multiblock ${id}: trigger_on needs a valid "item" for type "place_block"`);
    }
    return { type: "place_block", item: stripNs(json.item) };
  }
  if (json.type === "use_block") return { type: "use_block" };
  throw new Error(`multiblock ${id}: unknown trigger_on.type "${json.type}"`);
}

export function parseMultiblock(id: string, json: MultiblockJson): MultiblockDef {
  if (typeof json.handler !== "string" || json.handler.length === 0) {
    throw new Error(`multiblock ${id}: "handler" is required`);
  }
  let states: Record<string, MultiblockState> | undefined;
  if (json.states) {
    states = {};
    for (const [name, stateJson] of Object.entries(json.states)) {
      states[name] = parseState(id, name, stateJson);
    }
    if (Object.keys(states).length === 0) states = undefined;
  }
  return {
    id,
    handler: json.handler,
    ...(states ? { states } : {}),
    triggerOn: parseTrigger(id, json.trigger_on),
    failReason: json.fail_reason ?? "incomplete structure",
  };
}

/**
 * Tries every trigger-marked cell of every declared state, aligned so
 * that cell lands on (x, y) - matches how findPortalInterior can start
 * from any interior tile, not just one fixed anchor. Returns the first
 * full match. Every block read goes through World.getBlockGenerating -
 * see the module doc comment for why that's the whole point.
 */
export function matchMultiblock(world: World, def: MultiblockDef, x: number, y: number): MultiblockMatch | null {
  if (!def.states) return null;
  for (const [stateName, state] of Object.entries(def.states)) {
    for (let row = 0; row < state.height; row++) {
      for (let col = 0; col < state.width; col++) {
        if (!state.cells[row]?.[col]?.trigger) continue;
        const originX = x - col;
        const originY = y - row;
        if (matchesAt(world, state, originX, originY)) {
          return { defId: def.id, state: stateName, originX, originY };
        }
      }
    }
  }
  return null;
}

function matchesAt(world: World, state: MultiblockState, originX: number, originY: number): boolean {
  for (let row = 0; row < state.height; row++) {
    for (let col = 0; col < state.width; col++) {
      const cell = state.cells[row]?.[col];
      if (!cell) continue;
      if (world.getBlockGenerating(originX + col, originY + row) !== cell.block) return false;
    }
  }
  return true;
}

// --- Registries ---

const DEFS = new Map<string, MultiblockDef>();

export function registerMultiblock(def: MultiblockDef): void {
  if (DEFS.has(def.id)) {
    throw new Error(`multiblock "${def.id}" is already registered - ids must be unique (use a modname: prefix)`);
  }
  DEFS.set(def.id, def);
}

export function multiblockDef(id: string): MultiblockDef | undefined {
  return DEFS.get(id);
}

export function allMultiblocks(): Iterable<MultiblockDef> {
  return DEFS.values();
}

/**
 * Every registered multiblock's `handler` must resolve to an actually
 * registered MultiblockHandler - tryActivateMultiblock already skips a
 * def with no matching handler rather than crash (so a live game never
 * breaks over it), but that silence is exactly the problem for content
 * authoring: a typo'd or forgotten handler id would otherwise only show
 * up as "this multiblock just doesn't do anything," discovered by a
 * player, not by whoever shipped it. This walks every def exhaustively
 * and returns one message per missing handler - never stops at the
 * first - so a host validating its full content set (see
 * validateAllContent) can report everything broken in one pass instead
 * of a fix-one-restart-find-the-next loop. Doesn't throw itself; the
 * caller decides what "some content is broken" should mean for it.
 */
export function validateMultiblockHandlers(): string[] {
  const problems: string[] = [];
  for (const def of DEFS.values()) {
    if (!HANDLERS.has(def.handler)) {
      problems.push(`multiblock "${def.id}" references unknown behavior "${def.handler}"`);
    }
  }
  return problems;
}

/**
 * What a multiblock's `handler` id resolves to - one small, trusted,
 * already-compiled function per distinct *behavior* (never per shape;
 * a new shape of an existing behavior is pure JSON, reusing the same
 * handler id). `match` is the confirmed pattern match for a fixed-shape
 * def (`states` declared); undefined for a variable-shape def, whose
 * handler must do its own safe (getBlockGenerating-only) check and
 * report back whether it found and activated anything.
 */
export interface MultiblockActivateContext {
  world: World;
  def: MultiblockDef;
  match: MultiblockMatch | undefined;
  x: number;
  y: number;
  dimension: Dimension;
  /** The owning Simulation, for handlers that need broader state (e.g.
   * nether portals' known-position index for teleport-arrival reuse) -
   * only its already-public API, nothing multiblock-specific added to
   * Simulation itself. */
  sim: Simulation;
  broadcast: (event: SimEvent) => void;
}

export interface MultiblockHandler {
  activate(ctx: MultiblockActivateContext): boolean;
}

const HANDLERS = new Map<string, MultiblockHandler>();

export function registerMultiblockHandler(id: string, handler: MultiblockHandler): void {
  if (HANDLERS.has(id)) {
    throw new Error(`multiblock handler "${id}" is already registered - ids must be unique (use a modname: prefix)`);
  }
  HANDLERS.set(id, handler);
}

function triggerMatches(defTrigger: MultiblockTrigger, actual: MultiblockTrigger): boolean {
  if (defTrigger.type !== actual.type) return false;
  return defTrigger.type === "place_block" && actual.type === "place_block" ? defTrigger.item === actual.item : true;
}

export type MultiblockAttemptResult =
  /** Nothing registered has a trigger_on matching this action at all -
   * the caller should fall through to its own default handling (e.g.
   * placing a normal block). */
  | { activated: false; attempted: false }
  /** A matching trigger was found, but the required shape wasn't (either
   * the fixed pattern didn't match, or a variable-shape handler's own
   * check failed) - the caller should reject with `failReason`. */
  | { activated: false; attempted: true; failReason: string }
  | { activated: true };

/**
 * The single entry point command handlers call: "something happened
 * here that might activate a multiblock - did it?" Tries registered
 * defs whose trigger_on matches this action; the first one whose trigger
 * matches decides the outcome (activated, or a specific failure reason)
 * without falling through to try any other def, since in practice one
 * item/block is never meant to trigger more than one multiblock type at
 * once. Command handlers stay entirely unaware of which items/blocks/
 * shapes exist - that's fully described by the loaded defs and their
 * handlers.
 */
export function tryActivateMultiblock(
  world: World,
  x: number,
  y: number,
  trigger: MultiblockTrigger,
  ctx: { dimension: Dimension; sim: Simulation; broadcast: (event: SimEvent) => void },
): MultiblockAttemptResult {
  for (const def of DEFS.values()) {
    if (!triggerMatches(def.triggerOn, trigger)) continue;
    const handler = HANDLERS.get(def.handler);
    if (!handler) continue; // no registered behavior for this id - skip, never crash
    let match: MultiblockMatch | undefined;
    if (def.states) {
      const found = matchMultiblock(world, def, x, y);
      if (!found) return { activated: false, attempted: true, failReason: def.failReason };
      match = found;
    }
    if (handler.activate({ world, def, match, x, y, ...ctx })) return { activated: true };
    return { activated: false, attempted: true, failReason: def.failReason };
  }
  return { activated: false, attempted: false };
}
