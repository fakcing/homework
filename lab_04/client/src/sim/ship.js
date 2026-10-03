import { Bullet } from "./bullet.js";
import { homing } from "./behaviors.js";
import { Entity } from "./entity.js";
import { Vector2 } from "./vector2.js";

export const SHIP = Object.freeze({
  radius: 14,
  turnRate: 3.6, // rad/s
  thrust: 420, // units/s^2
  drag: 0.8, // 1/s
  maxSpeed: 600,
  maxHp: 3,
  fireCooldown: 0.22,
  bulletSpeed: 700,
  spawnInvuln: 2,
  hitInvuln: 1,
});

const LEFT = ["ArrowLeft", "KeyA"];
const RIGHT = ["ArrowRight", "KeyD"];
const FORWARD = ["ArrowUp", "KeyW"];
const anyDown = (input, codes) => codes.some((c) => input.isDown(c));

export class Ship extends Entity {
  #hp = SHIP.maxHp;
  #input;
  #cooldown = 0;
  #invuln;
  #homingLeft = 0;

  constructor({ pos, input, invulnerable = SHIP.spawnInvuln }) {
    super({ kind: "ship", pos, radius: SHIP.radius, angle: -Math.PI / 2 });
    this.#input = input;
    this.#invuln = invulnerable;
    this.thrusting = false;
  }

  get hp() {
    return this.#hp; // read-only from outside: there is no setter
  }

  get invulnerable() {
    return this.#invuln > 0;
  }

  get homingLeft() {
    return this.#homingLeft;
  }

  takeDamage(amount, source = null) {
    if (!this.alive || this.#invuln > 0) return false;
    this.#hp = Math.max(0, this.#hp - amount);
    this.#invuln = SHIP.hitInvuln;
    if (this.#hp === 0) {
      this.kill();
      this.world?.emit("shipDestroyed", { ship: this, source });
    }
    return true;
  }

  heal(amount = 1) {
    if (this.#hp >= SHIP.maxHp) return false;
    this.#hp = Math.min(SHIP.maxHp, this.#hp + amount);
    return true;
  }

  grantHoming(seconds) {
    this.#homingLeft = Math.max(this.#homingLeft, seconds);
    return true;
  }

  /** Uses `this` (world, angle, pos ...): it must be called as `ship.fire()`, see README. */
  fire() {
    if (!this.alive || !this.world || this.#cooldown > 0) return false;
    const dir = Vector2.fromAngle(this.angle);
    const behaviors =
      this.#homingLeft > 0 ? [homing({ targetKinds: ["asteroid"], turnRate: 4, range: 520 })] : [];
    this.world.spawn(
      new Bullet({
        pos: this.pos.add(dir.scale(this.radius + 4)), // nose of the ship
        vel: this.vel.add(dir.scale(SHIP.bulletSpeed)),
        ownerId: this.id,
        behaviors,
      }),
    );
    this.#cooldown = SHIP.fireCooldown;
    this.world.emit("fired", { ship: this });
    return true;
  }

  update(dt, world) {
    this.#cooldown = Math.max(0, this.#cooldown - dt);
    this.#invuln = Math.max(0, this.#invuln - dt);
    this.#homingLeft = Math.max(0, this.#homingLeft - dt);

    const turn = Number(anyDown(this.#input, RIGHT)) - Number(anyDown(this.#input, LEFT));
    this.angle += turn * SHIP.turnRate * dt;
    this.thrusting = anyDown(this.#input, FORWARD);

    let vel = this.vel;
    if (this.thrusting) vel = vel.add(Vector2.fromAngle(this.angle, SHIP.thrust * dt));
    this.vel = vel.scale(Math.exp(-SHIP.drag * dt)).clampLength(SHIP.maxSpeed);

    if (this.#input.isDown("Space")) this.fire();
    super.update(dt, world);
  }
}
