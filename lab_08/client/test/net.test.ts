import assert from "node:assert/strict";
import { test } from "node:test";
import { BUTTON, ARENA, DT, addShip, createWorld, stepWorld } from "@dogfight/shared";
import { SnapshotBuffer } from "../src/net/interpolation.js";
import { createNetSim } from "../src/net/netsim.js";
import { Predictor } from "../src/net/prediction.js";
import { Smoother } from "../src/net/smoother.js";

const ship = (id, x, y, angle = 0, extra = {}) => ({
  id,
  alive: true,
  x,
  y,
  vx: 0,
  vy: 0,
  angle,
  hp: 3,
  thrust: false,
  invuln: false,
  cooldown: 0,
  score: 0,
  lastSeq: 0,
  ...extra,
});

test("smoother: offset fades linearly to zero over 100 ms; huge corrections snap", () => {
  const s = new Smoother({ durationMs: 100, snapDistance: 150 });
  s.add(10, -4, 1000);
  assert.deepEqual(s.value(1000), { x: 10, y: -4 });
  assert.deepEqual(s.value(1050), { x: 5, y: -2 });
  assert.deepEqual(s.value(1100), { x: 0, y: 0 });
  s.add(10, 0, 2000);
  s.add(10, 0, 2050); // a second correction starts from what is still visible (5 + 10)
  assert.equal(s.value(2050).x, 15);
  s.add(500, 0, 3000);
  assert.deepEqual(s.value(3000), { x: 0, y: 0 });
});

test("snapshot buffer: interpolates between two snapshots, takes the short way round the arena, rejects stale ticks", () => {
  const buf = new SnapshotBuffer();
  buf.push({ tick: 10, ships: [ship(1, 100, 100, 0)], bullets: [] });
  buf.push({ tick: 12, ships: [ship(1, 200, 100, 1)], bullets: [] });
  assert.equal(buf.push({ tick: 11, ships: [], bullets: [] }), false);
  const mid = buf.sample(11).ships[0];
  assert.deepEqual([mid.x, mid.y, mid.angle], [150, 100, 0.5]);

  const wrap = new SnapshotBuffer();
  wrap.push({ tick: 1, ships: [ship(1, ARENA.width - 10, 50)], bullets: [] });
  wrap.push({ tick: 3, ships: [ship(1, 10, 50)], bullets: [] });
  assert.equal(wrap.sample(2).ships[0].x, 0, "crosses the edge, not the whole arena");
  assert.equal(buf.sample(0).ships[0].x, 100, "before the first snapshot: hold");
});

test("netsim: half the RTT each way, +/- jitter, loss rate", () => {
  const delays = [];
  const sim = createNetSim({ lagMs: 100, jitterMs: 0, schedule: (fn, ms) => delays.push(ms) });
  sim.deliver(() => {});
  assert.deepEqual(delays, [50]);
  let seed = 1;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const lossy = createNetSim({ lossPct: 20, random, schedule: () => {} });
  const kept = Array.from({ length: 5000 }, () => lossy.deliver(() => {})).filter(Boolean).length;
  assert.ok(kept > 3800 && kept < 4200, `kept ${kept}/5000`);
});

test("prediction + reconciliation: with an unacked input backlog the correction is exactly 0", () => {
  const world = createWorld(4);
  addShip(world, 0);
  const p = new Predictor();
  p.me = { ...world.ships[0] };
  const sent = [];
  let now = 0;
  const corrections = [];
  for (let i = 1; i <= 60; i++) {
    const input = { seq: i, buttons: BUTTON.THRUST | (i % 20 < 10 ? BUTTON.LEFT : BUTTON.RIGHT) };
    p.step(input);
    sent.push(input);
    const ack = sent.shift && sent.length > 4 ? sent[sent.length - 5] : null; // the server is 4 inputs behind
    if (ack) {
      const w = createWorld(4);
      addShip(w, 0);
      for (const s of sent.filter((x) => x.seq <= ack.seq)) stepWorld(w, new Map([[0, s]]));
      corrections.push(p.reconcile(w.ships[0], [], (now += DT * 1000)));
    }
  }
  assert.ok(corrections.length > 40);
  assert.ok(Math.max(...corrections) < 1e-9, `max correction ${Math.max(...corrections)}`);
});

test("chaos (Math.random in integrate) makes corrections grow with its amplitude", () => {
  const run = (chaos) => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const p = new Predictor({ chaos, random });
    const w = createWorld(4);
    addShip(w, 0);
    p.me = { ...w.ships[0] };
    const sent = [];
    const out = [];
    for (let i = 1; i <= 90; i++) {
      const input = { seq: i, buttons: BUTTON.THRUST | BUTTON.RIGHT };
      p.step(input);
      sent.push(input);
      if (sent.length > 3) {
        const ack = sent.length - 3;
        const sw = createWorld(4);
        addShip(sw, 0);
        for (const s of sent.slice(0, ack)) stepWorld(sw, new Map([[0, s]]));
        out.push(p.reconcile(sw.ships[0], [], i * 33));
      }
    }
    return out.reduce((s, v) => s + v, 0) / out.length;
  };
  const [c0, c1, c2] = [run(0), run(1), run(4)];
  assert.ok(c0 < 1e-9 && c1 > c0 + 0.05 && c2 > c1 * 2, `${c0} ${c1} ${c2}`);
});

test("own bullets appear at once and are dropped when the server no longer has them", () => {
  const p = new Predictor();
  p.me = ship(0, 100, 100, 0);
  p.step({ seq: 1, buttons: BUTTON.FIRE });
  assert.equal(p.renderBullets(1).length, 1, "shown before any snapshot");
  p.reconcile({ ...ship(0, 100, 100), lastSeq: 1 }, [], 0); // acked, but the server has no such bullet (it hit something)
  assert.equal(p.renderBullets(1).length, 0);
});
