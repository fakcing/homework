import { ARENA, DT, shortestAngleDelta, shortestDelta, wrapCoord } from "@dogfight/shared";

const lerpWrapped = (a, b, t, max) => wrapCoord(a + shortestDelta(a, b, max) * t, max);
const MAX_EXTRAPOLATE_TICKS = 3;

/** Last snapshots by tick; sample(renderTick) blends the two that surround a moment slightly in the past. */
export class SnapshotBuffer {
  #snaps = [];

  constructor(capacity = 32) {
    this.capacity = capacity;
  }

  get latest() {
    return this.#snaps.at(-1) ?? null;
  }

  clear() {
    this.#snaps = [];
  }

  /** Returns false for a stale or duplicate snapshot (older tick than the newest one). */
  push(snap) {
    if (this.latest && snap.tick <= this.latest.tick) return false;
    this.#snaps.push(snap);
    if (this.#snaps.length > this.capacity) this.#snaps.shift();
    return true;
  }

  sample(renderTick) {
    const snaps = this.#snaps;
    if (!snaps.length) return { ships: [], bullets: [] };
    if (renderTick <= snaps[0].tick) return { ships: snaps[0].ships, bullets: snaps[0].bullets };
    const last = snaps.at(-1);
    if (renderTick >= last.tick) {
      const dt = Math.min(renderTick - last.tick, MAX_EXTRAPOLATE_TICKS) * DT; // only bullets: they fly straight
      const bullets = last.bullets.map((b) => ({
        ...b,
        x: wrapCoord(b.x + b.vx * dt, ARENA.width),
        y: wrapCoord(b.y + b.vy * dt, ARENA.height),
      }));
      return { ships: last.ships, bullets };
    }
    let i = snaps.length - 2;
    while (snaps[i].tick > renderTick) i--;
    const a = snaps[i];
    const b = snaps[i + 1];
    const t = (renderTick - a.tick) / (b.tick - a.tick);
    const prevShips = new Map(a.ships.map((s) => [s.id, s]));
    const prevBullets = new Map(a.bullets.map((x) => [x.id, x]));
    return {
      ships: b.ships.map((s) => {
        const p = prevShips.get(s.id);
        if (!p || !p.alive || !s.alive) return s;
        return {
          ...s,
          x: lerpWrapped(p.x, s.x, t, ARENA.width),
          y: lerpWrapped(p.y, s.y, t, ARENA.height),
          angle: p.angle + shortestAngleDelta(p.angle, s.angle) * t,
        };
      }),
      bullets: b.bullets.map((x) => {
        const p = prevBullets.get(x.id);
        return p
          ? {
              ...x,
              x: lerpWrapped(p.x, x.x, t, ARENA.width),
              y: lerpWrapped(p.y, x.y, t, ARENA.height),
            }
          : x;
      }),
    };
  }
}
