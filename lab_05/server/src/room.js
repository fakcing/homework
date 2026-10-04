import { EventEmitter } from "node:events";

/**
 * A room knows nothing about sockets: players are {id, name, send(message, {critical})}.
 * Events: "join", "leave", "chat", "empty", and "error" (a failing send). An "error" event without
 * a listener THROWS from emit() and takes the whole process down, so the registry always listens.
 */
export class Room extends EventEmitter {
  #players = new Map();

  constructor({ id, name, max, arena, seed }) {
    super();
    Object.assign(this, { id, name, max, arena, seed });
  }

  get size() {
    return this.#players.size;
  }

  get full() {
    return this.size >= this.max;
  }

  players() {
    return [...this.#players.values()].map(({ id, name, slot }) => ({ id, name, slot }));
  }

  /** Smallest free slot (0..max-1); the slot is the ship id inside the game. */
  freeSlot() {
    const used = new Set([...this.#players.values()].map((p) => p.slot));
    for (let i = 0; i < this.max; i++) if (!used.has(i)) return i;
    return -1;
  }

  *[Symbol.iterator]() {
    yield* this.#players.values();
  }

  add(player) {
    if (this.full || this.#players.has(player.id)) return false;
    this.#players.set(player.id, player);
    this.emit("join", { player });
    return true;
  }

  remove(id) {
    const player = this.#players.get(id);
    if (!player) return false;
    this.#players.delete(id);
    this.emit("leave", { player });
    if (this.size === 0) this.emit("empty", this);
    return true;
  }

  broadcast(message, { except = null, critical = false } = {}) {
    for (const player of this.#players.values()) {
      if (player.id === except) continue;
      try {
        player.send(message, { critical });
      } catch (error) {
        this.emit("error", error);
      }
    }
  }

  chat(player, text) {
    const ts = Date.now();
    this.broadcast({ type: "chat", from: player.id, name: player.name, text, ts });
    this.emit("chat", { player, text, ts });
  }
}
