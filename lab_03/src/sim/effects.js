import { TAU } from "../math.js";
import { lifetime, pickup } from "./behaviors.js";
import { Entity } from "./entity.js";
import { Vector2 } from "./vector2.js";

export function createParticle(pos, vel, life) {
  return new Entity({
    kind: "particle",
    pos,
    vel,
    radius: 2,
    collidable: false,
    behaviors: [lifetime(life)],
  });
}

export function spawnExplosion(world, pos, { count = 14, speed = 160, life = 0.7 } = {}) {
  world.emit("exploded", { pos, size: count > 20 ? "large" : "small" });
  for (let i = 0; i < count; i++) {
    const vel = Vector2.fromAngle(world.rng() * TAU, speed * (0.3 + 0.7 * world.rng()));
    world.spawn(createParticle(pos, vel, life * (0.5 + 0.5 * world.rng())));
  }
}

export const PICKUP_EFFECTS = Object.freeze({
  repair: (ship) => ship.heal(1),
  homing: (ship) => ship.grantHoming(8),
});

/** A pickup is a plain Entity + behaviors: it stands still, collides, is not a ship. */
export function createPickup(pos, type) {
  const effect = PICKUP_EFFECTS[type];
  if (!effect) throw new RangeError(`createPickup: unknown type "${type}"`);
  return new Entity({
    kind: "pickup",
    pos,
    radius: 16,
    tag: type,
    behaviors: [pickup(effect), lifetime(15)],
  });
}
