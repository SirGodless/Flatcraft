import { HOTBAR_SIZE } from "../inventory.js";
import { sanitizeColor } from "../simulation.js";
import { registerCommandHandler } from "./registry.js";

registerCommandHandler("move", {
  handle({ sim, player, command, reject }) {
    const p = sim.getPlayer(player);
    if (!p) {
      reject("not joined");
      return;
    }
    if (![-1, 0, 1].includes(command.dx) || typeof command.jump !== "boolean") {
      reject("invalid input");
      return;
    }
    p.input = { dx: command.dx, jump: command.jump, down: command.down === true };
    if (command.dx !== 0) p.facing = command.dx > 0 ? "right" : "left";
  },
});

registerCommandHandler("set_color", {
  handle({ sim, player, command, broadcast, reject }) {
    const p = sim.getPlayer(player);
    if (!p) {
      reject("not joined");
      return;
    }
    const color = sanitizeColor(command.color);
    if (color === null) {
      reject("invalid color");
      return;
    }
    p.color = color;
    broadcast({ type: "player_color", player, color });
  },
});

registerCommandHandler("select_slot", {
  handle({ sim, player, command, out, reject }) {
    const p = sim.getPlayer(player);
    if (!p) {
      reject("not joined");
      return;
    }
    if (!Number.isInteger(command.index) || command.index < 0 || command.index >= HOTBAR_SIZE) {
      reject("invalid slot");
      return;
    }
    p.selected = command.index;
    sim.syncInventory(p, out);
  },
});

registerCommandHandler("set_creative", {
  handle({ sim, player, command, reply, reject }) {
    const p = sim.getPlayer(player);
    if (!p) {
      reject("not joined");
      return;
    }
    p.creative = command.on === true;
    if (!p.creative) p.vy = Math.min(p.vy, 0);
    reply({ type: "player_creative", player, on: p.creative });
  },
});
