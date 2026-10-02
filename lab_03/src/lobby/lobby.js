const NAME_RE = /^[\p{L}\p{N} _-]{1,16}$/u;
const emit = (target, type, detail) => target.dispatchEvent(new CustomEvent(type, { detail }));

/**
 * Lobby model (no DOM). Polls `fetchRooms({signal})` while started; every request has its own
 * AbortController + AbortSignal.timeout; stop()/refresh() abort the request that is in flight.
 * Events: "status" {status, error}, "rooms" {rooms}, "join" {name, room}.
 */
export class Lobby extends EventTarget {
  #fetchRooms;
  #intervalMs;
  #timeoutMs;
  #controller = null;
  #timer = 0;
  #running = false;

  rooms = [];
  status = "idle"; // idle | loading | ready | error
  error = null;
  selectedId = null;

  constructor({ fetchRooms, intervalMs = 3000, timeoutMs = 3000 }) {
    super();
    this.#fetchRooms = fetchRooms;
    this.#intervalMs = intervalMs;
    this.#timeoutMs = timeoutMs;
  }

  start() {
    if (this.#running) return;
    this.#running = true;
    this.#tick();
  }

  stop() {
    this.#running = false;
    clearTimeout(this.#timer);
    this.#controller?.abort();
    this.#controller = null;
  }

  refresh() {
    if (!this.#running) return;
    clearTimeout(this.#timer);
    this.#tick();
  }

  select(id) {
    const room = this.rooms.find((r) => r.id === id);
    if (!room || room.players >= room.max) return false;
    this.selectedId = id;
    emit(this, "rooms", { rooms: this.rooms });
    return true;
  }

  join(rawName) {
    const name = String(rawName).trim();
    if (!NAME_RE.test(name))
      return { ok: false, reason: "Name: 1–16 letters, digits, space, _ or -" };
    const room = this.rooms.find((r) => r.id === this.selectedId);
    if (!room) return { ok: false, reason: "Pick a room first" };
    if (room.players >= room.max) return { ok: false, reason: "That room is full" };
    emit(this, "join", { name, room });
    return { ok: true };
  }

  #setStatus(status, error = null) {
    this.status = status;
    this.error = error;
    emit(this, "status", { status, error });
  }

  async #tick() {
    this.#controller?.abort();
    const controller = (this.#controller = new AbortController());
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(this.#timeoutMs)]);
    if (this.status !== "ready") this.#setStatus("loading");
    try {
      const rooms = await this.#fetchRooms({ signal });
      if (controller.signal.aborted) return; // superseded or stopped: drop the stale answer
      this.rooms = rooms;
      if (!rooms.some((r) => r.id === this.selectedId && r.players < r.max)) this.selectedId = null;
      this.#setStatus("ready");
      emit(this, "rooms", { rooms });
    } catch (error) {
      if (controller.signal.aborted) return; // we aborted it ourselves: not a failure
      this.#setStatus("error", error);
    } finally {
      if (this.#running && this.#controller === controller) {
        this.#timer = setTimeout(() => this.#tick(), this.#intervalMs);
      }
    }
  }
}
