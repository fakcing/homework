import { wrapVec } from "./arena.js";
import { Vector2 } from "./vector2.js";

/**
 * Base class for everything in the world. Optional capabilities (homing, pickup, lifetime ...)
 * are NOT subclasses: they are `behaviors` — small objects with optional update/onCollide hooks.
 */
export class Entity {
  static #nextId = 1; // private counter: ids cannot be forged or reset from outside
  #id;

  world = null;
  alive = true;

  constructor({
    kind,
    pos,
    vel = Vector2.ZERO,
    radius,
    angle = 0,
    collidable = true,
    tag = null,
    behaviors = [],
  }) {
    if (!kind) throw new TypeError("Entity: `kind` is required");
    if (!(pos instanceof Vector2)) throw new TypeError("Entity: `pos` must be a Vector2");
    if (!(radius > 0)) throw new RangeError("Entity: `radius` must be > 0");
    this.#id = Entity.#nextId++;
    this.kind = kind;
    this.pos = pos;
    this.prevPos = pos;
    this.vel = vel;
    this.radius = radius;
    this.angle = angle;
    this.prevAngle = angle;
    this.collidable = collidable;
    this.tag = tag;
    this.behaviors = behaviors;
  }

  get id() {
    return this.#id;
  }

  /** Marks the entity dead; World removes it in the sweep at the end of the step. */
  kill() {
    this.alive = false;
  }

  /** Called by World before update so the renderer can interpolate prev -> current. */
  savePrevious() {
    this.prevPos = this.pos;
    this.prevAngle = this.angle;
  }

  behavior(name) {
    return this.behaviors.find((b) => b.name === name);
  }

  update(dt, world) {
    for (const b of this.behaviors) b.update?.(this, dt, world);
    this.pos = wrapVec(this.pos.add(this.vel.scale(dt)), world.arena);
  }

  onCollide(other, world) {
    for (const b of this.behaviors) b.onCollide?.(this, other, world);
  }
}
