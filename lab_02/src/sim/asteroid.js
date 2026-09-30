import { Entity } from "./entity.js";

export const ASTEROID_TYPES = Object.freeze({
  large: { radius: 42, hp: 3, points: 50 },
  small: { radius: 20, hp: 1, points: 100 },
});

export class Asteroid extends Entity {
  #hp;

  constructor({ pos, vel, size = "large", spin = 0, behaviors = [] }) {
    const spec = ASTEROID_TYPES[size];
    if (!spec) throw new RangeError(`Asteroid: unknown size "${size}"`);
    super({ kind: "asteroid", pos, vel, radius: spec.radius, behaviors });
    this.#hp = spec.hp;
    this.size = size;
    this.points = spec.points;
    this.spin = spin;
  }

  get hp() {
    return this.#hp;
  }

  takeDamage(amount, source = null) {
    if (!this.alive) return false;
    this.#hp -= amount;
    if (this.#hp <= 0) {
      this.kill();
      this.world?.emit("asteroidDestroyed", { asteroid: this, source });
    }
    return true;
  }

  update(dt, world) {
    this.angle += this.spin * dt;
    super.update(dt, world);
  }

  onCollide(other, world) {
    super.onCollide(other, world);
    if (other.kind !== "ship" || !this.alive) return;
    other.takeDamage(1, this);
    this.takeDamage(this.#hp, null); // ramming destroys the asteroid, but gives no score
  }
}
