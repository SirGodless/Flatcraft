import { registerTickSystem } from "./registry.js";

registerTickSystem({
  id: "flatcraft:mining",
  step(sim, out) {
    sim.stepMining(out);
  },
});
