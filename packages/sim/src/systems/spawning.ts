import { registerTickSystem } from "./registry.js";

registerTickSystem({
  id: "flatcraft:spawning",
  step(sim, out) {
    sim.stepSpawning(out);
  },
});
