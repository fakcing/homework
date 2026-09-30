import assert from "node:assert/strict";
import { test } from "node:test";
import { createScriptedInput } from "../src/input.js";
import { ARENA } from "../src/sim/arena.js";
import { Asteroid } from "../src/sim/asteroid.js";
import { homing } from "../src/sim/behaviors.js";
import { Bullet } from "../src/sim/bullet.js";
import { createPickup } from "../src/sim/effects.js";
import { Entity } from "../src/sim/entity.js";
import { Game } from "../src/sim/game.js";
import { Ship } from "../src/sim/ship.js";
import { Vector2 } from "../src/sim/vector2.js";
import { World } from "../src/sim/world.js";
import { findCollisions } from "../src/systems/collisions.js";

const idle = createScriptedInput([]);
const v = (x, y) => new Vector2(x, y);
const dot = (kind, x, y, radius = 10) => new Entity({ kind, pos: v(x, y), radius });

test("Vector2 is immutable and methods do not mutate arguments", () => {
  const a = v(1, 2);
  const b = v(3, 4);
  const sum = a.add(b);
  assert.deepEqual([a.x, a.y, b.x, b.y, sum.x, sum.y], [1, 2, 3, 4, 4, 6]);
  assert.throws(() => {
    a.x = 9;
  }, TypeError);
  assert.equal(v(3, 4).length, 5);
  assert.equal(Vector2.ZERO.normalize(), Vector2.ZERO);
});

test("entity ids are unique and increasing", () => {
  const a = dot("x", 0, 0);
  const b = dot("x", 0, 0);
  assert.ok(b.id > a.id);
});

test("despawn only marks dead; step() sweeps", () => {
  const world = new World();
  const e = world.spawn(dot("rock", 10, 10));
  world.despawn(e.id);
  assert.equal(world.get(e.id), undefined);
  assert.equal([...world.ofKind("rock")].length, 0);
  assert.equal(e.world, world, "still attached until the sweep");
  world.step(1 / 60);
  assert.equal(e.world, null);
});

test("collision detection is wrap-around aware", () => {
  const a = dot("a", 2, 100);
  const b = dot("b", ARENA.width - 2, 100);
  const far = dot("c", 600, 600);
  assert.equal(findCollisions([a, b, far], ARENA).length, 1);
});

test("bullets damage asteroids, die on hit, and expire after their TTL", () => {
  const world = new World();
  let destroyed = 0;
  world.on("asteroidDestroyed", () => destroyed++);
  world.spawn(new Asteroid({ pos: v(200, 200), vel: Vector2.ZERO, size: "large" }));
  for (let i = 0; i < 3; i++) {
    world.spawn(new Bullet({ pos: v(200, 200), vel: Vector2.ZERO, ownerId: 0 }));
  }
  world.step(1 / 60);
  assert.equal(destroyed, 1);
  assert.equal(world.count("asteroid"), 0);
  assert.equal(world.count("bullet"), 0);

  world.spawn(new Bullet({ pos: v(50, 50), vel: v(10, 0), ownerId: 0, ttl: 0.5 }));
  for (let i = 0; i < 29; i++) world.step(1 / 60);
  assert.equal(world.count("bullet"), 1);
  for (let i = 0; i < 3; i++) world.step(1 / 60);
  assert.equal(world.count("bullet"), 0);
});

test("ship: nose spawn, cooldown, private hp, and the `this` bug", () => {
  const world = new World();
  const ship = world.spawn(new Ship({ pos: v(300, 300), input: idle, invulnerable: 0 }));
  assert.equal(ship.fire(), true);
  const [bullet] = world.ofKind("bullet");
  assert.ok(Math.abs(bullet.pos.x - 300) < 1e-9 && Math.abs(bullet.pos.y - (300 - 18)) < 1e-9);
  assert.equal(ship.fire(), false, "cooldown");

  assert.equal(ship.hp, 3);
  assert.throws(() => {
    ship.hp = 1;
  }, TypeError);
  assert.equal(Object.hasOwn(ship, "hp"), false);

  const { fire } = ship;
  assert.throws(() => fire(), TypeError);
});

test("homing behavior turns velocity toward the target and keeps speed", () => {
  const world = new World();
  world.spawn(new Asteroid({ pos: v(100, 300), vel: Vector2.ZERO }));
  const bullet = world.spawn(
    new Bullet({
      pos: v(100, 100),
      vel: v(100, 0),
      ownerId: 0,
      behaviors: [homing({ targetKinds: ["asteroid"], turnRate: 3 })],
    }),
  );
  for (let i = 0; i < 10; i++) world.step(1 / 60);
  assert.ok(bullet.vel.y > 0, "now heading toward +y");
  assert.ok(Math.abs(bullet.vel.length - 100) < 1e-9);
});

test("pickup heals a hurt ship and is consumed; a healthy ship leaves it alone", () => {
  const world = new World();
  const ship = world.spawn(new Ship({ pos: v(500, 500), input: idle, invulnerable: 0 }));
  world.spawn(createPickup(v(500, 500), "repair"));
  world.step(1 / 60);
  assert.equal(world.count("pickup"), 1, "full hp: not consumed");
  ship.takeDamage(1);
  world.step(1 / 60);
  assert.equal(ship.hp, 3);
  assert.equal(world.count("pickup"), 0);
});

test("game: ship respawns 2 s after it is destroyed", () => {
  const game = new Game({ input: idle, seed: 7 });
  for (let i = 0; i < 600 && !game.ship.takeDamage(99); i++) game.step(1 / 60);
  assert.equal(game.ship.alive, false);
  for (let i = 0; i < 113; i++) game.step(1 / 60);
  assert.equal(game.ship.alive, false);
  for (let i = 0; i < 15; i++) game.step(1 / 60);
  assert.equal(game.ship.alive, true);
});

test("game is deterministic: same seed + same input -> same world", () => {
  const run = () => {
    const game = new Game({
      input: createScriptedInput(["ArrowUp", "ArrowRight", "Space"]),
      seed: 42,
    });
    for (let i = 0; i < 900; i++) game.step(1 / 60);
    return game.world.snapshot().join("|") + `|score=${game.score}`;
  };
  assert.equal(run(), run());
});
