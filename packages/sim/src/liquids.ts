/**
 * Per-liquid-kind tuning: swim physics, whether a bucket dissolves when
 * filled with it, and the client bucket-icon tint - all previously
 * hardcoded as `kind === "lava"` ternaries in simulation.ts/commands/
 * blocks.ts/the client's ui.ts. Registered by id, same small-registry
 * pattern as veins/woods/enchants.
 *
 * Deliberately NOT a claim that a mod can add a third liquid kind
 * outright: BlockDef.liquid.kind and the 8 fill-level block variants
 * per kind (see world/block.ts's liquidBlock) are still only wired up
 * for "water"/"lava" - that's a bigger, separate undertaking (new block
 * ids per level, flow-simulation changes) nothing here actually
 * requires. This registry only takes the *tuning* for those two kinds
 * out of engine code and into data.
 */

import { registerContentType, validateContentInstance } from "./registry/generic.js";

export interface LiquidJson {
  id: string;
  /** Horizontal speed multiplier while swimming. */
  swim_speed: number;
  /** Added to vertical speed each tick while swimming (gentle sink). */
  sink_accel: number;
  /** Clamps how fast that sinking gets. */
  sink_cap: number;
  /** Vertical speed while holding jump (negative = up). */
  swim_up_velocity: number;
  /** Buckets below a certain tier dissolve instead of filling (clay in
   * lava). */
  melts_buckets?: boolean;
  /** CSS hex color for the client's filled-bucket icon tint. */
  tint?: string;
}

export interface LiquidDef {
  id: string;
  swimSpeed: number;
  sinkAccel: number;
  sinkCap: number;
  swimUpVelocity: number;
  meltsBuckets: boolean;
  tint?: string;
}

registerContentType(
  {
    id: "liquid",
    fields: {
      id: { kind: "qualified_id", required: true },
      swim_speed: { kind: "number", min: -1000, max: 1000, required: true },
      sink_accel: { kind: "number", min: -1000, max: 1000, required: true },
      sink_cap: { kind: "number", min: -1000, max: 1000, required: true },
      swim_up_velocity: { kind: "number", min: -1000, max: 1000, required: true },
      melts_buckets: { kind: "boolean" },
      tint: { kind: "string" },
    },
  },
  "engine/types/liquid",
);

/** Validation now runs through the generic content-type engine (see
 * enchants.ts for the first migration and its rationale) - this used to
 * do no validation at all beyond field access, so a malformed liquid
 * JSON (e.g. a string where a number belongs) previously produced silent
 * NaNs at runtime instead of failing loudly at boot. */
export function parseLiquid(id: string, json: LiquidJson): LiquidDef {
  const v = validateContentInstance("liquid", json, `liquid "${id}"`);
  return {
    id,
    swimSpeed: v["swim_speed"] as number,
    sinkAccel: v["sink_accel"] as number,
    sinkCap: v["sink_cap"] as number,
    swimUpVelocity: v["swim_up_velocity"] as number,
    meltsBuckets: v["melts_buckets"] === true,
    ...(v["tint"] !== undefined ? { tint: v["tint"] as string } : {}),
  };
}

const DEFS = new Map<string, LiquidDef>();

export function registerLiquid(def: LiquidDef): void {
  if (DEFS.has(def.id)) {
    throw new Error(`liquid "${def.id}" is already registered`);
  }
  DEFS.set(def.id, def);
}

export function liquidDef(id: string): LiquidDef | undefined {
  return DEFS.get(id);
}

export function allLiquids(): Iterable<LiquidDef> {
  return DEFS.values();
}
