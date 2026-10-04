import {
  DT,
  ProtocolError,
  TICK_HZ,
  decodeSnapshot,
  decodeSnapshotJson,
  encodeInput,
  encodeInputJson,
} from "@dogfight/shared";
import { SnapshotBuffer } from "./interpolation.js";
import { createNetSim } from "./netsim.js";
import { Predictor } from "./prediction.js";
import { Smoother } from "./smoother.js";
import { NetStats } from "./stats.js";
import { ReconnectingSocket } from "./socket.js";

/**
 * One client in one room. DOM-free (so it also runs headless in Node tests/experiments).
 * Events: "control" (JSON messages: welcome/joined/left/chat/error), "close", "reconcile",
 * and the sound/effects events "fired" / "hit" / "exploded".
 */
export class GameSession extends EventTarget {
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
  }) {
    super();
    Object.assign(this, { room, name, format, predict, interpDelayMs, now, readButtons });
    this.net = createNetSim({ lagMs, jitterMs, lossPct, random });
    this.socket = new ReconnectingSocket(url, { WebSocketImpl });
    this.buffer = new SnapshotBuffer();
    this.predictor = new Predictor({
      chaos,
      random,
      smoother: new Smoother({ durationMs: smoothMs }),
    });
    this.stats = new NetStats();
    this.names = new Map();
    this.slot = null;
    this.#resetGameState();

    this.socket.addEventListener("open", () =>
      this.socket.send({ type: "join", room: room.id, name, format }),
    );
    this.socket.addEventListener("frame", ({ detail }) => this.#onFrame(detail));
    this.socket.addEventListener("close", ({ detail }) =>
      this.dispatchEvent(new CustomEvent("close", { detail })),
    );
    this.socket.addEventListener("reconnecting", ({ detail }) =>
      this.dispatchEvent(new CustomEvent("reconnecting", { detail })),
    );
  }

  #resetGameState() {
    this.seq = 0;
    this.sentAt = new Map();
    this.lastAck = 0;
    this.buffer.clear();
    this.predictor.reset();
    this.previous = null;
  }

  connect() {
    this.socket.connect();
  }

  close() {
    this.socket.close();
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  #onFrame({ data, bytes }) {
    const now = this.now();
    if (typeof data === "string") {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (msg.type !== "snapshot") return this.#onControl(msg);
      this.stats.addIn(bytes, now);
      return this.net.deliver(() => this.#onSnapshot(() => decodeSnapshotJson(data)));
    }
    this.stats.addIn(bytes, now);
    this.net.deliver(() => this.#onSnapshot(() => decodeSnapshot(data)));
  }

  #onControl(msg) {
    if (msg.type === "welcome") {
      this.slot = msg.slot;
      this.#resetGameState();
      this.names.clear();
      msg.players.forEach((p) => this.names.set(p.slot, p.name));
    } else if (msg.type === "joined") this.names.set(msg.player.slot, msg.player.name);
    this.#emit("control", msg);
  }

  #onSnapshot(decode) {
    let snap;
    try {
      snap = decode();
    } catch (err) {
      if (err instanceof ProtocolError) return;
      throw err;
    }
    const now = this.now();
    if (!this.buffer.push(snap)) return; // stale (reordered) snapshot
    this.stats.snapshots++;
    this.stats.lastSnapshotAt = now;
    this.#detectEffects(snap);

    const mine = snap.ships.find((s) => s.id === this.slot);
    if (!mine) return;
    for (const [seq, sent] of this.sentAt) {
      if (seq > mine.lastSeq) break;
      if (seq === mine.lastSeq) this.stats.recordRtt(now - sent);
      this.sentAt.delete(seq);
    }
    this.lastAck = mine.lastSeq;
    if (this.predict) {
      const magnitude = this.predictor.reconcile(mine, snap.bullets, now);
      this.stats.recordCorrection(magnitude);
      this.#emit("reconcile", { magnitude, tick: snap.tick });
    }
  }

  #detectEffects(snap) {
    const prev = this.previous;
    this.previous = snap;
    if (!prev) return;
    const was = new Map(prev.ships.map((s) => [s.id, s]));
    for (const s of snap.ships) {
      const p = was.get(s.id);
      if (!p) continue;
      if (p.alive && !s.alive) this.#emit("exploded", { x: s.x, y: s.y });
      else if (s.hp < p.hp) this.#emit("hit", { x: s.x, y: s.y });
    }
    const known = new Set(prev.bullets.map((b) => b.id));
    for (const b of snap.bullets) {
      if (!known.has(b.id) && !(this.predict && b.owner === this.slot))
        this.#emit("fired", { x: b.x, y: b.y });
    }
  }

  /** One client tick (30 Hz): read the keys, send an input (not coordinates!), predict locally. */
  step() {
    if (this.slot === null) return;
    const now = this.now();
    const input = { seq: ++this.seq, buttons: this.readButtons() };
    this.sentAt.set(input.seq, now);
    if (this.sentAt.size > 300) this.sentAt.delete(this.sentAt.keys().next().value);
    const data = this.format === "json" ? encodeInputJson(input) : encodeInput(input);
    this.stats.addOut(typeof data === "string" ? data.length : data.byteLength, now);
    this.net.deliver(() => this.socket.sendUnreliable(data));
    if (this.predict && this.predictor.step(input)) this.#emit("fired", {});
  }

  /** Server tick we are drawing: the newest snapshot's tick (extrapolated by the local clock) minus the delay. */
  renderTick(now) {
    const latest = this.buffer.latest;
    if (!latest) return 0;
    const ahead = Math.min((now - this.stats.lastSnapshotAt) / (1000 / TICK_HZ), 3);
    return latest.tick + ahead - this.interpDelayMs / (1000 * DT);
  }

  /** Everything the renderer needs. Other ships/bullets: in the past, between two snapshots. Ours: now. */
  view(alpha, now) {
    const sampled = this.buffer.sample(this.renderTick(now));
    let ships = sampled.ships;
    let bullets = sampled.bullets;
    if (this.predict && this.predictor.me) {
      ships = ships.filter((s) => s.id !== this.slot);
      const me = this.predictor.renderShip(alpha, now);
      if (me.alive) ships = [...ships, me];
      bullets = [
        ...bullets.filter((b) => b.owner !== this.slot),
        ...this.predictor.renderBullets(alpha),
      ];
    }
    return { ships, bullets, latest: this.buffer.latest };
  }

  netgraph(now) {
    const { inBps, outBps } = this.stats.rates(now);
    return {
      rttMs: this.stats.rttMs,
      snapshotAgeMs: this.stats.lastSnapshotAt ? now - this.stats.lastSnapshotAt : 0,
      inBps,
      outBps,
      queue: this.predict ? this.predictor.pending.length : Math.max(0, this.seq - this.lastAck),
      correction: this.stats.correction,
      history: this.stats.correctionHistory,
    };
  }
}
