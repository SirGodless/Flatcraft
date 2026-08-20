import { ingredientOptions } from "../crafting/recipe.js";
import { RECIPES } from "../data/recipes/index.js";
import { addToInventory, countInInventory, removeFromInventory } from "../inventory.js";
import { itemDef } from "../items.js";
import { stationBlock } from "../world/block.js";
import { registerCommandHandler } from "./registry.js";

registerCommandHandler("craft", {
  handle({ sim, player, command, out, reject }) {
    const p = sim.getPlayer(player);
    if (!p) {
      reject("not joined");
      return;
    }
    const recipe = RECIPES.get(command.recipe);
    if (!recipe || recipe.kind === "smelting") {
      reject("unknown recipe");
      return;
    }
    if (recipe.station !== "inventory") {
      const required = stationBlock(recipe.station);
      if (!required || !sim.blockNearby(p, required)) {
        reject(`requires ${recipe.station.replace("_", " ")}`);
        return;
      }
    }
    // Ingredient keys may be tags ("#planks"): any member counts.
    for (const [key, count] of recipe.ingredients) {
      const available = ingredientOptions(key).reduce(
        (sum, item) => sum + countInInventory(p.inventory, item),
        0,
      );
      if (available < count) {
        reject("missing ingredients");
        return;
      }
    }
    for (const [key, count] of recipe.ingredients) {
      let remaining = count;
      for (const item of ingredientOptions(key)) {
        while (remaining > 0 && removeFromInventory(p.inventory, item, 1)) {
          remaining--;
        }
      }
    }
    addToInventory(p.inventory, recipe.result.item, recipe.result.count);
    sim.syncInventory(p, out);
  },
});

registerCommandHandler("slot_click", {
  handle({ sim, player, command, out, broadcast, reject }) {
    const p = sim.getPlayer(player);
    if (!p) {
      reject("not joined");
      return;
    }
    if (command.button !== "left" && command.button !== "right") {
      reject("invalid button");
      return;
    }
    sim.applySlotClick(p, command.slot, command.button, reject, broadcast);
    sim.syncInventory(p, out);
  },
});

registerCommandHandler("return_grid", {
  handle({ sim, player, out, reject }) {
    const p = sim.getPlayer(player);
    if (!p) {
      reject("not joined");
      return;
    }
    sim.dumpGridAndCursor(p);
    sim.syncInventory(p, out);
  },
});

registerCommandHandler("drop_cursor", {
  handle({ sim, player, out, reject }) {
    const p = sim.getPlayer(player);
    if (!p) {
      reject("not joined");
      return;
    }
    if (!p.cursor) return;
    sim.spawnItem(p.dimension, p.x, p.y - 1, p.cursor, out);
    p.cursor = null;
    sim.syncInventory(p, out);
  },
});

registerCommandHandler("creative_give", {
  handle({ sim, player, command, out, reject }) {
    const p = sim.getPlayer(player);
    if (!p) {
      reject("not joined");
      return;
    }
    if (!p.creative) {
      reject("not in creative mode");
      return;
    }
    const def = itemDef(command.item);
    const count = Number(command.count);
    if (!def || !Number.isInteger(count) || count < 1 || count > 64) {
      reject("invalid item");
      return;
    }
    addToInventory(p.inventory, def.id, Math.min(count, def.maxStack));
    sim.syncInventory(p, out);
  },
});
