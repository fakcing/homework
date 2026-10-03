import { TAU } from "../math.js";
import { Asteroid } from "./asteroid.js";
import { ARENA } from "./arena.js";
import { homing } from "./behaviors.js";
import { createPickup, spawnExplosion } from "./effects.js";
import { Ship } from "./ship.js";
import { Vector2 } from "./vector2.js";
import { World } from "./world.js";

const RESPAWN_DELAY = 2;
const START_ASTEROIDS = 5;
const MAX_ASTEROIDS = 8;
const ASTEROID_EVERY = 3;
const PICKUP_EVERY = 10;
const MAX_PICKUPS = 2;
const SAFE_DISTANCE = 240;

/** Game rules on top of the generic World: score, respawn, spawning of asteroids and pickups. */
export class Game {
  #respawnIn = 0;
  #asteroidTimer = ASTEROID_EVERY;
  #pickupTimer = PICKUP_EVERY;

  constructor({ arena = ARENA, seed = 1, input }) {
    this.input = input;
    this.world = new World({ arena, seed });
    this.score = 0;
    this.ship = null;

    this.world.on("shipDestroyed", ({ ship }) => {
      spawnExplosion(this.world, ship.pos, { count: 40, speed: 260, life: 1 });
      this.#respawnIn = RESPAWN_DELAY;
    });
    this.world.on("asteroidDestroyed", ({ asteroid, source }) => {
      spawnExplosion(this.world, asteroid.pos, { count: 14, speed: 160, life: 0.7 });
      if (source?.kind !== "bullet") return;
      this.score += asteroid.points;
      if (asteroid.size === "large") this.#split(asteroid);
    });

    this.#spawnShip();
    for (let i = 0; i < START_ASTEROIDS; i++) this.#spawnAsteroid();
  }

  get respawnIn() {
    return this.ship.alive ? 0 : Math.max(0, this.#respawnIn);
  }

  step(dt) {
    if (!this.ship.alive) {
      this.#respawnIn -= dt;
      if (this.#respawnIn <= 0) this.#spawnShip();
    }
    this.#asteroidTimer -= dt;
    if (this.#asteroidTimer <= 0) {
      this.#asteroidTimer = ASTEROID_EVERY;
      if (this.world.count("asteroid") < MAX_ASTEROIDS) this.#spawnAsteroid();
    }
    this.#pickupTimer -= dt;
    if (this.#pickupTimer <= 0) {
      this.#pickupTimer = PICKUP_EVERY;
      if (this.world.count("pickup") < MAX_PICKUPS) this.#spawnPickup();
    }
    this.world.step(dt);
    this.input.endStep();
  }

  #rand(min, max) {
    return min + (max - min) * this.world.rng();
  }

  #randomPointAwayFromShip() {
    const { width, height } = this.world.arena;
    let point = new Vector2(this.#rand(0, width), this.#rand(0, height));
    for (
      let i = 0;
      i < 20 && this.world.delta(this.ship, { pos: point }).length < SAFE_DISTANCE;
      i++
    ) {
      point = new Vector2(this.#rand(0, width), this.#rand(0, height));
    }
    return point;
  }

  #spawnShip() {
    const { width, height } = this.world.arena;
    this.ship = this.world.spawn(
      new Ship({ pos: new Vector2(width / 2, height / 2), input: this.input }),
    );
  }

  #spawnAsteroid() {
    const hunter = this.world.rng() < 0.25; // homing is a behavior, not a subclass
    this.world.spawn(
      new Asteroid({
        pos: this.#randomPointAwayFromShip(),
        vel: Vector2.fromAngle(this.#rand(0, TAU), this.#rand(30, 90)),
        size: this.world.rng() < 0.5 ? "large" : "small",
        spin: this.#rand(-1, 1),
        behaviors: hunter ? [homing({ targetKinds: ["ship"], turnRate: 0.5, range: 800 })] : [],
      }),
    );
  }

  #spawnPickup() {
    const type = this.world.rng() < 0.5 ? "repair" : "homing";
    this.world.spawn(createPickup(this.#randomPointAwayFromShip(), type));
  }

  #split(asteroid) {
    for (const turn of [-0.8, 0.8]) {
      this.world.spawn(
        new Asteroid({
          pos: asteroid.pos,
          vel: asteroid.vel.rotate(turn).scale(1.4),
          size: "small",
          spin: this.#rand(-2, 2),
        }),
      );
    }
  }
}
