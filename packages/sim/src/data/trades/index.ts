import { parseTrades, type Trade } from "../../trading.js";

import villager from "./villager.json";

/** To add trades: edit villager.json (cost/result item stacks). */
export const TRADES: readonly Trade[] = parseTrades(villager);
