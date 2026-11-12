import type { ClientMessageInput } from "@dogfight/shared";
import { TypedEvents } from "../events.js";

/** Close codes after which retrying is pointless: the server rejected us on purpose. */
const FINAL_CODES: ReadonlySet<number> = new Set([1008, 1009, 4001, 4002, 4003, 4004]);

export type SocketEvents = {
  open: null;
  /** A raw frame: text (JSON) or binary. Parsing is the caller's job: the network gives us nothing but bytes. */
  frame: { data: string | ArrayBuffer; bytes: number };
  close: { code: number; reason: string };
  reconnecting: { attempt: number; delay: number };
};

export interface SocketOptions {
  WebSocketImpl?: typeof WebSocket;
  baseMs?: number;
  maxMs?: number;
  random?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  maxQueue?: number;
}

/** WebSocket wrapper: send() queues while offline, reconnect uses exponential backoff with jitter. */
export class ReconnectingSocket extends TypedEvents<SocketEvents> {
  readonly #url: string;
  readonly #Impl: typeof WebSocket;
  readonly #baseMs: number;
  readonly #maxMs: number;
  readonly #random: () => number;
  readonly #schedule: (fn: () => void, ms: number) => unknown;
  readonly #maxQueue: number;
  #ws: WebSocket | null = null;
  #open = false;
  #queue: string[] = [];
  #attempt = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #closedByUser = false;

  constructor(
    url: string,
    {
      WebSocketImpl = globalThis.WebSocket,
      baseMs = 500,
      maxMs = 10000,
      random = Math.random,
      schedule = (fn, ms) => setTimeout(fn, ms),
      maxQueue = 50,
    }: SocketOptions = {},
  ) {
    super();
    this.#url = url;
    this.#Impl = WebSocketImpl;
    this.#baseMs = baseMs;
    this.#maxMs = maxMs;
    this.#random = random;
    this.#schedule = schedule;
    this.#maxQueue = maxQueue;
  }

  get isOpen(): boolean {
    return this.#open;
  }

  connect(): void {
    this.#closedByUser = false;
    this.#dial();
  }

  /** Sends now if connected, otherwise queues (oldest dropped past `maxQueue`). Only well-formed client messages compile. */
  send(message: ClientMessageInput): boolean {
    const data = JSON.stringify(message);
    if (this.#open && this.#ws) {
      this.#ws.send(data);
      return true;
    }
    if (this.#queue.length >= this.#maxQueue) this.#queue.shift();
    this.#queue.push(data);
    return false;
  }

  /** Fire-and-forget (game inputs): sent only if connected right now, never queued, never replayed. */
  sendUnreliable(data: string | ArrayBuffer): boolean {
    if (!this.#open || !this.#ws) return false;
    this.#ws.send(data);
    return true;
  }

  close(): void {
    this.#closedByUser = true;
    clearTimeout(this.#timer);
    this.#queue.length = 0;
    this.#ws?.close(1000);
  }

  #flush(): void {
    const ws = this.#ws;
    while (this.#open && ws) {
      const next = this.#queue.shift();
      if (next === undefined) break;
      ws.send(next);
    }
  }

  #dial(): void {
    let ws: WebSocket;
    try {
      ws = new this.#Impl(this.#url);
    } catch {
      return this.#scheduleReconnect();
    }
    this.#ws = ws;
    ws.binaryType = "arraybuffer";
    ws.addEventListener("open", () => {
      if (ws !== this.#ws) return;
      this.#open = true;
      this.#attempt = 0;
      this.emit("open", null); // listeners may send() right now (e.g. `join`): it goes out before the queue
      this.#flush();
    });
    ws.addEventListener("message", (e) => {
      const data: unknown = e.data;
      if (typeof data === "string") this.emit("frame", { data, bytes: data.length });
      else if (data instanceof ArrayBuffer) this.emit("frame", { data, bytes: data.byteLength });
    });
    ws.addEventListener("close", (e) => {
      if (ws !== this.#ws) return;
      this.#open = false;
      this.emit("close", { code: e.code, reason: e.reason });
      if (!this.#closedByUser && !FINAL_CODES.has(e.code)) this.#scheduleReconnect();
    });
    ws.addEventListener("error", () => {}); // "close" always follows; the reconnect logic lives there
  }

  #scheduleReconnect(): void {
    const ceiling = Math.min(this.#maxMs, this.#baseMs * 2 ** this.#attempt);
    const delay = ceiling * (0.5 + this.#random() / 2); // 50–100% of the ceiling
    this.#attempt++;
    this.emit("reconnecting", { attempt: this.#attempt, delay });
    this.#schedule(() => this.#dial(), delay);
  }
}
