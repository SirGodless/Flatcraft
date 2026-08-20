import type { ItemStack } from "./inventory.js";
import { itemDef } from "./items.js";
import { registerContentType, validateContentInstance } from "./registry/generic.js";

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

const ITEM_STACK_FIELDS = {
  item: { kind: "ref", ref_type: "item", required: true },
  count: { kind: "number", min: 1, max: 64, required: true },
};

registerContentType(
  {
    id: "trade_list",
    fields: {
      trades: {
        kind: "array",
        required: true,
        items: {
          kind: "object",
          fields: {
            cost: { kind: "object", required: true, fields: ITEM_STACK_FIELDS },
            result: { kind: "object", required: true, fields: ITEM_STACK_FIELDS },
          },
        },
      },
    },
  },
  "engine/types/trade_list",
);

function toItemStack(raw: { item: string; count: number }, index: number, field: "cost" | "result"): ItemStack {
  // ref fields are syntax-checked only (see registry/generic.ts) - actual
  // existence still needs an explicit check, same as every other ref
  // consumer (vein.ts's host block, etc.) until Stage 6's deferred
  // cross-reference pass lands.
  if (!itemDef(raw.item)) {
    throw new Error(`trade ${index} (${field}): unknown item "${raw.item}"`);
  }
  return { item: raw.item, count: raw.count };
}

export function parseTrades(json: TradeJson): Trade[] {
  const validated = validateContentInstance("trade_list", json, "trades") as {
    trades: Array<{ cost: { item: string; count: number }; result: { item: string; count: number } }>;
  };
  return validated.trades.map((t, i) => ({
    cost: toItemStack(t.cost, i, "cost"),
    result: toItemStack(t.result, i, "result"),
  }));
}
