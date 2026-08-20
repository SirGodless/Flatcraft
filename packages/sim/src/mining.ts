import type { ItemStack } from "./inventory.js";
import { enchantBonus } from "./enchants.js";
import { itemDef, type ToolDef } from "./items.js";
import { blockDef, BlockId } from "./world/block.js";

/**
 * Mining rules, Minecraft-style:
 * - the matching tool divides the block's base time by its speed
 * - a block with a tier requirement mined without a good enough matching
 *   tool takes a heavy time penalty AND drops nothing
 * - anything else takes the base time and drops normally
 */

export const WRONG_TOOL_PENALTY = 3.3;

function heldTool(held: ItemStack | null): ToolDef | undefined {
  return held ? itemDef(held.item)?.tool : undefined;
}

/** Whether breaking this block with this item yields its drops. */
export function canHarvest(block: BlockId, held: ItemStack | null): boolean {
  const def = blockDef(block);
  const required = def.requiredTier ?? 0;
  if (required === 0) return true;
  const tool = heldTool(held);
  return tool !== undefined && tool.kind === def.tool && tool.tier >= required;
}

/** How many ticks mining this block takes with this item. */
export function miningTicks(block: BlockId, held: ItemStack | null): number {
  const def = blockDef(block);
  if (def.hardness < 0) return Infinity;
  if (!canHarvest(block, held)) {
    return Math.max(1, Math.ceil(def.hardness * WRONG_TOOL_PENALTY));
  }
  const tool = heldTool(held);
  if (tool !== undefined && tool.kind === def.tool) {
    const efficiency = 1 + enchantBonus(held, "mining_speed");
    return Math.max(1, Math.ceil(def.hardness / (tool.speed * efficiency)));
  }
  return Math.max(1, def.hardness);
}
