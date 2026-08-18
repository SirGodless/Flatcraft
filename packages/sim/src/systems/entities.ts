import { registerTickSystem } from "./registry.js";

registerTickSystem({
  id: "flatcraft:entities",
  step(sim, out) {
    sim.stepEntities(out);
  },
});
