import { shortestDelta, wrapCoord } from "../math.js";
import { Vector2 } from "./vector2.js";

export const ARENA = Object.freeze({ width: 1280, height: 720 });

export const wrapVec = (v, arena = ARENA) =>
  new Vector2(wrapCoord(v.x, arena.width), wrapCoord(v.y, arena.height));

/** Shortest vector from `from` to `to` on the wrapping arena (used by collisions and homing). */
export const wrappedDelta = (from, to, arena = ARENA) =>
  new Vector2(shortestDelta(from.x, to.x, arena.width), shortestDelta(from.y, to.y, arena.height));
