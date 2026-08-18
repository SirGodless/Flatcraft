import { describe, expect, it } from "vitest";
import {
  parseMultiblock,
  registerCommandHandler,
  registerMultiblock,
  validateAllContent,
  validateCommandHandlers,
  validateMultiblockHandlers,
} from "../src/index.js";

/**
 * Own file, not multiblock.test.ts: registerMultiblock/registerMultiblockHandler
 * are process-global registries shared by every test in one file (see
 * multiblock.test.ts's own doc comment), and other tests there deliberately
 * register defs with missing handlers to prove tryActivateMultiblock skips
 * them safely - which would pollute a "real content validates cleanly"
 * assertion if it lived in the same file. A fresh test file gets its own
 * module instance, so this one only ever sees the real, built-in content
 * plus whatever it registers itself.
 */

describe("content dependency validation", () => {
  it("the real, built-in multiblock content has no missing handler references", () => {
    // Runs first in this file, before any synthetic bad def below is
    // registered into the same shared (per-file) module instance.
    expect(validateMultiblockHandlers()).toEqual([]);
    expect(validateAllContent()).toEqual([]);
  });

  it("reports every multiblock with a missing handler, not just the first", () => {
    registerMultiblock(
      parseMultiblock("test_validate_missing_1", {
        id: "test_validate_missing_1",
        handler: "nobody_registered_this_1",
        trigger_on: { type: "place_block", item: "coal" },
      }),
    );
    registerMultiblock(
      parseMultiblock("test_validate_missing_2", {
        id: "test_validate_missing_2",
        handler: "nobody_registered_this_2",
        trigger_on: { type: "place_block", item: "bone" },
      }),
    );

    const problems = validateMultiblockHandlers();
    expect(problems).toContain('multiblock "test_validate_missing_1" references unknown behavior "nobody_registered_this_1"');
    expect(problems).toContain('multiblock "test_validate_missing_2" references unknown behavior "nobody_registered_this_2"');
    // validateAllContent must surface the same problems, not swallow them.
    expect(validateAllContent().length).toBeGreaterThanOrEqual(2);
  });
});

describe("command handler validation", () => {
  it("every literal Command.type has a registered handler - none were forgotten", () => {
    expect(validateCommandHandlers()).toEqual([]);
  });

  it("rejects registering a second handler for a command type that already has one", () => {
    expect(() => registerCommandHandler("leave", { handle: () => {} })).toThrow(/already registered/);
  });
});
