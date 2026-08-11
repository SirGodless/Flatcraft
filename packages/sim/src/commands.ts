/**
 * Commands are the ONLY way anything outside the simulation requests a state
 * change ("client says what it wants to do"). The simulation validates each
 * command and either applies it or rejects it. In multiplayer these become
 * the client->server messages verbatim, so they must stay plain JSON data.
 */
export type PlayerId = number;

export type Command =
  | { type: "join"; name: string }
  | { type: "leave" }
  /** Sets the player's movement intent; it persists until the next move
   * command, so clients only send changes, not one command per tick. */
  | { type: "move"; dx: -1 | 0 | 1; jump: boolean }
  /** Start mining a block; progress accumulates every tick until the
   * block breaks or a stop_mining/new start_mining arrives. */
  | { type: "start_mining"; x: number; y: number }
  | { type: "stop_mining" }
  /** Places whatever block item is in the selected hotbar slot. */
  | { type: "place_block"; x: number; y: number }
  | { type: "select_slot"; index: number }
  /** Craft a recipe by id (recipe-book style); the simulation checks
   * ingredients and, for 3x3 recipes, a nearby crafting table. */
  | { type: "craft"; recipe: string }
  | { type: "request_chunk"; cx: number; cy: number };

/** A command attributed to the player who issued it. */
export interface PlayerCommand {
  player: PlayerId;
  command: Command;
}
