import { EventEmitter } from "node:events";
import { randomInt, randomUUID } from "node:crypto";
import path from "node:path";
import { MatchLog } from "./matchlog.js";
import { Room } from "./room.js";

/** Owns the rooms (Map<id, Room>), deletes a room when it empties and writes one match log per room. */
export class RoomRegistry extends EventEmitter {
  #rooms = new Map();
  #logs = new Set();

  constructor({ logDir, maxRooms, defaultMax, logger }) {
    super();
    Object.assign(this, { logDir, maxRooms, defaultMax, logger });
  }

  get size() {
    return this.#rooms.size;
  }

  get(id) {
    return this.#rooms.get(id);
  }

  list() {
    return [...this.#rooms.values()];
  }

  create({ name, max = this.defaultMax }) {
    if (this.#rooms.size >= this.maxRooms) throw new RangeError("room limit reached");
    const room = new Room({
      id: randomUUID().slice(0, 8),
      name,
      max,
      arena: { width: 1280, height: 720 },
      seed: randomInt(1, 2 ** 31),
    });
    let log = null; // the file is created lazily, on the first event
    const write = (event) => {
      if (!log) {
        log = new MatchLog(path.join(this.logDir, `match-${room.id}-${Date.now()}.ndjson`), {
          onError: (err) =>
            this.logger.error("match log failed", { room: room.id, message: err.message }),
        });
        this.#logs.add(log);
        log.write({ type: "room", id: room.id, name: room.name });
      }
      log.write(event);
    };

    room.on("error", (err) =>
      this.logger.error("room error", { room: room.id, message: err.message }),
    );
    room.on("join", ({ player }) => write({ type: "join", id: player.id, name: player.name }));
    room.on("leave", ({ player }) => write({ type: "leave", id: player.id }));
    room.on("chat", ({ player, text }) => write({ type: "chat", id: player.id, text }));
    room.on("empty", () => {
      this.#rooms.delete(room.id);
      if (log) log.end().then(() => this.#logs.delete(log));
      this.emit("removed", room);
    });

    this.#rooms.set(room.id, room);
    return room;
  }

  /** Ends every open match log and waits until the files are on disk. */
  flush() {
    return Promise.all([...this.#logs].map((log) => log.end()));
  }
}
