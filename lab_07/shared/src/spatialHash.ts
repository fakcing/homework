import { wrapCoord } from "./math.js";

/** Uniform spatial hash with toroidal lookup. It avoids checking every ship for every bullet. */
export class SpatialHash<T extends { readonly x: number; readonly y: number }> {
  readonly #cols: number;
  readonly #rows: number;
  readonly #cells = new Map<number, T[]>();

  constructor(
    readonly width: number,
    readonly height: number,
    readonly cellSize = 64,
  ) {
    this.#cols = Math.ceil(width / cellSize);
    this.#rows = Math.ceil(height / cellSize);
  }

  clear(): void {
    this.#cells.clear();
  }

  insert(value: T): void {
    const key = this.#key(value.x, value.y);
    const list = this.#cells.get(key);
    if (list) list.push(value);
    else this.#cells.set(key, [value]);
  }

  query(x: number, y: number, radius: number): readonly T[] {
    const result: T[] = [];
    const seen = new Set<T>();
    const reach = Math.ceil(radius / this.cellSize);
    const cx = Math.floor(wrapCoord(x, this.width) / this.cellSize);
    const cy = Math.floor(wrapCoord(y, this.height) / this.cellSize);
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dy = -reach; dy <= reach; dy++) {
        const col = (cx + dx + this.#cols) % this.#cols;
        const row = (cy + dy + this.#rows) % this.#rows;
        for (const value of this.#cells.get(row * this.#cols + col) ?? []) {
          if (!seen.has(value)) {
            seen.add(value);
            result.push(value);
          }
        }
      }
    }
    return result;
  }

  get size(): number {
    let size = 0;
    for (const values of this.#cells.values()) size += values.length;
    return size;
  }

  #key(x: number, y: number): number {
    const col = Math.floor(wrapCoord(x, this.width) / this.cellSize) % this.#cols;
    const row = Math.floor(wrapCoord(y, this.height) / this.cellSize) % this.#rows;
    return row * this.#cols + col;
  }
}
