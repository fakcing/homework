import {
  TICK_HZ,
  addShip,
  createWorld,
  encodeSnapshot,
  encodeSnapshotJson,
  removeShip,
  snapshotOf,
  stepWorld,
} from "@dogfight/shared";
import { createTicker } from "./ticker.js";

const BACKLOG = 5; // more queued inputs than this = the client is far behind: keep only the newest 3
const KEEP = 3;
const MAX_QUEUE = 64;

/** Authoritative game of one room: input queues -> stepWorld at 30 Hz -> snapshots to everybody. */
export class RoomGame {
  #queues = new Map();
  #ticker;

  constructor({ room, logger, ticker = {} }) {
    this.room = room;
    this.logger = logger;
    this.world = createWorld(room.seed);
    this.stats = { droppedInputs: 0, stalls: 0 };
    this.#ticker = createTicker({ hz: TICK_HZ, onTick: () => this.tick(), ...ticker });
  }

  get tickerStats() {
    return this.#ticker.stats;
  }

  addPlayer(slot) {
    addShip(this.world, slot);
    this.#queues.set(slot, { queue: [], lastIn: 0 });
    this.#ticker.start();
  }

  removePlayer(slot) {
    removeShip(this.world, slot);
    this.#queues.delete(slot);
  }

  stop() {
    this.#ticker.stop();
  }

  /** Inputs are accepted in increasing seq order only: duplicates and stale packets are ignored. */
  pushInput(slot, input) {
    const q = this.#queues.get(slot);
    if (!q || input.seq <= q.lastIn) return false;
    q.lastIn = input.seq;
    q.queue.push(input);
    if (q.queue.length > MAX_QUEUE) q.queue.shift();
    return true;
  }

  tick() {
    const inputs = new Map();
    for (const [slot, q] of this.#queues) {
      if (q.queue.length > BACKLOG) {
        this.stats.droppedInputs += q.queue.length - KEEP;
        q.queue.splice(0, q.queue.length - KEEP);
      }
      const input = q.queue.shift();
      if (input) inputs.set(slot, input);
      else this.stats.stalls++;
    }
    try {
      stepWorld(this.world, inputs);
    } catch (err) {
      this.logger.error("stepWorld failed", { room: this.room.id, message: err.message });
      return;
    }
    for (const e of this.world.events) if (e.type === "kill") this.room.emit("game", e);
    this.#broadcast();
  }

  #broadcast() {
    const snapshot = snapshotOf(this.world);
    let binary = null;
    let json = null;
    for (const player of this.room) {
      player.sendSnapshot(
        player.format === "json"
          ? (json ??= encodeSnapshotJson(snapshot))
          : (binary ??= encodeSnapshot(snapshot)),
      );
    }
  }
}
