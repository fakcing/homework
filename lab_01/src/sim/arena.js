import { wrapCoord } from "../math.js";

export const ARENA = Object.freeze({ width: 1280, height: 720 });

/** Returns a new ship wrapped around the arena edges. */
export function wrapShip(ship, arena = ARENA) {
  return { ...ship, x: wrapCoord(ship.x, arena.width), y: wrapCoord(ship.y, arena.height) };
}
