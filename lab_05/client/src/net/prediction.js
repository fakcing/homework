import {
  ARENA,
  DT,
  applyInput,
  createBullet,
  shortestAngleDelta,
  shortestDelta,
  stepBullet,
  wrapCoord,
} from "@dogfight/shared";
import { Smoother } from "./smoother.js";

const MAX_PENDING = 120;

/**
 * Client-side prediction of OUR ship (+ our bullets, shown immediately).
 * step(): apply the input locally right away.   reconcile(): a snapshot arrived -> start from the
 * server's state for our ship and replay the inputs the server has not acknowledged yet.
 * Both use shared/applyInput, the very function the server runs: same input => same state.
 * `chaos` is the lab's deliberate bug: random noise added to every integration step.
 */
export class Predictor {
  constructor({ chaos = 0, random = Math.random, smoother = new Smoother() } = {}) {
    this.chaos = chaos;
    this.random = random;
    this.smoother = smoother;
    this.reset();
  }

  reset() {
    this.me = null;
    this.prev = null;
    this.pending = []; // inputs sent but not yet acknowledged by a snapshot
    this.bullets = new Map(); // fireSeq -> {bullet, prev}
    this.lastCorrection = 0;
    this.smoother.reset();
  }

  #integrate(ship, input) {
    const r = applyInput(ship, input, DT);
    if (this.chaos)
      r.ship = {
        ...r.ship,
        vx: r.ship.vx + (this.random() - 0.5) * this.chaos,
        vy: r.ship.vy + (this.random() - 0.5) * this.chaos,
      };
    return r;
  }

  /** One local tick. Returns true when this input fired a (predicted) bullet. */
  step(input) {
    this.pending.push(input);
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    if (!this.me?.alive) return false;
    for (const [seq, e] of this.bullets) {
      e.prev = e.bullet;
      e.bullet = stepBullet(e.bullet);
      if (e.bullet.ttl <= 0) this.bullets.delete(seq);
    }
    const { ship, fire } = this.#integrate(this.me, input);
    if (fire) {
      const bullet = createBullet(ship, 0, input.seq);
      this.bullets.set(input.seq, { bullet, prev: bullet });
    }
    this.prev = this.me;
    this.me = ship;
    return fire;
  }

  /** Returns the size of the correction in world units (0 when nothing had to change). */
  reconcile(serverShip, serverBullets, now) {
    const ack = serverShip.lastSeq;
    this.pending = this.pending.filter((i) => i.seq > ack);

    // Our bullets the server already processed but no longer has were hit or expired: drop them here too.
    const alive = new Set(
      serverBullets.filter((b) => b.owner === serverShip.id).map((b) => b.fireSeq),
    );
    for (const seq of this.bullets.keys())
      if (seq <= ack && !alive.has(seq)) this.bullets.delete(seq);

    const old = this.me;
    let state = { ...serverShip };
    let before = state;
    if (serverShip.alive) {
      for (const input of this.pending) {
        before = state;
        state = this.#integrate(state, input).ship; // replay: NO new bullets, they were spawned when first pressed
      }
    }
    this.me = state;
    this.prev = before;
    if (!old?.alive || !serverShip.alive) {
      this.smoother.reset();
      return (this.lastCorrection = 0);
    }
    const dx = shortestDelta(state.x, old.x, ARENA.width); // old - new: where we WERE drawing relative to where we should be
    const dy = shortestDelta(state.y, old.y, ARENA.height);
    this.smoother.add(dx, dy, now);
    return (this.lastCorrection = Math.hypot(dx, dy));
  }

  renderShip(alpha, now) {
    if (!this.me) return null;
    const a = this.prev ?? this.me;
    const b = this.me;
    const off = this.smoother.value(now);
    return {
      ...b,
      x: wrapCoord(a.x + shortestDelta(a.x, b.x, ARENA.width) * alpha + off.x, ARENA.width),
      y: wrapCoord(a.y + shortestDelta(a.y, b.y, ARENA.height) * alpha + off.y, ARENA.height),
      angle: a.angle + shortestAngleDelta(a.angle, b.angle) * alpha,
    };
  }

  renderBullets(alpha) {
    return [...this.bullets.values()].map(({ bullet: b, prev: p }) => ({
      ...b,
      x: wrapCoord(p.x + shortestDelta(p.x, b.x, ARENA.width) * alpha, ARENA.width),
      y: wrapCoord(p.y + shortestDelta(p.y, b.y, ARENA.height) * alpha, ARENA.height),
    }));
  }
}
