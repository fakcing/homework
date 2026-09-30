import { shortestAngleDelta, shortestDelta, wrapCoord } from "../math.js";

/**
 * Blends the previous and current simulation state by alpha in [0, 1).
 * Position uses the shortest path across wrap-around edges; the heading uses the shortest arc.
 */
export function interpolateShip(prev, curr, alpha, arena) {
  return {
    ...curr,
    x: wrapCoord(prev.x + shortestDelta(prev.x, curr.x, arena.width) * alpha, arena.width),
    y: wrapCoord(prev.y + shortestDelta(prev.y, curr.y, arena.height) * alpha, arena.height),
    angle: prev.angle + shortestAngleDelta(prev.angle, curr.angle) * alpha,
  };
}
