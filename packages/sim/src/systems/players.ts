import { registerTickSystem } from "./registry.js";

registerTickSystem({
  id: "flatcraft:players",
  step(sim, out) {
    sim.stepPlayers(out);
  },
});
