/**
 * Seeded PRNG (mulberry32). The simulation must never use Math.random():
 * every random decision has to be reproducible from the world seed so that
 * server and clients (and replays) stay in sync.
 */
export type Rng = () => number;

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derive a stable sub-seed, e.g. per chunk: hashSeed(worldSeed, cx, cy). */
export function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h ^= p >>> 0;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
