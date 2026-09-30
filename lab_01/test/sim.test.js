import assert from "node:assert/strict";
import { test } from "node:test";
import { shortestAngleDelta, shortestDelta, wrapCoord } from "../src/math.js";
import { ARENA, wrapShip } from "../src/sim/arena.js";
import { createShip, integrate } from "../src/sim/ship.js";

const thrustInput = { isDown: (c) => c === "ArrowUp", justPressed: () => false };

test("integrate is pure and deterministic", () => {
  const ship = createShip(100, 100);
  const frozen = structuredClone(ship);
  const a = integrate(ship, thrustInput, 1 / 60);
  const b = integrate(ship, thrustInput, 1 / 60);
  assert.deepEqual(ship, frozen);
  assert.deepEqual(a, b);
  assert.ok(a.thrust && a.vy < 0, "thrusts upward from the initial heading");
});

test("speed is clamped", () => {
  let ship = createShip(0, 0);
  for (let i = 0; i < 1000; i++) ship = integrate(ship, thrustInput, 1 / 60);
  assert.ok(Math.hypot(ship.vx, ship.vy) <= 600 + 1e-9);
});

test("wrap-around handles both edges", () => {
  assert.equal(wrapCoord(-1, 10), 9);
  assert.equal(wrapCoord(11, 10), 1);
  const w = wrapShip(createShip(-5, ARENA.height + 5));
  assert.equal(w.x, ARENA.width - 5);
  assert.equal(w.y, 5);
});

test("shortest deltas cross the seam", () => {
  assert.equal(shortestDelta(1270, 10, 1280), 20);
  assert.ok(Math.abs(shortestAngleDelta(Math.PI - 0.1, -Math.PI + 0.1) - 0.2) < 1e-12);
});
