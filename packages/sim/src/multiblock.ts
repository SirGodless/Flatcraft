import { CHUNK_HEIGHT, CHUNK_WIDTH } from "./constants.js";
import type { SimEvent } from "./events.js";
import { itemDef } from "./items.js";
import { registerContentType, validateContentInstance } from "./registry/generic.js";
import { getHandler, hasHandler, registerHandler } from "./registry/handlers.js";
import type { Simulation } from "./simulation.js";
import { blockByName, type BlockId } from "./world/block.js";
import type { Dimension, World } from "./world/world.js";

/**
 * Multiblocks: named, JSON-defined patterns of blocks that some player
 * action can activate (nether portals today; anything else later reuses
 * the same engine). See data/multiblocks/*.json for the format:
 *
 *   {
 *     "id": "mymod:multiblock:example",
 *     "handler": "mymod:multiblock_handler:example",
 *     "trigger_on": { "type": "place_block", "item": "item:mymod:item:flint_and_steel" },
 *     "states": {
 *       "off": { "pattern": ["OOO", "O.O", "OOO"], "key": { "O": { "block": "flatcraft:block:obsidian" }, ".": { "block": "flatcraft:block:air", "trigger": true } } }
 *     }
 *   }
 *
 * `id` and `handler` are both fully-qualified "<package>:<type>:<name>"
 * ids (see registry/schema.ts's QUALIFIED_ID_PATTERN) - `id` under type
 * "multiblock", `handler` under the pseudo-type "multiblock_handler"
 * (a handler function isn't a content *instance*, but still lives in the
 * same namespaced id space so two mods' handler names can never
 * collide). registerMultiblock/registerMultiblockHandler both reject an
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
 *
 * `build_pattern` is the construction-time counterpart to `states`: a
 * pattern+key grid (same grammar as world Structures, see
 * structures/structure.ts) a handler can stamp into the world on demand
 * via stampBuildPattern - e.g. nether portals auto-building a return
 * portal on first arrival. `anchor: [col, row]` names which pattern cell
 * lands on the world position passed to stampBuildPattern, exactly like
 * a Structure's anchor.
 *
 * `config` is a free-form data blob, opaque to this engine - only the
 * `handler` named alongside it knows what's in there (portal tuning
 * numbers today; some other handler's own tuning tomorrow). Kept generic
 * rather than typed here because different handlers need different
 * shapes, the same reason `states`/`build_pattern` don't try to express
 * per-handler *behavior*, only shape.
 */

export interface MultiblockStateJson {
  pattern: string[];
  key: Record<string, { block: string; trigger?: boolean }>;
}

export interface MultiblockBuildPatternJson {
  pattern: string[];
  key: Record<string, { block: string }>;
  anchor: number[];
}

export interface MultiblockJson {
  id: string;
  handler: string;
  trigger_on: { type: string; item?: string };
  states?: Record<string, MultiblockStateJson>;
  /** command_rejected reason when this def's trigger matched but no
   * shape did (default: "incomplete structure"). */
  fail_reason?: string;
  build_pattern?: MultiblockBuildPatternJson;
  /** Handler-specific tuning; see the module doc comment. */
  config?: Record<string, unknown>;
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

export interface MultiblockBuildPattern {
  /** rows x cols; null = leave terrain untouched, like Structure. */
  cells: (BlockId | null)[][];
  width: number;
  height: number;
  anchor: [number, number];
}

export type MultiblockTrigger = { type: "place_block"; item: string } | { type: "use_block" };

export interface MultiblockDef {
  id: string;
  handler: string;
  triggerOn: MultiblockTrigger;
  states?: Record<string, MultiblockState>;
  failReason: string;
  buildPattern?: MultiblockBuildPattern;
  config?: Record<string, unknown>;
}

export interface MultiblockMatch {
  defId: string;
  state: string;
  /** World tile of the pattern's top-left cell. */
  originX: number;
  originY: number;
}

const MULTIBLOCK_CELL_FIELDS = {
  block: { kind: "ref", ref_type: "block", required: true },
  trigger: { kind: "boolean" },
};

const BUILD_PATTERN_CELL_FIELDS = {
  block: { kind: "ref", ref_type: "block", required: true },
};

const PATTERN_STATE_FIELDS = {
  pattern: { kind: "array", required: true, items: { kind: "string" } },
  key: { kind: "record", required: true, values: { kind: "object", fields: MULTIBLOCK_CELL_FIELDS } },
};

registerContentType(
  {
    id: "multiblock",
    fields: {
      id: { kind: "qualified_id", required: true },
      handler: { kind: "ref", ref_type: "multiblock_handler", ref_kind: "handler", required: true },
      trigger_on: {
        kind: "object",
        required: true,
        fields: {
          type: { kind: "enum", values: ["place_block", "use_block"], required: true },
          item: { kind: "ref", ref_type: "item" },
        },
      },
      states: { kind: "record", values: { kind: "object", fields: PATTERN_STATE_FIELDS } },
      fail_reason: { kind: "string" },
      build_pattern: {
        kind: "object",
        fields: {
          pattern: { kind: "array", required: true, items: { kind: "string" } },
          key: { kind: "record", required: true, values: { kind: "object", fields: BUILD_PATTERN_CELL_FIELDS } },
          anchor: { kind: "array", required: true, items: { kind: "number", min: -100000, max: 100000 } },
        },
      },
      // Deliberately opaque - see the module doc comment on `config`.
      config: { kind: "any" },
    },
  },
  "engine/types/multiblock",
);

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
      const block = blockByName(entry.block);
      if (block === undefined) {
        throw new Error(`multiblock ${id}/${stateName}: unknown block "${entry.block}"`);
      }
      line.push({ block, ...(entry.trigger ? { trigger: true } : {}) });
    }
    return line;
  });
  return { cells, width, height: cells.length };
}

function parseBuildPattern(id: string, json: MultiblockBuildPatternJson): MultiblockBuildPattern {
  const width = Math.max(...json.pattern.map((r) => r.length));
  const cells: (BlockId | null)[][] = json.pattern.map((row) => {
    const line: (BlockId | null)[] = [];
    for (let i = 0; i < width; i++) {
      const char = row[i] ?? " ";
      if (char === " ") {
        line.push(null);
        continue;
      }
      const entry = json.key[char];
      if (!entry) {
        throw new Error(`multiblock ${id}: build_pattern symbol "${char}" missing from key`);
      }
      const block = blockByName(entry.block);
      if (block === undefined) {
        throw new Error(`multiblock ${id}: build_pattern references unknown block "${entry.block}"`);
      }
      line.push(block);
    }
    return line;
  });
  const [ax = -1, ay = -1] = json.anchor;
  if (ax < 0 || ax >= width || ay < 0 || ay >= cells.length) {
    throw new Error(`multiblock ${id}: build_pattern anchor out of bounds`);
  }
  return { cells, width, height: cells.length, anchor: [ax, ay] };
}

function parseTrigger(id: string, json: { type: "place_block" | "use_block"; item?: string }): MultiblockTrigger {
  if (json.type === "place_block") {
    // ref fields are syntax-checked only (see registry/generic.ts) -
    // existence still needs this explicit check, same as every other
    // ref consumer until Stage 6's deferred cross-reference pass lands.
    if (json.item === undefined || !itemDef(json.item)) {
      throw new Error(`multiblock ${id}: trigger_on needs a valid "item" for type "place_block"`);
    }
    return { type: "place_block", item: json.item };
  }
  return { type: "use_block" };
}

/** Building/matching a pattern is real algorithmic work, not schema
 * validation, so parseState/parseBuildPattern/parseTrigger above stay
 * hand-written - the generic engine (registered above) only confirms
 * the raw shape is sound before this function does anything with it,
 * same split as structures.ts/biome.ts. */
/** Register a multiblock from datapack JSON (content package files or
 * server mods). */
export function registerMultiblockJson(raw: unknown, source = "content"): MultiblockDef {
  const v = validateContentInstance("multiblock", raw, source) as {
    id: string;
    handler: string;
    trigger_on: { type: "place_block" | "use_block"; item?: string };
    states?: Record<string, MultiblockStateJson>;
    fail_reason?: string;
    build_pattern?: MultiblockBuildPatternJson;
    config?: Record<string, unknown>;
  };
  const id = v.id;
  let states: Record<string, MultiblockState> | undefined;
  if (v.states) {
    states = {};
    for (const [name, stateJson] of Object.entries(v.states)) {
      states[name] = parseState(id, name, stateJson);
    }
    if (Object.keys(states).length === 0) states = undefined;
  }
  const def: MultiblockDef = {
    id,
    handler: v.handler,
    ...(states ? { states } : {}),
    triggerOn: parseTrigger(id, v.trigger_on),
    failReason: v.fail_reason ?? "incomplete structure",
    ...(v.build_pattern ? { buildPattern: parseBuildPattern(id, v.build_pattern) } : {}),
    ...(v.config ? { config: v.config } : {}),
  };
  if (DEFS.has(def.id)) {
    throw new Error(`multiblock "${def.id}" is already registered - ids must be unique (use a modname: prefix)`);
  }
  DEFS.set(def.id, def);
  return def;
}

/**
 * Stamp a def's build_pattern into the world so that its anchor cell
 * lands on (anchorX, anchorY) - the runtime counterpart to how
 * structures/place.ts stamps a Structure during chunk generation, but
 * callable on demand at any world position instead of only at
 * generation time. Every write goes through World.setBlock/ensureChunk,
 * so it works whether or not the target chunk is already loaded.
 */
export function stampBuildPattern(
  world: World,
  pattern: MultiblockBuildPattern,
  anchorX: number,
  anchorY: number,
): Array<{ x: number; y: number; block: BlockId }> {
  const originX = anchorX - pattern.anchor[0];
  const originY = anchorY - pattern.anchor[1];
  const changes: Array<{ x: number; y: number; block: BlockId }> = [];
  for (let row = 0; row < pattern.height; row++) {
    for (let col = 0; col < pattern.width; col++) {
      const block = pattern.cells[row]?.[col];
      if (block === undefined || block === null) continue;
      const x = originX + col;
      const y = originY + row;
      world.ensureChunk(Math.floor(x / CHUNK_WIDTH), Math.floor(y / CHUNK_HEIGHT));
      world.setBlock(x, y, block);
      changes.push({ x, y, block });
    }
  }
  return changes;
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
    if (!hasHandler("multiblock_handler", def.handler)) {
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

export function registerMultiblockHandler(id: string, handler: MultiblockHandler): void {
  registerHandler("multiblock_handler", id, handler);
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
    const handler = getHandler<MultiblockHandler>("multiblock_handler", def.handler);
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
