import type { ItemStack } from "./inventory.js";
import { itemDef } from "./items.js";

/**
 * Villager trades, defined in JSON (src/data/trades/villager.json):
 * a flat list of { cost, result } item stacks. Emeralds are the
 * currency by convention, but any item works.
 */
export interface TradeJson {
  trades: Array<{ cost: { item: string; count: number }; result: { item: string; count: number } }>;
}

export interface Trade {
  cost: ItemStack;
  result: ItemStack;
}

const NAMESPACE = "flatcraft:";

function parseItem(raw: { item: string; count: number }, index: number): ItemStack {
  const id = raw.item.startsWith(NAMESPACE) ? raw.item.slice(NAMESPACE.length) : raw.item;
  if (!itemDef(id)) {
    throw new Error(`trade ${index}: unknown item "${raw.item}"`);
  }
  return { item: id, count: raw.count };
}

export function parseTrades(json: TradeJson): Trade[] {
  return json.trades.map((t, i) => ({
    cost: parseItem(t.cost, i),
    result: parseItem(t.result, i),
  }));
}
