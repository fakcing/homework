import { ARENA, DT, shortestAngleDelta, shortestDelta, wrapCoord } from "@dogfight/shared";
import type { BulletSnap, ShipSnap, Snapshot } from "@dogfight/shared";

const lerpWrapped = (a: number, b: number, t: number, max: number): number =>
  wrapCoord(a + shortestDelta(a, b, max) * t, max);
const MAX_EXTRAPOLATE_TICKS = 3;

export interface Sampled {
  readonly ships: readonly ShipSnap[];
  readonly bullets: readonly BulletSnap[];
}
const EMPTY: Sampled = { ships: [], bullets: [] };

/** Last snapshots by tick; sample(renderTick) blends the two that surround a moment slightly in the past. */
export class SnapshotBuffer {
  #snaps: Snapshot[] = [];
  readonly capacity: number;

  constructor(capacity = 32) {
    this.capacity = capacity;
  }

  get latest(): Snapshot | null {
    return this.#snaps.at(-1) ?? null;
  }

  clear(): void {
    this.#snaps = [];
  }

  /** Returns false for a stale or duplicate snapshot (older tick than the newest one). */
  push(snap: Snapshot): boolean {
    const latest = this.latest;
    if (latest && snap.tick <= latest.tick) return false;
    this.#snaps.push(snap);
    if (this.#snaps.length > this.capacity) this.#snaps.shift();
    return true;
  }

  sample(renderTick: number): Sampled {
    const first = this.#snaps[0];
    const last = this.latest;
    if (!first || !last) return EMPTY;
    if (renderTick <= first.tick) return first;
    if (renderTick >= last.tick) {
      const dt = Math.min(renderTick - last.tick, MAX_EXTRAPOLATE_TICKS) * DT; // only bullets: they fly straight
      return {
        ships: last.ships,
        bullets: last.bullets.map((b) => ({
          ...b,
          x: wrapCoord(b.x + b.vx * dt, ARENA.width),
          y: wrapCoord(b.y + b.vy * dt, ARENA.height),
        })),
      };
    }
    // The two snapshots around renderTick (no indexing: with noUncheckedIndexedAccess `snaps[i]` may be undefined).
    let a = first;
    let b = last;
    for (const s of this.#snaps) {
      if (s.tick <= renderTick) a = s;
      else {
        b = s;
        break;
      }
    }
    const t = (renderTick - a.tick) / (b.tick - a.tick);
    const prevShips = new Map(a.ships.map((s) => [s.id, s]));
    const prevBullets = new Map(a.bullets.map((x) => [x.id, x]));
    return {
      ships: b.ships.map((s): ShipSnap => {
        const p = prevShips.get(s.id);
        if (!p?.alive || !s.alive) return s;
        return {
          ...s,
          x: lerpWrapped(p.x, s.x, t, ARENA.width),
          y: lerpWrapped(p.y, s.y, t, ARENA.height),
          angle: p.angle + shortestAngleDelta(p.angle, s.angle) * t,
        };
      }),
      bullets: b.bullets.map((x): BulletSnap => {
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
