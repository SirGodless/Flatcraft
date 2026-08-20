import { registerTickSystem } from "./registry.js";

// Must run after every system that can change inventory/held-item/facing
// (mining, entities pickup, players) - see systems/index.ts for the
// registration order this depends on.
registerTickSystem({
  id: "flatcraft:gear_sync",
  step(sim, out) {
    sim.stepGearSync(out);
  },
});
