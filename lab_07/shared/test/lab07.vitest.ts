import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  ARENA,
  BUTTON,
  BulletId,
  ObjectPool,
  SIZES,
  ShipId,
  Seq,
  Tick,
  SnapshotSchema,
  SpatialHash,
  addShip,
  applyInput,
  createBullet,
  createVec2Pool,
  createWorld,
  decodeInput,
  decodeSnapshotJson,
  decodeSnapshot,
  encodeInput,
  encodeInputJson,
  encodeSnapshot,
  encodeSnapshotJson,
  lerp,
  parseClientMessage,
  shortestAngleDelta,
  shortestDelta,
  snapshotOf,
  stepBullet,
  stepWorld,
  wrapAngle,
  wrapCoord,
  wrappedDelta,
} from "../src/index.js";
import type { Snapshot } from "../src/index.js";

const inputArb = fc
  .record({
    seq: fc.integer({ min: 1, max: 0xffff }),
    buttons: fc.integer({ min: 0, max: 15 }),
  })
  .map(({ seq, buttons }) => ({ seq: Seq.parse(seq), buttons }));

function snapshotFor(angle: number): Snapshot {
  return {
    tick: Tick.parse(12),
    ships: [
      {
        kind: "ship",
        id: ShipId.parse(0),
        alive: true,
        thrust: false,
        invuln: false,
        hp: 3,
        cooldown: 0,
        score: 2,
        angle,
        x: 20,
        y: 30,
        vx: 1,
        vy: -2,
        lastSeq: Seq.parse(1),
      },
    ],
    bullets: [],
  };
}

describe("Lab 7 shared: codecs and properties", () => {
  it("encodes and decodes a normal input", () => {
    const input = { seq: Seq.parse(7), buttons: BUTTON.THRUST | BUTTON.FIRE };
    expect(decodeInput(encodeInput(input))).toEqual(input);
  });
  it("rejects a short input packet", () =>
    expect(() => decodeInput(new Uint8Array(2))).toThrow("7 bytes"));
  it("rejects an input with the wrong type", () => {
    const data = new Uint8Array(encodeInput({ seq: Seq.parse(1), buttons: 0 }));
    data[1] = 99;
    expect(() => decodeInput(data)).toThrow("unexpected packet");
  });
  it("keeps coordinates inside the wrapping arena", () => {
    expect(wrapCoord(-1, 10)).toBe(9);
    expect(wrapCoord(11, 10)).toBe(1);
  });
  it("wraps angles to the shortest range", () =>
    expect(wrapAngle(Math.PI * 2 + 0.1)).toBeCloseTo(0.1));
  it("creates a bullet in front of its ship", () => {
    const world = createWorld(4);
    const ship = addShip(world, ShipId.parse(0));
    const bullet = createBullet(ship, BulletId.parse(1), Seq.parse(1));
    expect(bullet.owner).toBe(ship.id);
    expect(bullet.ttl).toBeGreaterThan(0);
  });
  it("does not mutate a ship when applying an input", () => {
    const world = createWorld(5);
    const ship = addShip(world, ShipId.parse(0));
    const next = applyInput(ship, { seq: Seq.parse(1), buttons: BUTTON.THRUST }).ship;
    expect(next).not.toBe(ship);
    expect(ship.vx).toBe(0);
  });
  it("steps deterministic worlds identically", () => {
    const a = createWorld(99);
    const b = createWorld(99);
    addShip(a, ShipId.parse(0));
    addShip(b, ShipId.parse(0));
    for (let i = 1; i <= 20; i++) {
      const input = new Map([[ShipId.parse(0), { seq: Seq.parse(i), buttons: BUTTON.THRUST }]]);
      stepWorld(a, input);
      stepWorld(b, input);
    }
    expect(snapshotOf(a)).toEqual(snapshotOf(b));
  });
  it("increments the world tick", () => {
    const world = createWorld(1);
    stepWorld(world, new Map());
    expect(world.tick).toBe(1);
  });
  it("does not step a ship without an input", () => {
    const world = createWorld(1);
    addShip(world, ShipId.parse(0));
    const before = snapshotOf(world);
    stepWorld(world, new Map());
    expect(world.ships[0]?.x).toBe(before.ships[0]?.x);
  });
  it("fires only when cooldown is zero", () => {
    const world = createWorld(1);
    addShip(world, ShipId.parse(0));
    stepWorld(world, new Map([[ShipId.parse(0), { seq: Seq.parse(1), buttons: BUTTON.FIRE }]]));
    stepWorld(world, new Map([[ShipId.parse(0), { seq: Seq.parse(2), buttons: BUTTON.FIRE }]]));
    expect(world.bullets).toHaveLength(1);
  });
  it("reuses bullet objects after expiry", () => {
    const world = createWorld(1);
    addShip(world, ShipId.parse(0));
    stepWorld(world, new Map([[ShipId.parse(0), { seq: Seq.parse(1), buttons: BUTTON.FIRE }]]));
    const created = world.bulletPool.stats.created;
    for (let i = 0; i < 40; i++)
      stepWorld(world, new Map([[ShipId.parse(0), { seq: Seq.parse(10 + i), buttons: 0 }]]));
    stepWorld(world, new Map([[ShipId.parse(0), { seq: Seq.parse(50), buttons: BUTTON.FIRE }]]));
    expect(world.bulletPool.stats.created).toBe(created);
    expect(world.bulletPool.stats.reused).toBeGreaterThan(0);
  });
  it("spatial hash wraps queries across the left edge", () => {
    const hash = new SpatialHash<{ x: number; y: number }>(100, 100, 20);
    const item = { x: 99, y: 50 };
    hash.insert(item);
    expect(hash.query(1, 50, 5)).toContain(item);
  });
  it("spatial hash counts inserted objects", () => {
    const hash = new SpatialHash<{ x: number; y: number }>(100, 100);
    hash.insert({ x: 1, y: 1 });
    hash.insert({ x: 2, y: 2 });
    expect(hash.size).toBe(2);
  });
  it("snapshot schema rejects a NaN coordinate", () => {
    const result = SnapshotSchema.safeParse({
      ...snapshotFor(0),
      ships: [{ ...snapshotFor(0).ships[0], x: NaN }],
    });
    expect(result.success).toBe(false);
  });
  it("parses a valid join message", () => {
    expect(parseClientMessage({ type: "join", room: "alpha", name: "Ada" }).ok).toBe(true);
  });
  it("rejects a malformed chat message", () => {
    expect(parseClientMessage({ type: "chat", text: "" }).ok).toBe(false);
  });
  it("rejects unknown client message types", () => {
    expect(parseClientMessage({ type: "teleport" }).ok).toBe(false);
  });
  it("uses the documented input size", () =>
    expect(encodeInput({ seq: Seq.parse(1), buttons: 0 }).byteLength).toBe(SIZES.input));
  it("uses the documented snapshot header size", () =>
    expect(encodeSnapshot(snapshotFor(0)).byteLength).toBe(SIZES.header + SIZES.ship));
  it("round trips JSON input", () =>
    expect(encodeInputJson({ seq: Seq.parse(2), buttons: 3 })).toContain('"seq":2'));
  it("round trips JSON snapshot", () => {
    const text = encodeSnapshotJson(snapshotFor(0.25));
    expect(decodeSnapshotJson(text).ships[0]?.angle).toBeCloseTo(0.25);
  });
  it("rejects malformed JSON snapshot", () =>
    expect(() => decodeSnapshotJson("{bad")).toThrow("not JSON"));
  it("rejects a wrong binary version", () => {
    const data = new Uint8Array(encodeSnapshot(snapshotFor(0)));
    data[0] = 99;
    expect(() => decodeSnapshot(data)).toThrow("version");
  });
  it("rejects unknown ship flags", () => {
    const data = new Uint8Array(encodeSnapshot(snapshotFor(0)));
    data[9 + 1] = 0x80;
    expect(() => decodeSnapshot(data)).toThrow("flags");
  });
  it("rejects an incorrect binary length", () => {
    const data = new Uint8Array(encodeSnapshot(snapshotFor(0))).slice(0, -1);
    expect(() => decodeSnapshot(data)).toThrow("length");
  });
  it("rejects too many ships before reading fields", () => {
    const data = new Uint8Array(SIZES.header);
    data[0] = 1;
    data[1] = 2;
    data[6] = 255;
    expect(() => decodeSnapshot(data)).toThrow("too many");
  });
  it("round trips a snapshot through binary", () => {
    const snapshot = snapshotFor(0.5);
    const decoded = decodeSnapshot(encodeSnapshot(snapshot));
    expect(decoded.tick).toBe(snapshot.tick);
    expect(decoded.ships[0]?.x).toBeCloseTo(20);
  });
  it("round trips a snapshot through JSON schema", () => {
    const snapshot = snapshotFor(0.5);
    expect(SnapshotSchema.parse(snapshot).ships).toHaveLength(1);
  });
  it("computes wrapping deltas", () => {
    expect(shortestDelta(99, 1, 100)).toBe(2);
    expect(shortestAngleDelta(3, -3)).toBeCloseTo(0.283);
    expect(lerp(0, 10, 0.25)).toBe(2.5);
    expect(wrappedDelta({ x: ARENA.width - 1, y: 1 }, { x: 1, y: ARENA.height - 1 })).toEqual({
      x: 2,
      y: -2,
    });
  });
  it("steps and expires a bullet", () => {
    const bullet = {
      kind: "bullet" as const,
      id: BulletId.parse(1),
      owner: ShipId.parse(0),
      ttl: 1,
      x: ARENA.width - 1,
      y: 2,
      vx: 100,
      vy: -100,
      fireSeq: Seq.parse(1),
    };
    const next = stepBullet(bullet);
    expect(next.ttl).toBe(0);
    expect(next.x).toBeLessThan(ARENA.width);
    expect(next.y).toBeGreaterThanOrEqual(0);
  });
  it("resets and reuses a generic object pool", () => {
    const pool = new ObjectPool(
      () => ({ value: 1 }),
      (v) => (v.value = 0),
      1,
    );
    const first = pool.acquire();
    pool.release(first);
    expect(pool.acquire()).toBe(first);
    expect(first.value).toBe(0);
    expect(pool.stats.reused).toBe(1);
  });
  it("creates a reusable vector pool", () => {
    const pool = createVec2Pool(2);
    const v = pool.acquire();
    v.x = 4;
    pool.release(v);
    expect(pool.acquire()).toEqual({ x: 0, y: 0 });
  });

  it("property: input decode returns the same message", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        expect(decodeInput(encodeInput(input))).toEqual(input);
      }),
    );
  });
  it("property: snapshot angle survives quantization", () => {
    fc.assert(
      fc.property(fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }), (angle) => {
        const decoded = decodeSnapshot(encodeSnapshot(snapshotFor(angle)));
        expect(decoded.ships[0]?.angle ?? 0).toBeCloseTo(angle, 3);
      }),
    );
  });
  it("property: encoded length follows the format", () => {
    fc.assert(
      fc.property(fc.nat({ max: 8 }), fc.nat({ max: 16 }), (ships, bullets) => {
        const world = createWorld(ships + bullets);
        for (let i = 0; i < Math.min(ships, 8); i++) addShip(world, ShipId.parse(i));
        const snapshot = snapshotOf(world);
        const decoded = decodeSnapshot(encodeSnapshot(snapshot));
        expect(encodeSnapshot(decoded).byteLength).toBe(
          SIZES.header + snapshot.ships.length * SIZES.ship,
        );
      }),
    );
  });
  it("property: broken buffers throw ProtocolError, not a process error", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 80 }), (bytes) => {
        expect(() => decodeSnapshot(bytes)).toThrow();
      }),
    );
  });
  it("property: parser accepts valid and rejects corrupted joins", () => {
    fc.assert(
      fc.property(
        fc.string({ unit: fc.constantFrom("a", "b", "c"), minLength: 1, maxLength: 8 }),
        (name) => {
          expect(parseClientMessage({ type: "join", room: "room-1", name }).ok).toBe(true);
          expect(
            parseClientMessage({ type: "join", room: "room-1", name: `${name}\u0000` }).ok,
          ).toBe(false);
        },
      ),
    );
  });
  it("property: a ship stays inside the arena", () => {
    fc.assert(
      fc.property(fc.array(inputArb, { minLength: 1, maxLength: 100 }), (inputs) => {
        const world = createWorld(10);
        addShip(world, ShipId.parse(0));
        for (const input of inputs) stepWorld(world, new Map([[ShipId.parse(0), input]]));
        const ship = world.ships[0];
        expect(ship?.x).toBeGreaterThanOrEqual(0);
        expect(ship?.x).toBeLessThan(ARENA.width);
        expect(ship?.y).toBeGreaterThanOrEqual(0);
        expect(ship?.y).toBeLessThan(ARENA.height);
      }),
    );
  });

  it.each(Array.from({ length: 20 }, (_, i) => i))("format boundary case %i", (i) => {
    const value = (i * 17) % 256;
    const input = { seq: Seq.parse(i + 1), buttons: value % 16 };
    expect(decodeInput(encodeInput(input))).toEqual(input);
  });
});
