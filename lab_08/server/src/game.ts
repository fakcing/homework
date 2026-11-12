import {
  TICK_HZ,
  addShip,
  assertNever,
  createWorld,
  encodeSnapshot,
  encodeSnapshotJson,
  removeShip,
  snapshotOf,
  stepWorld,
} from "@dogfight/shared";
import { performance } from "node:perf_hooks";
import type { Input, ShipId, World } from "@dogfight/shared";
import type { Logger } from "./logger.js";
import { Room } from "./room.js";
import type { RoomOptions } from "./room.js";
import { createTicker } from "./ticker.js";
import type { TickerOptions } from "./ticker.js";

const BACKLOG = 5; // more queued inputs than this = the client is far behind: keep only the newest 3
const KEEP = 3;
const MAX_QUEUE = 64;

interface PlayerQueue {
  readonly queue: Input[];
  lastIn: number;
}

/** Authoritative game of one room: input queues -> stepWorld at 30 Hz -> snapshots to everybody. */
export class RoomGame {
  readonly world: World;
  readonly stats = { droppedInputs: 0, stalls: 0, lastStepMs: 0, ticks: 0 };
  readonly #queues = new Map<ShipId, PlayerQueue>();
  readonly #ticker;

  constructor(
    private readonly room: Room,
    private readonly logger: Logger,
    ticker: Partial<TickerOptions> = {},
  ) {
    this.world = createWorld(room.seed);
    this.#ticker = createTicker({ hz: TICK_HZ, onTick: () => this.tick(), ...ticker });
  }

  get tickerStats() {
    return this.#ticker.stats;
  }

  addPlayer(slot: ShipId): void {
    addShip(this.world, slot);
    this.#queues.set(slot, { queue: [], lastIn: 0 });
    this.#ticker.start();
  }

  removePlayer(slot: ShipId): void {
    removeShip(this.world, slot);
    this.#queues.delete(slot);
  }

  stop(): void {
    this.#ticker.stop();
  }

  /** Inputs are accepted in increasing seq order only: duplicates and stale packets are ignored. */
  pushInput(slot: ShipId, input: Input): boolean {
    const q = this.#queues.get(slot);
    if (!q || input.seq <= q.lastIn) return false;
    q.lastIn = input.seq;
    q.queue.push(input);
    if (q.queue.length > MAX_QUEUE) q.queue.shift();
    return true;
  }

  tick(): void {
    const started = performance.now();
    const inputs = new Map<ShipId, Input>();
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
      this.stats.lastStepMs = performance.now() - started;
      this.stats.ticks++;
    } catch (err: unknown) {
      this.logger.error("stepWorld failed", {
        room: this.room.id,
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    for (const event of this.world.events) {
      switch (event.type) {
        case "kill":
          this.room.emit("game", event);
          break;
        case "fire":
        case "hit":
        case "respawn":
          break;
        default:
          assertNever(event); // a new GameEvent without a case here is a compile error
      }
    }
    this.#broadcast();
  }

  #broadcast(): void {
    const snapshot = snapshotOf(this.world);
    let binary: ArrayBuffer | null = null;
    let json: string | null = null;
    for (const player of this.room) {
      player.sendSnapshot(
        player.format === "json"
          ? (json ??= encodeSnapshotJson(snapshot))
          : (binary ??= encodeSnapshot(snapshot)),
      );
    }
  }
}

/** A room that has a running game. Plain `Room` stays socket- and game-agnostic (and easy to unit-test). */
export class GameRoom extends Room {
  readonly game: RoomGame;

  constructor(options: RoomOptions, logger: Logger, ticker?: Partial<TickerOptions>) {
    super(options);
    this.game = new RoomGame(this, logger, ticker);
  }
}
