import type { ItemStack } from "./inventory.js";
import { itemDef } from "./items.js";

/**
 * Minecraft-style cursor/slot click mechanics, as a pure function:
 * - left click: pick up all / place all / merge / swap
 * - right click: pick up half / place one
 * Returns the new (cursor, slot) pair.
 */
export function clickStack(
  cursor: ItemStack | null,
  slot: ItemStack | null,
  button: "left" | "right",
): { cursor: ItemStack | null; slot: ItemStack | null } {
  if (button === "left") {
    if (!cursor) {
      return { cursor: slot, slot: null };
    }
    if (!slot) {
      return { cursor: null, slot: cursor };
    }
    if (slot.item === cursor.item) {
      const maxStack = itemDef(slot.item)?.maxStack ?? 64;
      const moved = Math.min(cursor.count, maxStack - slot.count);
      if (moved <= 0) return { cursor, slot };
      const remaining = cursor.count - moved;
      return {
        cursor: remaining > 0 ? { item: cursor.item, count: remaining } : null,
        slot: { item: slot.item, count: slot.count + moved },
      };
    }
    return { cursor: slot, slot: cursor };
  }

  // Right click
  if (!cursor) {
    if (!slot) return { cursor: null, slot: null };
    const take = Math.ceil(slot.count / 2);
    const rest = slot.count - take;
    return {
      cursor: { item: slot.item, count: take },
      slot: rest > 0 ? { item: slot.item, count: rest } : null,
    };
  }
  if (!slot) {
    const rest = cursor.count - 1;
    return {
      cursor: rest > 0 ? { item: cursor.item, count: rest } : null,
      slot: { item: cursor.item, count: 1 },
    };
  }
  if (slot.item === cursor.item) {
    const maxStack = itemDef(slot.item)?.maxStack ?? 64;
    if (slot.count >= maxStack) return { cursor, slot };
    const rest = cursor.count - 1;
    return {
      cursor: rest > 0 ? { item: cursor.item, count: rest } : null,
      slot: { item: slot.item, count: slot.count + 1 },
    };
  }
  return { cursor: slot, slot: cursor };
}
