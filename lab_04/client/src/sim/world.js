import { createRng } from "../math.js";
import { findCollisions } from "../systems/collisions.js";
import { ARENA, wrappedDelta } from "./arena.js";
import { Entity } from "./entity.js";

/** Entity store (Map<id, Entity>) + fixed-step update: update all -> collisions -> sweep the dead. */
export class World {
  #entities = new Map();

  constructor({ arena = ARENA, seed = 1 } = {}) {
    this.arena = arena;
    this.rng = createRng(seed);
    this.time = 0;
    /** Event bus: the sim dispatches CustomEvents, audio/HUD subscribe. The sim imports neither. */
    this.events = new EventTarget();
  }

  spawn(entity) {
    if (!(entity instanceof Entity)) throw new TypeError("World.spawn: expected an Entity");
    if (this.#entities.has(entity.id))
      throw new Error(`World.spawn: id ${entity.id} already exists`);
    entity.world = this;
    this.#entities.set(entity.id, entity);
    return entity;
  }

  /** Only marks the entity dead; it disappears in the sweep at the end of step(). */
  despawn(id) {
    this.#entities.get(id)?.kill();
  }

  get(id) {
    const entity = this.#entities.get(id);
    return entity?.alive ? entity : undefined;
  }

  *[Symbol.iterator]() {
    for (const entity of this.#entities.values()) if (entity.alive) yield entity;
  }

  *ofKind(kind) {
    for (const entity of this) if (entity.kind === kind) yield entity;
  }

  count(kind) {
    let n = 0;
    for (const entity of this) if (!kind || entity.kind === kind) n++;
    return n;
  }

  delta(a, b) {
    return wrappedDelta(a.pos, b.pos, this.arena);
  }

  /** Subscribes to a world event; the listener receives `detail`. Returns an unsubscribe function. */
  on(type, listener, options) {
    const handler = (e) => listener(e.detail);
    this.events.addEventListener(type, handler, options);
    return () => this.events.removeEventListener(type, handler);
  }

  emit(type, detail) {
    this.events.dispatchEvent(new CustomEvent(type, { detail }));
  }

  step(dt) {
    const snapshot = [...this]; // entities spawned during the step first update next step
    for (const e of snapshot) e.savePrevious();
    for (const e of snapshot) if (e.alive) e.update(dt, this);

    for (const [a, b] of findCollisions([...this], this.arena)) {
      if (!a.alive || !b.alive) continue; // one of them died earlier in this step
      a.onCollide(b, this);
      if (!a.alive || !b.alive) continue;
      b.onCollide(a, this);
    }

    for (const [id, e] of this.#entities) {
      if (e.alive) continue;
      e.world = null;
      this.#entities.delete(id);
    }
    this.time += dt;
  }

  /** Stable text snapshot (no ids) — used to compare runs for determinism. */
  snapshot() {
    return [...this].map((e) => `${e.kind}:${e.pos.x.toFixed(6)},${e.pos.y.toFixed(6)}`);
  }
}
