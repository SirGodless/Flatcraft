import { registerTickSystem } from "./registry.js";

registerTickSystem({
  id: "flatcraft:furnaces",
  step(sim, out) {
    sim.stepFurnaces(out);
  },
});
