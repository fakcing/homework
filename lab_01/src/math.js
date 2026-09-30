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
