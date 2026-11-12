import { ARENA } from "./constants.js";
import type { Vec2 } from "./types.js";

export const TAU = Math.PI * 2;
export const wrapCoord = (v: number, max: number): number => ((v % max) + max) % max;
export const wrapAngle = (a: number): number => wrapCoord(a + Math.PI, TAU) - Math.PI;

/** Signed shortest distance on a wrapping axis. */
export function shortestDelta(from: number, to: number, max: number): number {
  const d = wrapCoord(to - from, max);
  return d > max / 2 ? d - max : d;
}
export const shortestAngleDelta = (from: number, to: number): number => wrapAngle(to - from);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Shortest vector from `a` to `b` on the wrapping arena. */
export const wrappedDelta = (a: Vec2, b: Vec2): Vec2 => ({
  x: shortestDelta(a.x, b.x, ARENA.width),
  y: shortestDelta(a.y, b.y, ARENA.height),
});
