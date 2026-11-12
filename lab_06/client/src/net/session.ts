import {
  assertNever,
  DT,
  ProtocolError,
  Seq,
  TICK_HZ,
  buttonsSchema,
  decodeSnapshot,
  decodeSnapshotJson,
  encodeInput,
  encodeInputJson,
  parseServerMessage,
} from "@dogfight/shared";
import type {
  BulletSnap,
  Input,
  ServerMessage,
  ShipId,
  ShipSnap,
  Snapshot,
  Tick,
} from "@dogfight/shared";
import { TypedEvents } from "../events.js";
import { SnapshotBuffer } from "./interpolation.js";
import { createNetSim } from "./netsim.js";
import type { NetSim } from "./netsim.js";
import { Predictor } from "./prediction.js";
import { Smoother } from "./smoother.js";
import { ReconnectingSocket } from "./socket.js";
import { NetStats } from "./stats.js";

export type SessionEvents = {
  control: ServerMessage;
  close: { code: number; reason: string };
  reconnecting: { attempt: number; delay: number };
  reconcile: { magnitude: number; tick: Tick };
  fired: { x?: number; y?: number };
  hit: { x: number; y: number };
  exploded: { x: number; y: number };
};

export interface SessionOptions {
  url: string;
  room: { readonly id: string };
  name: string;
  WebSocketImpl?: typeof WebSocket;
  format?: "binary" | "json";
  predict?: boolean;
  lagMs?: number;
  jitterMs?: number;
  lossPct?: number;
  chaos?: number;
  interpDelayMs?: number;
  smoothMs?: number;
  now?: () => number;
  random?: () => number;
  readButtons?: () => number;
}

export interface SceneView {
  readonly ships: readonly ShipSnap[];
  readonly bullets: readonly BulletSnap[];
}

export interface Netgraph {
  rttMs: number;
  snapshotAgeMs: number;
  inBps: number;
  outBps: number;
  queue: number;
  correction: number;
  history: readonly number[];
}

/**
 * One client in one room. DOM-free (so it also runs headless in Node tests/experiments). Everything that arrives from
 * the network is `unknown` until a decoder or a Zod schema has looked at it.
 */
export class GameSession extends TypedEvents<SessionEvents> {
  readonly format: "binary" | "json";
  readonly predict: boolean;
  readonly interpDelayMs: number;
  readonly socket: ReconnectingSocket;
  readonly buffer = new SnapshotBuffer();
  readonly predictor: Predictor;
  readonly stats = new NetStats();
  readonly net: NetSim;
  readonly names = new Map<ShipId, string>();
  slot: ShipId | null = null;
  readonly #now: () => number;
  readonly #readButtons: () => number;
  #seq = 0;
  #sentAt = new Map<number, number>();
  #lastAck = 0;
  #previous: Snapshot | null = null;

  constructor({
    url,
    room,
    name,
    WebSocketImpl,
    format = "binary",
    predict = true,
    lagMs = 0,
    jitterMs = 0,
    lossPct = 0,
    chaos = 0,
    interpDelayMs = 100,
    smoothMs = 100,
    now = () => performance.now(),
    random = Math.random,
    readButtons = () => 0,
  }: SessionOptions) {
    super();
    this.format = format;
    this.predict = predict;
    this.interpDelayMs = interpDelayMs;
    this.#now = now;
    this.#readButtons = readButtons;
    this.net = createNetSim({ lagMs, jitterMs, lossPct, random });
    this.socket = new ReconnectingSocket(url, WebSocketImpl ? { WebSocketImpl } : {});
    this.predictor = new Predictor({
      chaos,
      random,
      smoother: new Smoother({ durationMs: smoothMs }),
    });

    this.socket.on("open", () => this.socket.send({ type: "join", room: room.id, name, format }));
    this.socket.on("frame", (frame) => this.#onFrame(frame));
    this.socket.on("close", (detail) => this.emit("close", detail));
    this.socket.on("reconnecting", (detail) => this.emit("reconnecting", detail));
  }

  connect(): void {
    this.socket.connect();
  }

  close(): void {
    this.socket.close();
  }

  #resetGameState(): void {
    this.#seq = 0;
    this.#sentAt.clear();
    this.#lastAck = 0;
    this.buffer.clear();
    this.predictor.reset();
    this.#previous = null;
  }

  #onFrame({ data, bytes }: { data: string | ArrayBuffer; bytes: number }): void {
    const now = this.#now();
    if (typeof data === "string") {
      let json: unknown;
      try {
        json = JSON.parse(data);
      } catch {
        return; // not JSON: ignore
      }
      if (typeof json === "object" && json !== null && "type" in json && json.type === "snapshot") {
        this.stats.addIn(bytes, now);
        this.net.deliver(() => this.#onSnapshot(() => decodeSnapshotJson(data)));
        return;
      }
      const message = parseServerMessage(json);
      if (message.ok) this.#onControl(message.value);
      return;
    }
    this.stats.addIn(bytes, now);
    this.net.deliver(() => this.#onSnapshot(() => decodeSnapshot(data)));
  }

  #onControl(msg: ServerMessage): void {
    switch (msg.type) {
      case "welcome":
        this.slot = msg.slot;
        this.#resetGameState();
        this.names.clear();
        for (const p of msg.players) this.names.set(p.slot, p.name);
        break;
      case "joined":
        this.names.set(msg.player.slot, msg.player.name);
        break;
      case "left":
      case "chat":
      case "error":
        break;
      default:
        return assertNever(msg);
    }
    this.emit("control", msg);
  }

  #onSnapshot(decode: () => Snapshot): void {
    let snap: Snapshot;
    try {
      snap = decode();
    } catch (err: unknown) {
      if (err instanceof ProtocolError) return; // a bad packet is dropped, it must not crash the client
      throw err;
    }
    const now = this.#now();
    if (!this.buffer.push(snap)) return; // stale (reordered) snapshot
    this.stats.snapshots++;
    this.stats.lastSnapshotAt = now;
    this.#detectEffects(snap);

    const mine = snap.ships.find((s) => s.id === this.slot);
    if (!mine) return;
    for (const [seq, sent] of this.#sentAt) {
      if (seq > mine.lastSeq) break;
      if (seq === mine.lastSeq) this.stats.recordRtt(now - sent);
      this.#sentAt.delete(seq);
    }
    this.#lastAck = mine.lastSeq;
    if (this.predict) {
      const magnitude = this.predictor.reconcile(mine, snap.bullets, now);
      this.stats.recordCorrection(magnitude);
      this.emit("reconcile", { magnitude, tick: snap.tick });
    }
  }

  #detectEffects(snap: Snapshot): void {
    const prev = this.#previous;
    this.#previous = snap;
    if (!prev) return;
    const was = new Map(prev.ships.map((s) => [s.id, s]));
    for (const s of snap.ships) {
      const p = was.get(s.id);
      if (!p) continue;
      if (p.alive && !s.alive) this.emit("exploded", { x: s.x, y: s.y });
      else if (s.hp < p.hp) this.emit("hit", { x: s.x, y: s.y });
    }
    const known = new Set(prev.bullets.map((b) => b.id));
    for (const b of snap.bullets) {
      if (!known.has(b.id) && !(this.predict && b.owner === this.slot))
        this.emit("fired", { x: b.x, y: b.y });
    }
  }

  /** One client tick (30 Hz): read the keys, send an input (not coordinates!), predict locally. */
  step(): void {
    if (this.slot === null) return;
    const now = this.#now();
    const input: Input = {
      seq: Seq.parse(++this.#seq),
      buttons: buttonsSchema.parse(this.#readButtons()),
    };
    this.#sentAt.set(input.seq, now);
    if (this.#sentAt.size > 300) {
      const oldest = this.#sentAt.keys().next();
      if (!oldest.done) this.#sentAt.delete(oldest.value);
    }
    const data = this.format === "json" ? encodeInputJson(input) : encodeInput(input);
    this.stats.addOut(typeof data === "string" ? data.length : data.byteLength, now);
    this.net.deliver(() => this.socket.sendUnreliable(data));
    if (this.predict && this.predictor.step(input)) this.emit("fired", {});
  }

  /** Server tick we are drawing: the newest snapshot's tick (extrapolated by the local clock) minus the delay. */
  renderTick(now: number): number {
    const latest = this.buffer.latest;
    if (!latest) return 0;
    const ahead = Math.min((now - this.stats.lastSnapshotAt) / (1000 / TICK_HZ), 3);
    return latest.tick + ahead - this.interpDelayMs / (1000 * DT);
  }

  /** Everything the renderer needs. Other ships/bullets: in the past, between two snapshots. Ours: now. */
  view(alpha: number, now: number): SceneView {
    const sampled = this.buffer.sample(this.renderTick(now));
    let ships = sampled.ships;
    let bullets = sampled.bullets;
    const me = this.predict && this.predictor.me ? this.predictor.renderShip(alpha, now) : null;
    if (me) {
      ships = ships.filter((s) => s.id !== this.slot);
      if (me.alive) ships = [...ships, me];
      bullets = [
        ...bullets.filter((b) => b.owner !== this.slot),
        ...this.predictor.renderBullets(alpha),
      ];
    }
    return { ships, bullets };
  }

  netgraph(now: number): Netgraph {
    const { inBps, outBps } = this.stats.rates(now);
    return {
      rttMs: this.stats.rttMs,
      snapshotAgeMs: this.stats.lastSnapshotAt ? now - this.stats.lastSnapshotAt : 0,
      inBps,
      outBps,
      queue: this.predict ? this.predictor.pending.length : Math.max(0, this.#seq - this.#lastAck),
      correction: this.stats.correction,
      history: this.stats.correctionHistory,
    };
  }

  /** The latest snapshot, for the scoreboard. */
  get latest(): Snapshot | null {
    return this.buffer.latest;
  }
}
