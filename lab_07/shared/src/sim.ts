// Deterministic simulation shared by the browser and Node. No DOM, no Node modules, no clock, no Math.random:
// the only randomness is the world's seeded generator. tsc (lib ES2022, no DOM, no node types) and ESLint enforce it.
import { ARENA, BULLET, BUTTON, DT, MAX_BULLETS, SHIP } from "./constants.js";
import { wrapAngle, wrapCoord, wrappedDelta } from "./math.js";
import { SpatialHash } from "./spatialHash.js";
import { BulletId, Seq, ShipId, Tick } from "./types.js";
import type { BulletSnap, GameEvent, Input } from "./types.js";

/** The part of a ship that movement needs. Server ships and client-predicted ships both satisfy it. */
export interface Mover {
  readonly id: ShipId;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly angle: number;
  readonly thrust: boolean;
  readonly cooldown: number;
  readonly lastSeq: Seq;
}

export interface ShipState extends Mover {
  readonly kind: "ship";
  readonly hp: number;
  readonly alive: boolean;
  readonly score: number;
  readonly invuln: number; // ticks
  readonly respawn: number; // ticks, while dead
}

/** The container is mutable, its contents are not: every step replaces ships/bullets with new objects. */
interface MutableBullet {
  kind: "bullet";
  id: BulletId;
  owner: ShipId;
  ttl: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fireSeq: Seq;
}

export class BulletPool {
  readonly #free: MutableBullet[] = [];
  #created = 0;
  #reused = 0;

  acquire(): MutableBullet {
    const value = this.#free.pop();
    if (value) {
      this.#reused++;
      return value;
    }
    this.#created++;
    return {
      kind: "bullet",
      id: BulletId.parse(0),
      owner: ShipId.parse(0),
      ttl: 0,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      fireSeq: Seq.parse(0),
    };
  }

  release(value: MutableBullet): void {
    if (this.#free.length < MAX_BULLETS) this.#free.push(value);
  }

  get stats(): Readonly<{ created: number; reused: number; available: number }> {
    return { created: this.#created, reused: this.#reused, available: this.#free.length };
  }
}

export interface World {
  tick: Tick;
  rngState: number;
  ships: readonly ShipState[];
  bullets: readonly BulletSnap[];
  nextBulletId: number;
  events: readonly GameEvent[];
  readonly bulletPool: BulletPool;
}

/** mulberry32 on `world.rngState`: same seed + same call order = same numbers everywhere. */
export function nextRandom(world: Pick<World, "rngState">): number {
  world.rngState = (world.rngState + 0x6d2b79f5) >>> 0;
  let t = world.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const createWorld = (seed: number): World => ({
  tick: Tick.parse(0),
  rngState: seed >>> 0,
  ships: [],
  bullets: [],
  nextBulletId: 1,
  events: [],
  bulletPool: new BulletPool(),
});

function spawnPoint(world: World): { x: number; y: number; angle: number } {
  return {
    x: nextRandom(world) * ARENA.width,
    y: nextRandom(world) * ARENA.height,
    angle: wrapAngle((nextRandom(world) - 0.5) * 2 * Math.PI),
  };
}

export function addShip(world: World, id: ShipId): ShipState {
  const ship: ShipState = {
    kind: "ship",
    id,
    ...spawnPoint(world),
    vx: 0,
    vy: 0,
    hp: SHIP.maxHp,
    alive: true,
    thrust: false,
    cooldown: 0,
    score: 0,
    invuln: SHIP.invulnTicks,
    respawn: 0,
    lastSeq: Seq.parse(0),
  };
  world.ships = [...world.ships, ship].sort((a, b) => a.id - b.id); // fixed order => fixed order of rng use
  return ship;
}

export function removeShip(world: World, id: ShipId): void {
  world.ships = world.ships.filter((s) => s.id !== id);
}

/**
 * One step of ONE ship from one input. Pure and generic over the ship type: the server runs it inside
 * stepWorld, the client runs the same function for prediction and for replaying unacknowledged inputs.
 */
export function applyInput<S extends Mover>(
  ship: S,
  input: Input,
  dt: number = DT,
): { ship: S; fire: boolean } {
  const b = input.buttons;
  const turn = Number((b & BUTTON.RIGHT) !== 0) - Number((b & BUTTON.LEFT) !== 0);
  const thrust = (b & BUTTON.THRUST) !== 0;
  const angle = wrapAngle(ship.angle + turn * SHIP.turnRate * dt);

  let { vx, vy } = ship;
  if (thrust) {
    vx += Math.cos(angle) * SHIP.thrust * dt;
    vy += Math.sin(angle) * SHIP.thrust * dt;
  }
  const damping = Math.exp(-SHIP.drag * dt);
  vx *= damping;
  vy *= damping;
  const speed = Math.hypot(vx, vy);
  if (speed > SHIP.maxSpeed) {
    vx *= SHIP.maxSpeed / speed;
    vy *= SHIP.maxSpeed / speed;
  }

  const fire = (b & BUTTON.FIRE) !== 0 && ship.cooldown === 0;
  return {
    fire,
    ship: {
      ...ship,
      angle,
      vx,
      vy,
      thrust,
      x: wrapCoord(ship.x + vx * dt, ARENA.width),
      y: wrapCoord(ship.y + vy * dt, ARENA.height),
      cooldown: fire ? SHIP.fireCooldown : Math.max(0, ship.cooldown - 1),
      lastSeq: input.seq,
    },
  };
}

export function createBullet(
  ship: Mover,
  id: BulletId,
  fireSeq: Seq,
  pool?: BulletPool,
): BulletSnap {
  const cx = Math.cos(ship.angle);
  const cy = Math.sin(ship.angle);
  const bullet = pool?.acquire() ?? {
    kind: "bullet" as const,
    id,
    owner: ship.id,
    ttl: BULLET.ttl,
    fireSeq,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
  };
  bullet.id = id;
  bullet.owner = ship.id;
  bullet.ttl = BULLET.ttl;
  bullet.fireSeq = fireSeq;
  bullet.x = wrapCoord(ship.x + cx * BULLET.noseOffset, ARENA.width);
  bullet.y = wrapCoord(ship.y + cy * BULLET.noseOffset, ARENA.height);
  bullet.vx = ship.vx + cx * BULLET.speed;
  bullet.vy = ship.vy + cy * BULLET.speed;
  return bullet;
}

export function stepBullet(b: BulletSnap, dt: number = DT, pool?: BulletPool): BulletSnap {
  // The pool owns mutable wire objects; the public snapshot type remains readonly.
  const next = pool ? (b as MutableBullet) : { ...b };
  next.kind = "bullet";
  next.id = b.id;
  next.owner = b.owner;
  next.fireSeq = b.fireSeq;
  next.x = wrapCoord(b.x + b.vx * dt, ARENA.width);
  next.y = wrapCoord(b.y + b.vy * dt, ARENA.height);
  next.vx = b.vx;
  next.vy = b.vy;
  next.ttl = b.ttl - 1;
  return next;
}

const touching = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  reach: number,
): boolean => {
  const d = wrappedDelta(a, b);
  return d.x * d.x + d.y * d.y <= reach * reach;
};

/**
 * One authoritative tick. `inputs`: ShipId -> input. A ship without an input this tick is NOT stepped (its state
 * is a function of the input sequence only, which is what the client replays).
 * Order: move bullets -> ships (spawn bullets) -> collisions -> respawns.
 */
export function stepWorld(world: World, inputs: ReadonlyMap<ShipId, Input>): void {
  const events: GameEvent[] = [];
  const bullets: BulletSnap[] = [];
  for (const bullet of world.bullets) {
    const next = stepBullet(bullet, DT, world.bulletPool);
    if (next.ttl > 0) bullets.push(next);
    // `next` came from the world-owned pool, so it can be returned after expiry.
    else world.bulletPool.release(next as MutableBullet);
  }
  let nextBulletId = world.nextBulletId;

  const moved = world.ships.map((ship): ShipState => {
    const input = inputs.get(ship.id);
    const invuln = Math.max(0, ship.invuln - 1);
    if (!ship.alive) return { ...ship, invuln, lastSeq: input ? input.seq : ship.lastSeq };
    if (!input) return { ...ship, invuln };
    const { ship: next, fire } = applyInput(ship, input);
    if (fire && bullets.length < MAX_BULLETS) {
      bullets.push(createBullet(next, BulletId.parse(nextBulletId), input.seq, world.bulletPool));
      nextBulletId = (nextBulletId % 65535) + 1;
      events.push({ type: "fire", ship: ship.id });
    }
    return { ...next, invuln };
  });

  const byId = new Map(moved.map((s) => [s.id, s]));
  const hash = new SpatialHash<ShipState>(ARENA.width, ARENA.height, 64);
  for (const ship of moved) if (ship.alive && ship.invuln === 0) hash.insert(ship);
  const survivors: BulletSnap[] = [];
  for (const bullet of bullets) {
    let hit = false;
    for (const ship of hash.query(bullet.x, bullet.y, SHIP.radius + BULLET.radius)) {
      const { id } = ship;
      const current = byId.get(id);
      if (!current?.alive || current.id === bullet.owner || current.invuln > 0) continue;
      if (!touching(current, bullet, SHIP.radius + BULLET.radius)) continue;
      const hp = current.hp - 1;
      events.push({ type: "hit", ship: current.id, by: bullet.owner });
      if (hp > 0) {
        byId.set(id, { ...current, hp });
      } else {
        byId.set(id, {
          ...current,
          hp: 0,
          alive: false,
          thrust: false,
          respawn: SHIP.respawnTicks,
        });
        const killer = byId.get(bullet.owner);
        if (killer) byId.set(killer.id, { ...killer, score: killer.score + 1 });
        events.push({ type: "kill", victim: current.id, killer: bullet.owner });
      }
      hit = true;
      break;
    }
    // Collision consumes this pooled bullet immediately.
    if (hit) world.bulletPool.release(bullet as MutableBullet);
    else survivors.push(bullet);
  }

  const ships = [...byId.values()].map((ship): ShipState => {
    if (ship.alive) return ship;
    const respawn = ship.respawn - 1;
    if (respawn > 0) return { ...ship, respawn };
    events.push({ type: "respawn", ship: ship.id });
    return {
      ...ship,
      ...spawnPoint(world),
      vx: 0,
      vy: 0,
      hp: SHIP.maxHp,
      alive: true,
      cooldown: 0,
      invuln: SHIP.invulnTicks,
      respawn: 0,
    };
  });

  Object.assign(world, {
    tick: Tick.parse(world.tick + 1),
    ships,
    bullets: survivors,
    nextBulletId,
    events,
  });
}
