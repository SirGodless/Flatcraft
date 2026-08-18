import { registerTickSystem } from "./registry.js";

registerTickSystem({
  id: "flatcraft:liquids",
  step(sim, out) {
    sim.stepLiquids(out);
  },
});
