import { wrappedDelta } from "../sim/arena.js";

/** Circle-circle detection, naive O(n^2), wrap-around aware. Returns the overlapping pairs. */
export function findCollisions(entities, arena) {
  const candidates = entities.filter((e) => e.alive && e.collidable);
  const pairs = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      const reach = a.radius + b.radius;
      if (wrappedDelta(a.pos, b.pos, arena).lengthSq <= reach * reach) pairs.push([a, b]);
    }
  }
  return pairs;
}
