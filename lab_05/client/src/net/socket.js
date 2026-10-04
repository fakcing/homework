/** Close codes after which retrying is pointless: the server rejected us on purpose. */
const FINAL_CODES = new Set([1008, 1009, 4001, 4002, 4003, 4004]);

/**
 * WebSocket wrapper: send() queues while offline, reconnect uses exponential backoff with jitter.
 * Events: "open", "message" (detail = parsed JSON), "close" {code, reason}, "reconnecting" {attempt, delay}.
 */
export class ReconnectingSocket extends EventTarget {
  #url;
  #Impl;
  #baseMs;
  #maxMs;
  #random;
  #schedule;
  #maxQueue;
  #ws = null;
  #open = false;
  #queue = [];
  #attempt = 0;
  #timer = 0;
  #closedByUser = false;

  constructor(
    url,
    {
      WebSocketImpl = globalThis.WebSocket,
      baseMs = 500,
      maxMs = 10000,
      random = Math.random,
      schedule = (fn, ms) => setTimeout(fn, ms),
      maxQueue = 50,
    } = {},
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

  get isOpen() {
    return this.#open;
  }

  connect() {
    this.#closedByUser = false;
    this.#dial();
  }

  /** Sends now if connected, otherwise queues (oldest dropped past `maxQueue`). */
  send(message) {
    const data = JSON.stringify(message);
    if (this.#open) {
      this.#ws.send(data);
      return true;
    }
    if (this.#queue.length >= this.#maxQueue) this.#queue.shift();
    this.#queue.push(data);
    return false;
  }

  /** Fire-and-forget (game inputs): sent only if connected right now, never queued, never replayed. */
  sendUnreliable(data) {
    if (!this.#open) return false;
    this.#ws.send(data);
    return true;
  }

  close() {
    this.#closedByUser = true;
    clearTimeout(this.#timer);
    this.#queue.length = 0;
    this.#ws?.close(1000);
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  #flush() {
    while (this.#open && this.#queue.length) this.#ws.send(this.#queue.shift());
  }

  #dial() {
    let ws;
    try {
      ws = new this.#Impl(this.#url);
    } catch {
      return this.#scheduleReconnect();
    }
    this.#ws = ws;
    ws.addEventListener("open", () => {
      if (ws !== this.#ws) return;
      this.#open = true;
      this.#attempt = 0;
      this.#emit("open"); // listeners may send() right now (e.g. `join`): it goes out before the queue
      this.#flush();
    });
    ws.binaryType = "arraybuffer";
    ws.addEventListener("message", (e) => {
      const bytes = typeof e.data === "string" ? e.data.length : e.data.byteLength;
      this.#emit("frame", { data: e.data, bytes }); // raw frame: text (JSON) or ArrayBuffer (binary)
      if (typeof e.data !== "string") return;
      try {
        this.#emit("message", JSON.parse(e.data));
      } catch {
        /* ignore text frames that are not JSON */
      }
    });
    ws.addEventListener("close", (e) => {
      if (ws !== this.#ws) return;
      this.#open = false;
      this.#emit("close", { code: e.code, reason: e.reason });
      if (!this.#closedByUser && !FINAL_CODES.has(e.code)) this.#scheduleReconnect();
    });
    ws.addEventListener("error", () => {}); // "close" always follows; the reconnect logic lives there
  }

  #scheduleReconnect() {
    const ceiling = Math.min(this.#maxMs, this.#baseMs * 2 ** this.#attempt);
    const delay = ceiling * (0.5 + this.#random() / 2); // 50–100% of the ceiling
    this.#attempt++;
    this.#emit("reconnecting", { attempt: this.#attempt, delay });
    this.#timer = this.#schedule(() => this.#dial(), delay);
  }
}
