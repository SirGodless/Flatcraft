import { hashSeed } from "./rng.js";

/**
 * Coherent noise built on the seeded hash: every value is a pure function
 * of (seed, coordinates), so terrain queries are order-independent - any
 * chunk can be generated first and columns always agree across chunks.
 */

export function hash01(...parts: number[]): number {
  return hashSeed(...parts) / 0xffffffff;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** 1D value noise in [0, 1], continuous in x. */
export function valueNoise1(seed: number, x: number, period: number): number {
  const i = Math.floor(x / period);
  const t = smoothstep01((x - i * period) / period);
  return lerp(hash01(seed, period, i), hash01(seed, period, i + 1), t);
}

/** 2D value noise in [0, 1], continuous in x and y. */
export function valueNoise2(seed: number, x: number, y: number, period: number): number {
  const ix = Math.floor(x / period);
  const iy = Math.floor(y / period);
  const tx = smoothstep01((x - ix * period) / period);
  const ty = smoothstep01((y - iy * period) / period);
  const a = hash01(seed, ix, iy);
  const b = hash01(seed, ix + 1, iy);
  const c = hash01(seed, ix, iy + 1);
  const d = hash01(seed, ix + 1, iy + 1);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

/** Fractal (multi-octave) 2D value noise, normalized to [0, 1]. */
export function fbm2(seed: number, x: number, y: number, period: number, octaves: number): number {
  let sum = 0;
  let total = 0;
  let amp = 1;
  let p = period;
  let s = seed;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise2(s, x, y, p) * amp;
    total += amp;
    amp *= 0.5;
    p = Math.max(1, p / 2);
    s = hashSeed(s, o + 1);
  }
  return sum / total;
}
