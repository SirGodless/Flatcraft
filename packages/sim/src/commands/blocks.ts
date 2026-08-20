import { itemDef } from "../items.js";
import { liquidDef } from "../liquids.js";
import { tryActivateMultiblock } from "../multiblock.js";
import { MAX_CHUNK_COORD } from "../simulation.js";
import { blockDef, BlockId, liquidBlock } from "../world/block.js";
import { registerCommandHandler } from "./registry.js";

registerCommandHandler("request_chunk", {
  handle({ sim, player, command, reply, reject }) {
    const p = sim.getPlayer(player);
    if (!p) {
      reject("not joined");
      return;
    }
    const { cx, cy } = command;
    if (
      !Number.isInteger(cx) ||
      !Number.isInteger(cy) ||
      Math.abs(cx) > MAX_CHUNK_COORD ||
      Math.abs(cy) > MAX_CHUNK_COORD
    ) {
      reject("invalid chunk coordinates");
      return;
    }
    const chunk = sim.worldOf(p.dimension).ensureChunk(cx, cy);
    reply({
      type: "chunk_data",
      dim: p.dimension,
      cx,
      cy,
      tiles: Array.from(chunk.tiles),
      walls: Array.from(chunk.walls),
    });
  },
});

registerCommandHandler("start_mining", {
  handle({ sim, player, command, reject }) {
    const p = sim.getPlayer(player);
    if (!p) {
      reject("not joined");
      return;
    }
    const { x, y } = command;
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      reject("invalid coordinates");
      return;
    }
    if (!sim.withinReach(player, x, y)) {
      reject("out of reach");
      return;
    }
    const world = sim.worldOf(p.dimension);
    const current = world.getBlockGenerating(x, y);
    const held = p.inventory[p.selected];
    const holdsHammer = held ? itemDef(held.item)?.tool?.kind === "hammer" : false;
    // A hammer aimed at open foreground mines the wall behind it.
    if (
      holdsHammer &&
      !blockDef(current).solid &&
      world.getWallGenerating(x, y) !== BlockId.Air
    ) {
      p.mining = { x, y, progress: 0, wall: true };
      return;
    }
    if (current === BlockId.Air || blockDef(current).hardness < 0) {
      reject("cannot mine");
      return;
    }
    p.mining = { x, y, progress: 0 };
  },
});

registerCommandHandler("stop_mining", {
  handle({ sim, player, broadcast, reject }) {
    const p = sim.getPlayer(player);
    if (!p) {
      reject("not joined");
      return;
    }
    if (p.mining) {
      const { x, y } = p.mining;
      p.mining = null;
      broadcast({ type: "mining_progress", player, x, y, progress: 0, total: 0 });
    }
  },
});

registerCommandHandler("place_block", {
  handle({ sim, player, command, out, broadcast, reject }) {
    const p = sim.getPlayer(player);
    if (!p) {
      reject("not joined");
      return;
    }
    const { x, y } = command;
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      reject("invalid coordinates");
      return;
    }
    const world = sim.worldOf(p.dimension);
    const stack = p.inventory[p.selected];
    if (!stack) {
      reject("nothing to place");
      return;
    }
    if (!sim.withinReach(player, x, y)) {
      reject("out of reach");
      return;
    }
    // A multiblock trigger (e.g. flint and steel lighting a portal)
    // takes over instead of placing a block; unhandled falls through
    // to normal placement below.
    const attempt = tryActivateMultiblock(world, x, y, { type: "place_block", item: stack.item }, {
      dimension: p.dimension,
      sim,
      broadcast,
    });
    if (attempt.activated) return;
    if (attempt.attempted) {
      reject(attempt.failReason);
      return;
    }
    const def = itemDef(stack.item);
    if (def?.block === undefined) {
      reject("item not placeable");
      return;
    }
    const consume = (): void => {
      if (!p.creative) {
        stack.count -= 1;
        if (stack.count === 0) p.inventory[p.selected] = null;
      }
      sim.syncInventory(p, out);
    };
    const hasCardinal = (test: (nx: number, ny: number) => boolean): boolean =>
      test(x - 1, y) || test(x + 1, y) || test(x, y - 1) || test(x, y + 1);

    if (command.layer === "bg") {
      // Background walls: the wall slot must be free and at least one
      // cardinal neighbor must already have a wall.
      if (world.getWallGenerating(x, y) !== BlockId.Air) {
        reject("space occupied");
        return;
      }
      if (
        !p.creative &&
        !hasCardinal((nx, ny) => world.getWallGenerating(nx, ny) !== BlockId.Air)
      ) {
        reject("needs an adjacent wall");
        return;
      }
      if (world.setWall(x, y, def.block)) {
        broadcast({ type: "wall_changed", dim: p.dimension, x, y, block: def.block });
        consume();
      }
      return;
    }

    if (world.getBlockGenerating(x, y) !== BlockId.Air) {
      reject("space occupied");
      return;
    }
    // Foreground rule: a cardinal foreground block, or a wall behind
    // the target position.
    if (
      !p.creative &&
      world.getWallGenerating(x, y) === BlockId.Air &&
      !hasCardinal((nx, ny) => world.getBlockGenerating(nx, ny) !== BlockId.Air)
    ) {
      reject("needs support");
      return;
    }
    if (blockDef(def.block).solid && sim.tileIntersectsAnyPlayer(p.dimension, x, y)) {
      reject("blocked by player");
      return;
    }
    // Doors occupy two tiles (placed tile + the one above).
    if (blockDef(def.block).tall) {
      if (world.getBlockGenerating(x, y - 1) !== BlockId.Air) {
        reject("needs headroom");
        return;
      }
      if (blockDef(def.block).solid && sim.tileIntersectsAnyPlayer(p.dimension, x, y - 1)) {
        reject("blocked by player");
        return;
      }
      world.setBlock(x, y, def.block);
      world.setBlock(x, y - 1, def.block);
      broadcast({ type: "block_changed", dim: p.dimension, x, y, block: def.block });
      broadcast({ type: "block_changed", dim: p.dimension, x, y: y - 1, block: def.block });
      consume();
      return;
    }
    if (world.setBlock(x, y, def.block)) {
      broadcast({ type: "block_changed", dim: p.dimension, x, y, block: def.block });
      sim.wakeLiquids(p.dimension, x, y);
      consume();
    }
  },
});

registerCommandHandler("use_block", {
  handle({ sim, player, command, broadcast, reject }) {
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
    const world = sim.worldOf(p.dimension);
    const block = world.getBlockGenerating(x, y);
    const def = blockDef(block);
    if (def.toggleTo === undefined) {
      reject("nothing to use");
      return;
    }
    // Can't close a door/trapdoor onto somebody.
    const target = blockDef(def.toggleTo);
    const tiles: Array<[number, number]> = [[x, y]];
    if (def.tall) {
      for (const dy of [-1, 1]) {
        if (world.getBlockGenerating(x, y + dy) === block) tiles.push([x, y + dy]);
      }
    }
    if (target.solid && tiles.some(([tx, ty]) => sim.tileIntersectsAnyPlayer(p.dimension, tx, ty))) {
      reject("blocked by player");
      return;
    }
    for (const [tx, ty] of tiles) {
      world.setBlock(tx, ty, def.toggleTo);
      broadcast({ type: "block_changed", dim: p.dimension, x: tx, y: ty, block: def.toggleTo });
    }
  },
});

registerCommandHandler("use_bucket", {
  handle({ sim, player, command, out, broadcast, reject }) {
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
    const stack = p.inventory[p.selected];
    const capacity = stack ? itemDef(stack.item)?.bucket : undefined;
    if (!stack || capacity === undefined) {
      reject("no bucket");
      return;
    }
    const world = sim.worldOf(p.dimension);
    const targetDef = blockDef(world.getBlockGenerating(x, y));
    const heldLiquid = stack.data?.liquid;
    const heldAmount = stack.data?.amount ?? 0;

    // Scoop: only full source tiles can be bucketed (matches the
    // liquid model's own source/flowing distinction), and only
    // into an empty bucket or one already carrying the same kind.
    if (
      targetDef.liquid?.level === 8 &&
      (heldLiquid === undefined || heldLiquid === targetDef.liquid.kind) &&
      heldAmount < capacity
    ) {
      world.setBlock(x, y, BlockId.Air);
      broadcast({ type: "block_changed", dim: p.dimension, x, y, block: BlockId.Air });
      sim.wakeLiquids(p.dimension, x, y);
      stack.data = { ...stack.data, liquid: targetDef.liquid.kind, amount: heldAmount + 1 };
      sim.syncInventory(p, out);
      return;
    }

    // Pour: onto open space, or topping up a non-full pool of the
    // same kind - always leaves a full source block, like a real
    // bucket, consuming exactly one charge.
    if (heldLiquid !== undefined && heldAmount > 0) {
      const isOpen = !targetDef.solid && targetDef.liquid === undefined && !targetDef.slab;
      const canPourInto = isOpen || (targetDef.liquid?.kind === heldLiquid && targetDef.liquid.level < 8);
      if (!canPourInto) {
        reject("cannot pour here");
        return;
      }
      const sourceBlock = liquidBlock(heldLiquid, 8);
      world.setBlock(x, y, sourceBlock);
      broadcast({ type: "block_changed", dim: p.dimension, x, y, block: sourceBlock });
      sim.wakeLiquids(p.dimension, x, y);
      // Clay dissolves the moment it pours a bucket-melting liquid -
      // every other tier survives (copper and up don't melt).
      if (!p.creative && stack.item === "flatcraft:item:clay_bucket" && liquidDef(`flatcraft:liquid:${heldLiquid}`)?.meltsBuckets) {
        p.inventory[p.selected] = null;
      } else {
        const remaining = heldAmount - 1;
        stack.data = remaining > 0 ? { ...stack.data, amount: remaining } : undefined;
      }
      sim.syncInventory(p, out);
      return;
    }

    reject("nothing to do");
  },
});
