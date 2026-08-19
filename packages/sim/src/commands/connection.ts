import { CRAFT_GRID_SIZE } from "../crafting/match.js";
import { PLAYER_MAX_HEALTH } from "../combat.js";
import { isItemEntity, isPlayerEntity, type PlayerEntity } from "../entities.js";
import { PLAYER_MAX_HUNGER } from "../hunger.js";
import { createInventory, type ItemStack } from "../inventory.js";
import { DEFAULT_PLAYER_COLOR, MAX_AIR_TICKS, sanitizeColor } from "../simulation.js";
import { defaultDimensionId, generateDefaultSpawnPoint } from "../world/dimension.js";
import { registerCommandHandler } from "./registry.js";

registerCommandHandler("join", {
  handle({ sim, player, command, out, broadcast, reply, reject }) {
    // One live player per name (names are identity for saves/rejoins).
    if ([...sim.playerEntities()].some((p) => p.name === command.name)) {
      reject("name already in use");
      return;
    }
    // Tell the joiner who is already in the world.
    const replayPlayers = (): void => {
      for (const other of sim.playerEntities()) {
        if (other.id === player) continue;
        reply({
          type: "player_joined",
          player: other.id,
          name: other.name,
          x: other.x,
          y: other.y,
          dim: other.dimension,
          color: other.color,
          facing: other.facing,
          main: other.inventory[other.selected]?.item ?? null,
          off: other.offhand?.item ?? null,
        });
      }
    };
    const chosenColor = sanitizeColor(command.color);
    // A returning player (same name) picks up exactly where they left.
    const saved = sim.savedPlayers.get(command.name);
    if (saved) {
      sim.savedPlayers.delete(command.name);
      const state: PlayerEntity = { ...structuredClone(saved), id: player };
      // Older saves lack newer fields; default them on adoption.
      state.hunger = Number.isFinite(state.hunger) ? state.hunger : PLAYER_MAX_HUNGER;
      state.exhaustion = Number.isFinite(state.exhaustion) ? state.exhaustion : 0;
      state.color = chosenColor ?? sanitizeColor(state.color) ?? DEFAULT_PLAYER_COLOR;
      state.armor = state.armor ?? null;
      state.offhand = state.offhand ?? null;
      state.saturation = Number.isFinite(state.saturation) ? state.saturation : 5;
      state.eating = null;
      state.grapple = null;
      state.creative = state.creative === true;
      state.air = Number.isFinite(state.air) ? state.air : MAX_AIR_TICKS;
      state.facing = state.facing === "left" ? "left" : "right";
      sim.entities.set(player, state);
      const rejoinMain = state.inventory[state.selected]?.item ?? null;
      const rejoinOff = state.offhand?.item ?? null;
      sim.lastGear.set(player, { facing: state.facing, main: rejoinMain, off: rejoinOff });
      broadcast({
        type: "player_joined",
        player,
        name: state.name,
        x: state.x,
        y: state.y,
        dim: state.dimension,
        color: state.color,
        facing: state.facing,
        main: rejoinMain,
        off: rejoinOff,
      });
      sim.syncInventory(state, out);
      reply({ type: "player_health", player, health: state.health, max: PLAYER_MAX_HEALTH });
      reply({ type: "player_hunger", player, hunger: state.hunger, max: PLAYER_MAX_HUNGER });
      reply({ type: "time_changed", time: sim.timeOfDay });
      reply({ type: "player_dimension", player, dim: state.dimension, x: state.x, y: state.y });
      replayPlayers();
      for (const entity of sim.entities.values()) {
        if (isPlayerEntity(entity)) continue;
        reply({
          type: "entity_spawned",
          id: entity.id,
          kind: entity.kind,
          dim: entity.dimension,
          x: entity.x,
          y: entity.y,
          ...(isItemEntity(entity) ? { stack: { ...entity.stack } } : {}),
        });
      }
      return;
    }
    const defaultDim = defaultDimensionId();
    const point = generateDefaultSpawnPoint(sim.worldOf(defaultDim).seed);
    const { x, y } = point;
    const state: PlayerEntity = {
      id: player,
      kind: "player",
      name: command.name,
      color: chosenColor ?? DEFAULT_PLAYER_COLOR,
      dimension: defaultDim,
      x,
      y,
      vx: 0,
      vy: 0,
      onGround: false,
      input: { dx: 0, jump: false },
      inventory: createInventory(),
      selected: 0,
      cursor: null,
      craftGrid: new Array<ItemStack | null>(CRAFT_GRID_SIZE).fill(null),
      mining: null,
      health: PLAYER_MAX_HEALTH,
      hunger: PLAYER_MAX_HUNGER,
      exhaustion: 0,
      hurtCooldown: 0,
      attackCooldown: 0,
      kbX: 0,
      fallDistance: 0,
      effects: {},
      portalTicks: 0,
      portalCooldown: 0,
      saturation: 5,
      eating: null,
      armor: null,
      offhand: null,
      grapple: null,
      creative: false,
      air: MAX_AIR_TICKS,
      facing: "right",
    };
    sim.entities.set(player, state);
    sim.lastGear.set(player, { facing: state.facing, main: null, off: null });
    broadcast({
      type: "player_joined",
      player,
      name: state.name,
      x,
      y,
      dim: defaultDim,
      color: state.color,
      facing: state.facing,
      main: null,
      off: null,
    });
    sim.syncInventory(state, out);
    reply({ type: "player_health", player, health: state.health, max: PLAYER_MAX_HEALTH });
    reply({ type: "player_hunger", player, hunger: state.hunger, max: PLAYER_MAX_HUNGER });
    reply({ type: "time_changed", time: sim.timeOfDay });
    replayPlayers();
    for (const entity of sim.entities.values()) {
      if (isPlayerEntity(entity)) continue;
      reply({
        type: "entity_spawned",
        id: entity.id,
        kind: entity.kind,
        dim: entity.dimension,
        x: entity.x,
        y: entity.y,
        ...(isItemEntity(entity) ? { stack: { ...entity.stack } } : {}),
      });
    }
  },
});

registerCommandHandler("leave", {
  handle({ sim, player, broadcast }) {
    const p = sim.getPlayer(player);
    if (p && sim.entities.delete(player)) {
      // Keep the state for a future rejoin (and for saves).
      sim.savedPlayers.set(p.name, p);
      sim.lastGear.delete(player);
      broadcast({ type: "player_left", player });
    }
  },
});
