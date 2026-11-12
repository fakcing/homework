import type { Vec2 } from "@dogfight/shared";

/**
 * Hides a reconciliation correction: the ship is drawn at (predicted + offset) where offset starts as (old - new)
 * position, so nothing jumps, and fades linearly to 0 over `durationMs`. A correction larger than `snapDistance`
 * (respawn, teleport) is applied at once.
 */
export class Smoother {
  #x = 0;
  #y = 0;
  #t0 = 0;
  readonly durationMs: number;
  readonly snapDistance: number;

  constructor({
    durationMs = 100,
    snapDistance = 150,
  }: { durationMs?: number; snapDistance?: number } = {}) {
    this.durationMs = durationMs;
    this.snapDistance = snapDistance;
  }

  value(now: number): Vec2 {
    const k = Math.max(0, 1 - (now - this.#t0) / this.durationMs);
    return { x: this.#x * k || 0, y: this.#y * k || 0 }; // `|| 0` avoids -0
  }

  add(dx: number, dy: number, now: number): void {
    if (Math.hypot(dx, dy) > this.snapDistance) return this.reset();
    const cur = this.value(now);
    this.#x = cur.x + dx;
    this.#y = cur.y + dy;
    this.#t0 = now;
  }

  reset(): void {
    this.#x = 0;
    this.#y = 0;
  }
}
