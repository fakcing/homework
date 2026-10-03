/** Immutable 2D vector: every method returns a new Vector2 and never mutates its arguments. */
export class Vector2 {
  static ZERO = new Vector2(0, 0);

  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
    Object.freeze(this);
  }

  static fromAngle(angle, length = 1) {
    return new Vector2(Math.cos(angle) * length, Math.sin(angle) * length);
  }

  get length() {
    return Math.hypot(this.x, this.y);
  }

  get lengthSq() {
    return this.x * this.x + this.y * this.y;
  }

  get angle() {
    return Math.atan2(this.y, this.x);
  }

  add(v) {
    return new Vector2(this.x + v.x, this.y + v.y);
  }

  sub(v) {
    return new Vector2(this.x - v.x, this.y - v.y);
  }

  scale(k) {
    return new Vector2(this.x * k, this.y * k);
  }

  dot(v) {
    return this.x * v.x + this.y * v.y;
  }

  normalize() {
    const len = this.length;
    return len === 0 ? Vector2.ZERO : this.scale(1 / len);
  }

  rotate(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return new Vector2(this.x * c - this.y * s, this.x * s + this.y * c);
  }

  distanceTo(v) {
    return this.sub(v).length;
  }

  lerp(v, t) {
    return new Vector2(this.x + (v.x - this.x) * t, this.y + (v.y - this.y) * t);
  }

  clampLength(max) {
    const len = this.length;
    return len > max ? this.scale(max / len) : this;
  }

  equals(v) {
    return this.x === v.x && this.y === v.y;
  }
}
