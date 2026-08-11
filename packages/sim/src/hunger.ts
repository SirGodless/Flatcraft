/**
 * Hunger, Minecraft-flavored: a 0..20 food bar that activity slowly
 * drains. Passive health regeneration only runs while the bar is nearly
 * full; an empty bar starves the player down to 1 HP (never kills, like
 * normal difficulty). Eating food restores points.
 *
 * Activity is tracked as "exhaustion" units per tick; every
 * EXHAUSTION_PER_POINT units cost one hunger point.
 */
export const PLAYER_MAX_HUNGER = 20;

/** Exhaustion units that drain one hunger point. */
export const EXHAUSTION_PER_POINT = 320;
/** Per tick of walking. */
export const EXHAUST_WALK = 1;
/** Per tick of mining. */
export const EXHAUST_MINE = 2;
/** Per jump. */
export const EXHAUST_JUMP = 10;
/** Per passively regenerated HP (regeneration makes you hungry). */
export const EXHAUST_REGEN = 40;

/** Passive regeneration requires at least this much hunger. */
export const HUNGER_REGEN_MIN = 18;
/** Starving: 1 damage per this many ticks while the bar is empty... */
export const STARVE_INTERVAL_TICKS = 80;
/** ...but never below this health. */
export const STARVE_MIN_HEALTH = 1;
