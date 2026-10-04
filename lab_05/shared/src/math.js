export const TAU = Math.PI * 2;
export const wrapCoord = (v, max) => ((v % max) + max) % max;
export const wrapAngle = (a) => wrapCoord(a + Math.PI, TAU) - Math.PI;

/** Signed shortest distance on a wrapping axis. */
export function shortestDelta(from, to, max) {
  const d = wrapCoord(to - from, max);
  return d > max / 2 ? d - max : d;
}
export const shortestAngleDelta = (from, to) => wrapAngle(to - from);
export const lerp = (a, b, t) => a + (b - a) * t;
