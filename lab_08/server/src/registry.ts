import { EventEmitter } from "node:events";
import { randomInt, randomUUID } from "node:crypto";
import path from "node:path";
import { ARENA } from "@dogfight/shared";
import { GameRoom } from "./game.js";
import type { Logger } from "./logger.js";
import { MatchLog } from "./matchlog.js";
import type { MatchEvent } from "./matchlog.js";
import type { Room } from "./room.js";

export interface RegistryOptions {
  readonly logDir: string;
  readonly maxRooms: number;
  readonly defaultMax: number;
  readonly logger: Logger;
}

/** Owns the rooms (Map<id, Room>), deletes a room when it empties and writes one match log per room. */
export class RoomRegistry extends EventEmitter<{ removed: [Room] }> {
  readonly #rooms = new Map<string, GameRoom>();
  readonly #logs = new Set<MatchLog>();
  readonly logDir: string;
  readonly maxRooms: number;
  readonly defaultMax: number;
  readonly logger: Logger;

  constructor({ logDir, maxRooms, defaultMax, logger }: RegistryOptions) {
    super();
    this.logDir = logDir;
    this.maxRooms = maxRooms;
    this.defaultMax = defaultMax;
    this.logger = logger;
  }

  get size(): number {
    return this.#rooms.size;
  }

  get(id: string): GameRoom | undefined {
    return this.#rooms.get(id);
  }

  list(): GameRoom[] {
    return [...this.#rooms.values()];
  }

  create({ name, max = this.defaultMax }: { name: string; max?: number }): GameRoom {
    if (this.#rooms.size >= this.maxRooms) throw new RangeError("room limit reached");
    const room = new GameRoom(
      { id: randomUUID().slice(0, 8), name, max, arena: ARENA, seed: randomInt(1, 2 ** 31) },
      this.logger,
    );
    let log: MatchLog | null = null; // the file is created lazily, on the first event
    const write = (event: MatchEvent): void => {
      if (!log) {
        const created = new MatchLog(
          path.join(this.logDir, `match-${room.id}-${Date.now()}.ndjson`),
          {
            onError: (err) =>
              this.logger.error("match log failed", { room: room.id, message: err.message }),
          },
        );
        this.#logs.add(created);
        created.write({ type: "room", id: room.id, name: room.name });
        log = created;
      }
      log.write(event);
    };

    room.on("error", (err) =>
      this.logger.error("room error", { room: room.id, message: err.message }),
    );
    room.on("join", ({ player }) => {
      room.game.addPlayer(player.slot);
      write({ type: "join", id: player.id, name: player.name, slot: player.slot });
    });
    room.on("leave", ({ player }) => {
      room.game.removePlayer(player.slot);
      write({ type: "leave", id: player.id });
    });
    room.on("game", (event) => write(event));
    room.on("chat", ({ player, text }) => write({ type: "chat", id: player.id, text }));
    room.on("empty", () => {
      room.game.stop();
      this.#rooms.delete(room.id);
      const finished = log;
      if (finished) void finished.end().then(() => this.#logs.delete(finished));
      this.emit("removed", room);
    });

    this.#rooms.set(room.id, room);
    return room;
  }

  /** Stops every game, ends every open match log and waits until the files are on disk. */
  flush(): Promise<void[]> {
    for (const room of this.#rooms.values()) room.game.stop();
    return Promise.all([...this.#logs].map((log) => log.end()));
  }
}
