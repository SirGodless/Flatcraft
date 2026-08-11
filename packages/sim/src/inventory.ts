import { itemDef } from "./items.js";

/**
 * Inventory data: a plain array of nullable stacks, Minecraft-shaped -
 * 36 slots, the first 9 of which are the hotbar. Kept as serializable
 * data with free functions so it can travel over the wire as-is.
 */
export const INVENTORY_SIZE = 36;
export const HOTBAR_SIZE = 9;

export interface ItemStack {
  item: string;
  count: number;
  /** Nested inventory for container items (backpacks). */
  data?: { slots: (ItemStack | null)[] };
}

export type InventorySlots = (ItemStack | null)[];

export function createInventory(): InventorySlots {
  return new Array<ItemStack | null>(INVENTORY_SIZE).fill(null);
}

/**
 * Add items, filling existing stacks first, then empty slots.
 * Returns the count that did not fit.
 */
export function addToInventory(slots: InventorySlots, item: string, count: number): number {
  const maxStack = itemDef(item)?.maxStack ?? 64;
  let remaining = count;
  for (let i = 0; i < slots.length && remaining > 0; i++) {
    const stack = slots[i];
    if (stack && stack.item === item && stack.count < maxStack) {
      const take = Math.min(maxStack - stack.count, remaining);
      stack.count += take;
      remaining -= take;
    }
  }
  for (let i = 0; i < slots.length && remaining > 0; i++) {
    if (!slots[i]) {
      const take = Math.min(maxStack, remaining);
      slots[i] = { item, count: take };
      remaining -= take;
    }
  }
  return remaining;
}

export function countInInventory(slots: InventorySlots, item: string): number {
  let total = 0;
  for (const stack of slots) {
    if (stack?.item === item) total += stack.count;
  }
  return total;
}

/**
 * Remove exactly `count` of an item. All-or-nothing: returns false and
 * changes nothing if the inventory holds less than that.
 */
export function removeFromInventory(slots: InventorySlots, item: string, count: number): boolean {
  if (countInInventory(slots, item) < count) return false;
  let remaining = count;
  for (let i = 0; i < slots.length && remaining > 0; i++) {
    const stack = slots[i];
    if (!stack || stack.item !== item) continue;
    const take = Math.min(stack.count, remaining);
    stack.count -= take;
    remaining -= take;
    if (stack.count === 0) slots[i] = null;
  }
  return true;
}

export function cloneInventory(slots: InventorySlots): InventorySlots {
  return slots.map((stack) => (stack ? structuredClone(stack) : null));
}
