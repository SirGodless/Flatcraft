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
  /** Melee-attack a mob by entity id. */
  | { type: "attack"; entity: number }
  /** Trade with a villager: exchange the trade cost for its result. */
  | { type: "trade"; entity: number; trade: number }
  /** Use the selected item (drink a potion, eat food). */
  | { type: "use_item" }
  /** Shoot an arrow with the held bow in the given direction (the
   * simulation normalizes the vector and checks bow + arrows). */
  | { type: "shoot"; dx: number; dy: number }
  /** Enchant the selected tool at a nearby enchanting table (lapis cost). */
  | { type: "enchant" }
  /** Places whatever block item is in the selected hotbar slot. */
  | { type: "place_block"; x: number; y: number }
  | { type: "select_slot"; index: number }
  /** Quick-craft a recipe by id (like Minecraft's recipe book); the
   * simulation checks ingredients and, for 3x3 recipes, a nearby table. */
  | { type: "craft"; recipe: string }
  /** A Minecraft-style cursor click on a UI slot. */
  | { type: "slot_click"; slot: SlotRef; button: "left" | "right" }
  /** Return crafting grid + cursor contents to the inventory (UI closed). */
  | { type: "return_grid" }
  /** Open a furnace: validates it and returns its current state. */
  | { type: "open_furnace"; x: number; y: number }
  /** Open a chest: validates it and returns its current contents. */
  | { type: "open_chest"; x: number; y: number }
  | { type: "request_chunk"; cx: number; cy: number };

/** Addresses a slot in one of the clickable containers. */
export type SlotRef =
  | { container: "inventory"; index: number }
  | { container: "craft_grid"; index: number }
  | { container: "craft_result" }
  | { container: "furnace"; x: number; y: number; slot: "input" | "fuel" | "output" }
  | { container: "chest"; x: number; y: number; index: number }
  /** A slot inside the backpack in the player's selected hotbar slot. */
  | { container: "backpack"; index: number };

/** A command attributed to the player who issued it. */
export interface PlayerCommand {
  player: PlayerId;
  command: Command;
}
