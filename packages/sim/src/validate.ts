import { validateCommandHandlers } from "./commands/registry.js";
import { validateMultiblockHandlers } from "./multiblock.js";

/**
 * Every dependency-style content reference (multiblock handlers,
 * command handlers - more will land here as other content becomes
 * similarly pluggable) that must resolve to something actually
 * registered, checked exhaustively in one pass rather than stopping at
 * the first miss - see validateMultiblockHandlers for why that matters.
 * A host (see the dedicated server) should refuse to start when this
 * returns anything: silently running with some content broken is
 * exactly the "why isn't my item in the game" confusion this exists to
 * prevent.
 */
export function validateAllContent(): string[] {
  return [...validateMultiblockHandlers(), ...validateCommandHandlers()];
}
