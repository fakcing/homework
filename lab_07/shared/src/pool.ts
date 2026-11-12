/** Small allocation-free pool for hot-path transient objects (bullets, particles, scratch vectors). */
export interface PoolStats {
  readonly created: number;
  readonly reused: number;
  readonly released: number;
  readonly available: number;
}

export class ObjectPool<T extends object> {
  readonly #free: T[] = [];
  #created = 0;
  #reused = 0;
  #released = 0;

  constructor(
    private readonly factory: () => T,
    private readonly reset: (value: T) => void,
    private readonly capacity = 1024,
  ) {}

  acquire(): T {
    const value = this.#free.pop();
    if (value) {
      this.#reused++;
      return value;
    }
    this.#created++;
    return this.factory();
  }

  release(value: T): void {
    this.reset(value);
    this.#released++;
    if (this.#free.length < this.capacity) this.#free.push(value);
  }

  get stats(): PoolStats {
    return {
      created: this.#created,
      reused: this.#reused,
      released: this.#released,
      available: this.#free.length,
    };
  }
}

export interface ScratchVec2 {
  x: number;
  y: number;
}

export function createVec2Pool(capacity = 256): ObjectPool<ScratchVec2> {
  return new ObjectPool(
    () => ({ x: 0, y: 0 }),
    (v) => {
      v.x = 0;
      v.y = 0;
    },
    capacity,
  );
}
