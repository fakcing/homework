export const TAU = Math.PI * 2;

export const lerp = (a, b, t) => a + (b - a) * t;

/** Modulo that always returns a value in [0, max). */
export const wrapCoord = (v, max) => ((v % max) + max) % max;

/** Signed shortest distance from `from` to `to` on a wrapping axis of length `max`. */
export function shortestDelta(from, to, max) {
  const d = wrapCoord(to - from, max);
  return d > max / 2 ? d - max : d;
}

/** Signed shortest rotation from angle `from` to `to`, in (-PI, PI]. */
export const shortestAngleDelta = (from, to) => wrapCoord(to - from + Math.PI, TAU) - Math.PI;

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Seeded PRNG (mulberry32): the simulation never touches Math.random, so runs are reproducible. */
export function createRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
