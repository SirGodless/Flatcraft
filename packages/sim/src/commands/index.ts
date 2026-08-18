/**
 * Registers every built-in command handler - imported purely for the
 * side effect of each module's top-level registerCommandHandler(...)
 * calls running once. See registry.ts for the dispatch mechanism.
 */
import "./connection.js";
import "./movement.js";
import "./inventory.js";
import "./blocks.js";
import "./combat.js";
import "./interact.js";
