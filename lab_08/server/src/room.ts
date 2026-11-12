import { EventEmitter } from "node:events";
import { ShipId } from "@dogfight/shared";
import type { GameEvent, ServerMessage } from "@dogfight/shared";

export interface Player {
  readonly id: string;
  readonly slot: ShipId;
  readonly name: string;
  readonly format: "binary" | "json";
  send(message: ServerMessage, options?: { critical?: boolean }): void;
  sendSnapshot(data: string | ArrayBuffer): void;
}

export interface RoomOptions {
  readonly id: string;
  readonly name: string;
  readonly max: number;
  readonly arena: { readonly width: number; readonly height: number };
  readonly seed: number;
}

/** Every event the room emits and the arguments of its listeners. `room.on("jion", …)` is a compile error. */
export interface RoomEvents {
  join: [{ player: Player }];
  leave: [{ player: Player }];
  chat: [{ player: Player; text: string; ts: number }];
  game: [GameEvent];
  empty: [Room];
  error: [Error]; // emit("error") with no listener THROWS and kills the process: the registry always listens
}

/** A room knows nothing about sockets: players are objects with send/sendSnapshot. */
export class Room extends EventEmitter<RoomEvents> {
  readonly id: string;
  readonly name: string;
  readonly max: number;
  readonly arena: RoomOptions["arena"];
  readonly seed: number;
  readonly #players = new Map<string, Player>();

  constructor({ id, name, max, arena, seed }: RoomOptions) {
    super();
    this.id = id;
    this.name = name;
    this.max = max;
    this.arena = arena;
    this.seed = seed;
  }

  get size(): number {
    return this.#players.size;
  }

  get full(): boolean {
    return this.size >= this.max;
  }

  players(): { id: string; name: string; slot: ShipId }[] {
    return [...this.#players.values()].map(({ id, name, slot }) => ({ id, name, slot }));
  }

  /** Smallest free slot (0..max-1); the slot is the ship id inside the game. */
  freeSlot(): ShipId | null {
    const used = new Set([...this.#players.values()].map((p) => p.slot));
    for (let i = 0; i < this.max; i++) {
      const slot = ShipId.safeParse(i);
      if (slot.success && !used.has(slot.data)) return slot.data;
    }
    return null;
  }

  *[Symbol.iterator](): Generator<Player> {
    yield* this.#players.values();
  }

  add(player: Player): boolean {
    if (this.full || this.#players.has(player.id)) return false;
    this.#players.set(player.id, player);
    this.emit("join", { player });
    return true;
  }

  remove(id: string): boolean {
    const player = this.#players.get(id);
    if (!player) return false;
    this.#players.delete(id);
    this.emit("leave", { player });
    if (this.size === 0) this.emit("empty", this);
    return true;
  }

  broadcast(
    message: ServerMessage,
    { except = null, critical = false }: { except?: string | null; critical?: boolean } = {},
  ): void {
    for (const player of this.#players.values()) {
      if (player.id === except) continue;
      try {
        player.send(message, { critical });
      } catch (error: unknown) {
        this.emit("error", error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  chat(player: Player, text: string): void {
    const ts = Date.now();
    this.broadcast({ type: "chat", from: player.id, name: player.name, text, ts });
    this.emit("chat", { player, text, ts });
  }
}
