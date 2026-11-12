import { TypedEvents } from "../events.js";
import type { CreateRoom, FetchRooms, RoomInfo } from "./api.js";

const NAME_RE = /^[\p{L}\p{N} _-]{1,16}$/u;

export type LobbyStatus = "idle" | "loading" | "ready" | "error";
export type LobbyEvents = {
  status: { status: LobbyStatus; error: unknown };
  rooms: { rooms: readonly RoomInfo[] };
  join: { name: string; room: RoomInfo };
};
export type JoinResult = { ok: true } | { ok: false; reason: string };

export interface LobbyOptions {
  fetchRooms: FetchRooms;
  createRoom?: CreateRoom | null;
  intervalMs?: number;
  timeoutMs?: number;
}

/**
 * Lobby model (no DOM). Polls `fetchRooms({signal})` while started; every request has its own AbortController +
 * AbortSignal.timeout; stop()/refresh() abort the request that is in flight.
 */
export class Lobby extends TypedEvents<LobbyEvents> {
  readonly #fetchRooms: FetchRooms;
  readonly #createRoom: CreateRoom | null;
  readonly #intervalMs: number;
  readonly #timeoutMs: number;
  #controller: AbortController | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #running = false;

  rooms: readonly RoomInfo[] = [];
  status: LobbyStatus = "idle";
  error: unknown = null;
  selectedId: string | null = null;

  constructor({
    fetchRooms,
    createRoom = null,
    intervalMs = 3000,
    timeoutMs = 3000,
  }: LobbyOptions) {
    super();
    this.#fetchRooms = fetchRooms;
    this.#createRoom = createRoom;
    this.#intervalMs = intervalMs;
    this.#timeoutMs = timeoutMs;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    void this.#tick();
  }

  stop(): void {
    this.#running = false;
    clearTimeout(this.#timer);
    this.#controller?.abort();
    this.#controller = null;
  }

  refresh(): void {
    if (!this.#running) return;
    clearTimeout(this.#timer);
    void this.#tick();
  }

  /** POST a new room, then refresh the list. */
  async create(name: string): Promise<RoomInfo> {
    if (!this.#createRoom) throw new Error("Creating rooms is not supported");
    const room = await this.#createRoom({ name });
    this.refresh();
    return room;
  }

  select(id: string): boolean {
    const room = this.rooms.find((r) => r.id === id);
    if (!room || room.players >= room.max) return false;
    this.selectedId = id;
    this.emit("rooms", { rooms: this.rooms });
    return true;
  }

  join(rawName: string): JoinResult {
    const name = rawName.trim();
    if (!NAME_RE.test(name))
      return { ok: false, reason: "Name: 1–16 letters, digits, space, _ or -" };
    const room = this.rooms.find((r) => r.id === this.selectedId);
    if (!room) return { ok: false, reason: "Pick a room first" };
    if (room.players >= room.max) return { ok: false, reason: "That room is full" };
    this.emit("join", { name, room });
    return { ok: true };
  }

  #setStatus(status: LobbyStatus, error: unknown = null): void {
    this.status = status;
    this.error = error;
    this.emit("status", { status, error });
  }

  async #tick(): Promise<void> {
    this.#controller?.abort();
    const controller = new AbortController();
    this.#controller = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(this.#timeoutMs)]);
    if (this.status !== "ready") this.#setStatus("loading");
    try {
      const rooms = await this.#fetchRooms({ signal });
      if (controller.signal.aborted) return; // superseded or stopped: drop the stale answer
      this.rooms = rooms;
      if (!rooms.some((r) => r.id === this.selectedId && r.players < r.max)) this.selectedId = null;
      this.#setStatus("ready");
      this.emit("rooms", { rooms });
    } catch (error: unknown) {
      if (controller.signal.aborted) return; // we aborted it ourselves: not a failure
      this.#setStatus("error", error);
    } finally {
      if (this.#running && this.#controller === controller) {
        this.#timer = setTimeout(() => void this.#tick(), this.#intervalMs);
      }
    }
  }
}
