/**
 * Seeded PRNG (mulberry32). The simulation must never use Math.random():
 * every random decision has to be reproducible from the world seed so that
 * server and clients (and replays) stay in sync.
 */
export type Rng = () => number;

/** Serializable RNG state, so simulations survive save/load exactly. */
export interface RngState {
  s: number;
}

export function rngNext(state: RngState): number {
  state.s = (state.s + 0x6d2b79f5) >>> 0;
  let t = state.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function createRng(seed: number): Rng {
  const state: RngState = { s: seed >>> 0 };
  return () => rngNext(state);
}

/**
 * Derive a stable sub-seed, e.g. per chunk: hashSeed(worldSeed, cx, cy).
 * Murmur3-style mixing with a final avalanche - small input differences
 * (neighboring coordinates) must flip about half the output bits, or
 * noise built on this hash develops visible bias.
 */
export function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    let k = p >>> 0;
    k = Math.imul(k, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
