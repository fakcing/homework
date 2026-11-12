import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  ARENA,
  BUTTON,
  DT,
  ProtocolError,
  SIZES,
  SHIP,
  addShip,
  applyInput,
  createWorld,
  decodeInput,
  decodeSnapshot,
  decodeSnapshotJson,
  encodeInput,
  encodeInputJson,
  encodeSnapshot,
  encodeSnapshotJson,
  shortestDelta,
  snapshotOf,
  stepWorld,
} from "../src/index.js";

const press = (seq, buttons) => ({ seq, buttons });
const { THRUST, LEFT, RIGHT, FIRE } = BUTTON;

test("input codec: 7 bytes, version first, little-endian seq", () => {
  const buf = encodeInput({ seq: 258, buttons: THRUST | FIRE });
  assert.equal(buf.byteLength, 7);
  assert.deepEqual([...new Uint8Array(buf)], [1, 1, 2, 1, 0, 0, 9]); // 258 = 0x0102 -> bytes 02 01 00 00
  assert.deepEqual(decodeInput(buf), { seq: 258, buttons: 9 });
  assert.equal(encodeInputJson({ seq: 1, buttons: 0 }), '{"type":"input","seq":1,"buttons":0}');
  for (const bad of [
    new ArrayBuffer(6),
    new Uint8Array([2, 1, 0, 0, 0, 0, 0]).buffer,
    new Uint8Array([1, 2, 0, 0, 0, 0, 0]).buffer,
    new Uint8Array([1, 1, 0, 0, 0, 0, 99]).buffer,
  ]) {
    assert.throws(() => decodeInput(bad), ProtocolError);
  }
});

function sampleWorld() {
  const w = createWorld(7);
  addShip(w, 0);
  addShip(w, 1);
  let seq = 0;
  for (let i = 0; i < 40; i++)
    stepWorld(
      w,
      new Map([
        [0, press(++seq, THRUST | RIGHT | FIRE)],
        [1, press(seq, THRUST)],
      ]),
    );
  return w;
}

test("snapshot codec: binary round-trips within quantization, JSON exactly; sizes are as documented", () => {
  const snap = snapshotOf(sampleWorld());
  assert.ok(snap.bullets.length > 0);
  const bin = encodeSnapshot(snap);
  assert.equal(
    bin.byteLength,
    SIZES.header + snap.ships.length * SIZES.ship + snap.bullets.length * SIZES.bullet,
  );
  const back = decodeSnapshot(bin);
  assert.equal(back.tick, snap.tick);
  snap.ships.forEach((s, i) => {
    for (const k of ["x", "y", "vx", "vy"]) assert.ok(Math.abs(back.ships[i][k] - s[k]) < 1e-3, k);
    assert.ok(Math.abs(back.ships[i].angle - s.angle) < 1e-4, "int16 angle");
    assert.equal(back.ships[i].lastSeq, s.lastSeq);
  });
  assert.deepEqual(decodeSnapshotJson(encodeSnapshotJson(snap)), snap);
  assert.throws(() => decodeSnapshot(bin.slice(0, bin.byteLength - 1)), ProtocolError);
  assert.throws(() => decodeSnapshotJson("{"), ProtocolError);
});

test("determinism: same seed + same inputs => identical world; different seed => different", () => {
  const a = JSON.stringify(sampleWorld());
  assert.equal(a, JSON.stringify(sampleWorld()));
  const w = createWorld(8);
  addShip(w, 0);
  assert.notEqual(JSON.stringify(w.ships[0]), JSON.stringify(sampleWorld().ships[0]));
});

test("client prediction == server step: applyInput replayed over the same inputs gives the same ship", () => {
  const world = createWorld(3);
  const start = addShip(world, 0);
  let predicted = { ...start };
  const script = [THRUST, THRUST | LEFT, THRUST | LEFT, RIGHT, 0, THRUST | RIGHT, THRUST];
  script.forEach((buttons, i) => {
    const input = press(i + 1, buttons);
    stepWorld(world, new Map([[0, input]]));
    predicted = applyInput(predicted, input, DT).ship;
  });
  const server = world.ships[0];
  for (const k of ["x", "y", "vx", "vy", "angle", "cooldown", "lastSeq"])
    assert.equal(predicted[k], server[k], k);
});

test("a ship without an input is not stepped; firing respects the cooldown", () => {
  const w = createWorld(1);
  addShip(w, 0);
  const before = { ...w.ships[0] };
  stepWorld(w, new Map());
  assert.equal(w.ships[0].x, before.x);
  for (let i = 1; i <= 10; i++) stepWorld(w, new Map([[0, press(i, FIRE)]]));
  assert.equal(w.bullets.length, 2, "steps 1 and 10: 8 cooldown steps in between");
  assert.equal(w.bullets[0].fireSeq, 1);
});

test("bullets hit enemies not owners; death, score and respawn after 60 ticks", () => {
  const w = createWorld(5);
  addShip(w, 0);
  addShip(w, 1);
  const ship = (id) => w.ships.find((s) => s.id === id); // stepWorld replaces ship objects each tick
  Object.assign(ship(0), { x: 100, y: 100, angle: 0, invuln: 0 });
  Object.assign(ship(1), { x: 200, y: 100, angle: 0, invuln: 0 });
  let seq = 0;
  const kills = [];
  for (let i = 0; i < 400 && ship(1).alive; i++) {
    stepWorld(w, new Map([[0, press(++seq, FIRE)]]));
    kills.push(...w.events.filter((e) => e.type === "kill"));
  }
  assert.equal(ship(1).alive, false);
  assert.equal(ship(1).hp, 0);
  assert.equal(ship(0).hp, SHIP.maxHp, "never hits its owner");
  assert.deepEqual(kills, [{ type: "kill", victim: 1, killer: 0 }]);
  assert.equal(ship(0).score, 1);
  for (let i = 0; i < SHIP.respawnTicks - 2; i++) stepWorld(w, new Map()); // the death tick itself is the first of the 60
  assert.equal(ship(1).alive, false);
  stepWorld(w, new Map());
  assert.equal(ship(1).alive, true);
  assert.equal(ship(1).hp, SHIP.maxHp);
  assert.ok(ship(1).x >= 0 && ship(1).x < ARENA.width);
});

test("shared/src never touches Math.random, Date, performance, process or node: modules", () => {
  const dir = path.join(import.meta.dirname, "..", "src");
  for (const file of fs.readdirSync(dir)) {
    const code = fs.readFileSync(path.join(dir, file), "utf8").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(
      code,
      /Math\.random|Date\.now|new Date|performance\.|process\.|from "node:|require\(/,
      file,
    );
  }
  assert.equal(shortestDelta(1270, 10, 1280), 20);
});
