import { CHUNK_HEIGHT, CHUNK_WIDTH } from "../constants.js";
import { TRADES } from "../data/trades/index.js";
import { ATTACK_REACH } from "../entities.js";
import { ENCHANT_LAPIS_COST, ENCHANT_MAX_LEVEL, enchantFor } from "../effects.js";
import { createFurnace, furnaceKey } from "../furnace.js";
import { PLAYER_MAX_HUNGER } from "../hunger.js";
import { addToInventory, cloneInventory, removeFromInventory } from "../inventory.js";
import { itemDef } from "../items.js";
import { mobDef } from "../mobs.js";
import { blockDef, stationBlock } from "../world/block.js";
import { registerCommandHandler } from "./registry.js";

registerCommandHandler("trade", {
  handle({ sim, player, command, out, reject }) {
    const p = sim.getPlayer(player);
    if (!p) {
      reject("not joined");
      return;
    }
    const villager = sim.entities.get(command.entity);
    if (!villager || !mobDef(villager.kind)?.trades || villager.dimension !== p.dimension) {
      reject("no villager");
      return;
    }
    if (Math.hypot(villager.x - p.x, villager.y - p.y) > ATTACK_REACH + 1) {
      reject("out of reach");
      return;
    }
    const trade = TRADES[command.trade];
    if (!trade) {
      reject("unknown trade");
      return;
    }
    if (!removeFromInventory(p.inventory, trade.cost.item, trade.cost.count)) {
      reject("missing items");
      return;
    }
    addToInventory(p.inventory, trade.result.item, trade.result.count);
    sim.syncInventory(p, out);
  },
});

registerCommandHandler("use_item", {
  handle({ sim, player, out, reply, reject }) {
    const p = sim.getPlayer(player);
    if (!p) {
      reject("not joined");
      return;
    }
    const stack = p.inventory[p.selected];
    if (!stack) {
      reject("nothing to use");
      return;
    }
    const def = itemDef(stack.item);
    if (def?.effect) {
      // Potions apply instantly; the datapack decides the effect,
      // its duration and what stays behind (the bottle).
      stack.count -= 1;
      if (stack.count === 0) p.inventory[p.selected] = null;
      if (def.effect.returns) {
        addToInventory(p.inventory, def.effect.returns, 1);
      }
      p.effects[def.effect.id] = def.effect.ticks;
      sim.syncInventory(p, out);
      reply({ type: "player_effects", player: p.id, effects: { ...p.effects } });
      return;
    }
    if (def?.food) {
      if (p.hunger >= PLAYER_MAX_HUNGER) {
        reject("not hungry");
        return;
      }
      // Eating takes the item's eat_ticks; finished in stepPlayers.
      if (!p.eating) {
        p.eating = { item: stack.item, ticks: def.food.eatTicks };
      }
      return;
    }
    reject("nothing to use");
  },
});

registerCommandHandler("enchant", {
  handle({ sim, player, out, reject }) {
    const p = sim.getPlayer(player);
    if (!p) {
      reject("not joined");
      return;
    }
    const enchantingTable = stationBlock("enchanting_table");
    if (!enchantingTable || !sim.blockNearby(p, enchantingTable)) {
      reject("requires enchanting table");
      return;
    }
    const stack = p.inventory[p.selected];
    const enchId = stack ? enchantFor(stack) : null;
    if (!stack || !enchId) {
      reject("cannot enchant this");
      return;
    }
    const existing = stack.ench?.find((e) => e.id === enchId);
    if (existing && existing.level >= ENCHANT_MAX_LEVEL) {
      reject("already maxed");
      return;
    }
    if (!removeFromInventory(p.inventory, "flatcraft:item:lapis_lazuli", ENCHANT_LAPIS_COST)) {
      reject("missing lapis");
      return;
    }
    if (existing) {
      existing.level++;
    } else {
      stack.ench = [...(stack.ench ?? []), { id: enchId, level: 1 }];
    }
    sim.syncInventory(p, out);
  },
});

registerCommandHandler("open_furnace", {
  handle({ sim, player, command, reply, reject }) {
    const p = sim.getPlayer(player);
    if (!p) {
      reject("not joined");
      return;
    }
    const { x, y } = command;
    if (!Number.isInteger(x) || !Number.isInteger(y) || !sim.withinReach(player, x, y)) {
      reject("out of reach");
      return;
    }
    const furnaceDef = blockDef(sim.worldOf(p.dimension).getBlockGenerating(x, y)).furnace;
    if (furnaceDef === undefined) {
      reject("no furnace there");
      return;
    }
    let state = sim.furnaces.get(furnaceKey(p.dimension, x, y));
    if (!state) {
      state = createFurnace(p.dimension, x, y, furnaceDef.speed);
      sim.furnaces.set(furnaceKey(p.dimension, x, y), state);
      sim.worldOf(p.dimension).touchChunk(Math.floor(x / CHUNK_WIDTH), Math.floor(y / CHUNK_HEIGHT));
    }
    reply(sim.furnaceEvent(state));
  },
});

registerCommandHandler("open_chest", {
  handle({ sim, player, command, reply, reject }) {
    const p = sim.getPlayer(player);
    if (!p) {
      reject("not joined");
      return;
    }
    const { x, y } = command;
    if (!Number.isInteger(x) || !Number.isInteger(y) || !sim.withinReach(player, x, y)) {
      reject("out of reach");
      return;
    }
    const slots = blockDef(sim.worldOf(p.dimension).getBlockGenerating(x, y)).container;
    if (slots === undefined) {
      reject("no chest there");
      return;
    }
    const chest = sim.ensureChest(p.dimension, x, y, slots);
    reply({ type: "chest_changed", dim: p.dimension, x, y, slots: cloneInventory(chest.slots) });
  },
});
