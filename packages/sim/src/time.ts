/**
 * Day/night cycle, Minecraft-scaled: 24000 ticks per day (20 minutes).
 * Day 0-12000, dusk until 13000, night until 23000, dawn until 24000.
 */
export const DAY_LENGTH = 24000;
export const NIGHT_START = 13000;

/** 1 in full daylight, 0 at night, linear ramps at dusk and dawn. */
export function daylightFactor(time: number): number {
  const t = ((time % DAY_LENGTH) + DAY_LENGTH) % DAY_LENGTH;
  if (t < 12000) return 1;
  if (t < 13000) return 1 - (t - 12000) / 1000;
  if (t < 23000) return 0;
  return (t - 23000) / 1000;
}

export function isNight(time: number): boolean {
  return daylightFactor(time) < 0.5;
}
