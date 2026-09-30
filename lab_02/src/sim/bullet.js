import { lifetime } from "./behaviors.js";
import { Entity } from "./entity.js";

export class Bullet extends Entity {
  constructor({ pos, vel, ownerId, damage = 1, ttl = 1.2, behaviors = [] }) {
    super({
      kind: "bullet",
      pos,
      vel,
      radius: 3,
      angle: vel.angle,
      behaviors: [lifetime(ttl), ...behaviors],
    });
    this.ownerId = ownerId;
    this.damage = damage;
  }

  onCollide(other, world) {
    super.onCollide(other, world);
    if (!this.alive || other.id === this.ownerId) return;
    if (typeof other.takeDamage !== "function") return; // pickups and particles are not hit
    other.takeDamage(this.damage, this);
    this.kill();
  }
}
