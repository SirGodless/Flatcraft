import type { Command } from "@flatcraft/sim";

/**
 * Input layer stub. Translates raw browser events into Commands; it never
 * touches game state directly. Wired up once player movement exists.
 */
export type CommandSink = (command: Command) => void;

export function attachInput(_target: HTMLElement, _sink: CommandSink): () => void {
  // Keyboard/mouse listeners will be registered here.
  return () => {};
}
