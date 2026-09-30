import { clamp, shortestAngleDelta } from "../math.js";
import { Vector2 } from "./vector2.js";

/** Kills the entity after `seconds` of simulation time. */
export function lifetime(seconds) {
  let left = seconds;
  return {
    name: "lifetime",
    get fraction() {
      return Math.max(0, left / seconds);
    },
    update(entity, dt) {
      left -= dt;
      if (left <= 0) entity.kill();
    },
  };
}

/** Steers the entity's velocity toward the nearest target of the given kinds, keeping its speed. */
export function homing({ targetKinds, turnRate = 3, range = 600 }) {
  return {
    name: "homing",
    update(entity, dt, world) {
      const speed = entity.vel.length;
      if (speed === 0) return;
      let best = null;
      let bestSq = range * range;
      for (const kind of targetKinds) {
        for (const target of world.ofKind(kind)) {
          const d = world.delta(entity, target);
          if (d.lengthSq < bestSq) {
            bestSq = d.lengthSq;
            best = d;
          }
        }
      }
      if (!best) return;
      const heading = entity.vel.angle;
      const maxTurn = turnRate * dt;
      const turn = clamp(shortestAngleDelta(heading, best.angle), -maxTurn, maxTurn);
      entity.vel = Vector2.fromAngle(heading + turn, speed);
    },
  };
}

/** Gives `effect(ship)` to a ship that touches the entity; consumed unless the effect returns false. */
export function pickup(effect) {
  return {
    name: "pickup",
    onCollide(entity, other, world) {
      if (!entity.alive || other.kind !== "ship") return;
      if (effect(other, world) === false) return;
      entity.kill();
      world.emit("pickupTaken", { pickup: entity, ship: other });
    },
  };
}
