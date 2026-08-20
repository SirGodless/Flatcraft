import type { Command, PlayerId } from "../commands.js";
import type { OutboundEvent, SimEvent } from "../events.js";
import type { Simulation } from "../simulation.js";

/**
 * Command handlers: the Factorio-style split applied to player actions.
 * `apply()` in simulation.ts used to be one big switch over every
 * Command variant; each variant's logic now lives in its own registered
 * handler (see commands/*.ts), reached through the exact same dispatch
 * a future handler would use - FlatCraft's own vanilla commands are not
 * a privileged special case.
 *
 * Unlike multiblock handlers, Command itself stays a closed, exhaustive
 * union (see commands.ts) - a mod can't introduce a wholly new command
 * type without editing that union and every switch that consumes it, so
 * there's no `modname:funktion` id here to disambiguate between
 * competing implementations: each command type has exactly one handler,
 * looked up by its own type string.
 */

export interface CommandContext<C extends Command = Command> {
  sim: Simulation;
  player: PlayerId;
  command: C;
  /** Every event this tick, across every command applied - handlers
   * needing this directly (rather than via broadcast/reply) match the
   * few Simulation methods that already take it (e.g. hurtMob). */
  out: OutboundEvent[];
  /** Sent to every connected player. */
  broadcast: (event: SimEvent) => void;
  /** Sent only to the player who issued this command. */
  reply: (event: SimEvent) => void;
  /** Shorthand for reply({ type: "command_rejected", ... }). */
  reject: (reason: string) => void;
}

export interface CommandHandler<C extends Command = Command> {
  handle(ctx: CommandContext<C>): void;
}

const HANDLERS = new Map<string, CommandHandler>();

export function registerCommandHandler<T extends Command["type"]>(
  type: T,
  handler: CommandHandler<Extract<Command, { type: T }>>,
): void {
  if (HANDLERS.has(type)) {
    throw new Error(`command handler "${type}" is already registered`);
  }
  HANDLERS.set(type, handler as CommandHandler);
}

export function dispatchCommand(ctx: CommandContext): void {
  HANDLERS.get(ctx.command.type)?.handle(ctx);
}

/**
 * Every literal Command.type must resolve to a registered handler -
 * checked exhaustively here (see validateAllContent), same reasoning as
 * validateMultiblockHandlers: a missing handler should be a boot-time
 * failure, not something a player discovers by sending a command that
 * silently does nothing. ALL_COMMAND_TYPES has to be listed by hand -
 * Command's variants aren't enumerable at runtime from the type alone -
 * so keep this in sync with commands.ts's Command union.
 */
const ALL_COMMAND_TYPES: readonly Command["type"][] = [
  "join",
  "leave",
  "set_color",
  "move",
  "start_mining",
  "stop_mining",
  "attack",
  "trade",
  "use_item",
  "shoot",
  "enchant",
  "place_block",
  "use_block",
  "use_bucket",
  "grapple",
  "set_creative",
  "creative_give",
  "select_slot",
  "craft",
  "slot_click",
  "return_grid",
  "drop_cursor",
  "open_furnace",
  "open_chest",
  "request_chunk",
];

export function validateCommandHandlers(): string[] {
  return ALL_COMMAND_TYPES.filter((type) => !HANDLERS.has(type)).map(
    (type) => `command "${type}" has no registered handler`,
  );
}
