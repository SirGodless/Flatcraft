import { describe, expect, it } from "vitest";
import { registeredTickSystemIds, registerTickSystem, runTickSystems, Simulation } from "../src/index.js";

const SEED = 1337;

describe("tick system registry", () => {
  it("registers the 7 built-in systems in the order that used to be hardcoded in tick()", () => {
    // Runs first, before any synthetic test system below is registered
    // into this file's shared module instance.
    expect(registeredTickSystemIds()).toEqual([
      "flatcraft:mining",
      "flatcraft:furnaces",
      "flatcraft:liquids",
      "flatcraft:entities",
      "flatcraft:players",
      "flatcraft:gear_sync",
      "flatcraft:spawning",
    ]);
  });

  it("rejects registering a second system under an id that's already taken", () => {
    registerTickSystem({ id: "test_dupe_system", step: () => {} });
    expect(() => registerTickSystem({ id: "test_dupe_system", step: () => {} })).toThrow(/already registered/);
  });

  it("runTickSystems runs every registered system, in registration order", () => {
    const calls: string[] = [];
    registerTickSystem({ id: "test_order_a", step: () => calls.push("a") });
    registerTickSystem({ id: "test_order_b", step: () => calls.push("b") });
    const sim = new Simulation(SEED);
    runTickSystems(sim, []);
    // The 7 built-ins ran too (harmless on a freshly-constructed sim with
    // no players/entities) - just check ours ran, and in order.
    const aIndex = calls.indexOf("a");
    const bIndex = calls.indexOf("b");
    expect(aIndex).toBeGreaterThanOrEqual(0);
    expect(bIndex).toBeGreaterThan(aIndex);
  });
});
