import { attackDamage, attackKnockback, PLAYER_ATTACK_COOLDOWN } from "../combat.js";
import { ARROW_TTL, ATTACK_REACH, isMobEntity, type ArrowEntity } from "../entities.js";
import { STRENGTH_BONUS } from "../effects.js";
import { itemDef } from "../items.js";
import { sizeOf } from "../mobs.js";
import { removeFromInventory } from "../inventory.js";
import { PLAYER_HEIGHT } from "../physics.js";
import { blockDef } from "../world/block.js";
import { registerCommandHandler } from "./registry.js";

registerCommandHandler("attack", {
  handle({ sim, player, command, out, reject }) {
    const p = sim.getPlayer(player);
    if (!p) {
      reject("not joined");
      return;
    }
    if (p.attackCooldown > 0) {
      return;
    }
    const entity = sim.entities.get(command.entity);
    if (!entity || !isMobEntity(entity) || entity.dimension !== p.dimension) {
      reject("no such target");
      return;
    }
    const size = sizeOf(entity.kind);
    const dist = Math.hypot(entity.x - p.x, entity.y - size.height / 2 - (p.y - PLAYER_HEIGHT / 2));
    if (dist > ATTACK_REACH) {
      reject("out of reach");
      return;
    }
    p.attackCooldown = PLAYER_ATTACK_COOLDOWN;
    const held = p.inventory[p.selected] ?? null;
    const strength = p.effects["strength"] !== undefined ? STRENGTH_BONUS : 0;
    sim.hurtMob(entity, attackDamage(held) + strength, out, p.x, attackKnockback(held));
  },
});

registerCommandHandler("shoot", {
  handle({ sim, player, command, out, broadcast, reject }) {
    const p = sim.getPlayer(player);
    if (!p) {
      reject("not joined");
      return;
    }
    const { dx, dy } = command;
    if (typeof dx !== "number" || typeof dy !== "number" || !Number.isFinite(dx) || !Number.isFinite(dy)) {
      reject("invalid direction");
      return;
    }
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) {
      reject("invalid direction");
      return;
    }
    const ranged = itemDef(p.inventory[p.selected]?.item ?? "")?.ranged;
    if (!ranged) {
      reject("no bow");
      return;
    }
    if (p.attackCooldown > 0) {
      return;
    }
    if (!removeFromInventory(p.inventory, ranged.ammo, 1)) {
      reject("no arrows");
      return;
    }
    p.attackCooldown = ranged.cooldownTicks;
    const originY = p.y - PLAYER_HEIGHT * 0.6;
    const arrow: ArrowEntity = {
      id: sim.allocatePlayerId(),
      kind: "arrow",
      dimension: p.dimension,
      x: p.x + (dx / len) * 0.8,
      y: originY + (dy / len) * 0.8,
      vx: (dx / len) * ranged.arrowSpeed,
      vy: (dy / len) * ranged.arrowSpeed,
      onGround: false,
      damage: ranged.damage,
      ttl: ARROW_TTL,
      owner: player,
    };
    sim.entities.set(arrow.id, arrow);
    broadcast({
      type: "entity_spawned",
      id: arrow.id,
      kind: "arrow",
      dim: arrow.dimension,
      x: arrow.x,
      y: arrow.y,
    });
    sim.syncInventory(p, out);
  },
});

registerCommandHandler("grapple", {
  handle({ sim, player, command, reject }) {
    const p = sim.getPlayer(player);
    if (!p) {
      reject("not joined");
      return;
    }
    const held = p.inventory[p.selected];
    const range = held ? itemDef(held.item)?.grapple : undefined;
    if (range === undefined) {
      reject("no grappling hook");
      return;
    }
    const { dx, dy } = command;
    if (typeof dx !== "number" || typeof dy !== "number" || !Number.isFinite(dx) || !Number.isFinite(dy)) {
      reject("invalid direction");
      return;
    }
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) {
      reject("invalid direction");
      return;
    }
    // March the ray; anchor just before the first solid tile.
    const world = sim.worldOf(p.dimension);
    const ox = p.x;
    const oy = p.y - PLAYER_HEIGHT / 2;
    let anchor: { x: number; y: number } | null = null;
    const step = 0.25;
    for (let d = step; d <= range; d += step) {
      const sx = ox + (dx / len) * d;
      const sy = oy + (dy / len) * d;
      if (blockDef(world.getBlockGenerating(Math.floor(sx), Math.floor(sy))).solid) {
        const back = d - step;
        anchor = { x: ox + (dx / len) * back, y: oy + (dy / len) * back };
        break;
      }
    }
    if (!anchor) {
      reject("no anchor in range");
      return;
    }
    p.grapple = { x: anchor.x, y: anchor.y, ticks: 0 };
  },
});
