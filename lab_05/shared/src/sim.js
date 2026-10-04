// Deterministic simulation shared by the browser and Node. No DOM, no Node modules, no clock,
// no Math.random: the only randomness is the world's seeded generator (ESLint enforces this).
import { ARENA, BULLET, BUTTON, DT, SHIP } from "./constants.js";
import { shortestDelta, wrapAngle, wrapCoord } from "./math.js";

/** mulberry32 on `world.rngState`: same seed + same call order = same numbers everywhere. */
export function nextRandom(world) {
  world.rngState = (world.rngState + 0x6d2b79f5) >>> 0;
  let t = world.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const createWorld = (seed) => ({
  tick: 0,
  rngState: seed >>> 0,
  ships: [],
  bullets: [],
  nextBulletId: 1,
  events: [],
});

function spawnPoint(world) {
  return {
    x: nextRandom(world) * ARENA.width,
    y: nextRandom(world) * ARENA.height,
    angle: wrapAngle((nextRandom(world) - 0.5) * 2 * Math.PI),
  };
}

export function addShip(world, id) {
  const ship = {
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
    lastSeq: 0,
  };
  world.ships.push(ship);
  world.ships.sort((a, b) => a.id - b.id); // fixed order => fixed order of rng use
  return ship;
}

export const removeShip = (world, id) =>
  void (world.ships = world.ships.filter((s) => s.id !== id));

/**
 * One step of ONE ship from one input. Pure: used by the server (stepWorld) and, unchanged, by the
 * client for prediction and for replaying unacknowledged inputs. Returns {ship, fire}.
 */
export function applyInput(ship, input, dt = DT) {
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

export function createBullet(ship, id, fireSeq) {
  const cx = Math.cos(ship.angle);
  const cy = Math.sin(ship.angle);
  return {
    id,
    owner: ship.id,
    ttl: BULLET.ttl,
    fireSeq,
    x: wrapCoord(ship.x + cx * BULLET.noseOffset, ARENA.width),
    y: wrapCoord(ship.y + cy * BULLET.noseOffset, ARENA.height),
    vx: ship.vx + cx * BULLET.speed,
    vy: ship.vy + cy * BULLET.speed,
  };
}

export const stepBullet = (b, dt = DT) => ({
  ...b,
  x: wrapCoord(b.x + b.vx * dt, ARENA.width),
  y: wrapCoord(b.y + b.vy * dt, ARENA.height),
  ttl: b.ttl - 1,
});

const hits = (a, b, reach) => {
  const dx = shortestDelta(a.x, b.x, ARENA.width);
  const dy = shortestDelta(a.y, b.y, ARENA.height);
  return dx * dx + dy * dy <= reach * reach;
};

/**
 * One authoritative tick. `inputs`: Map(shipId -> input | undefined). A ship without an input this tick
 * is NOT stepped (its state is a function of the input sequence only, which is what the client replays).
 * Order: move bullets -> ships (spawn bullets) -> collisions -> respawns.
 */
export function stepWorld(world, inputs) {
  world.tick++;
  world.events = [];
  world.bullets = world.bullets.map((b) => stepBullet(b)).filter((b) => b.ttl > 0);

  world.ships = world.ships.map((ship) => {
    const input = inputs.get(ship.id);
    const invuln = Math.max(0, ship.invuln - 1);
    if (!ship.alive) return { ...ship, invuln, lastSeq: input ? input.seq : ship.lastSeq };
    if (!input) return { ...ship, invuln };
    const { ship: next, fire } = applyInput(ship, input);
    if (fire && world.bullets.length < 512) {
      world.bullets.push(createBullet(next, world.nextBulletId, input.seq));
      world.nextBulletId = (world.nextBulletId % 65535) + 1;
      world.events.push({ type: "fire", ship: ship.id });
    }
    return { ...next, invuln };
  });

  const byId = new Map(world.ships.map((s) => [s.id, s]));
  world.bullets = world.bullets.filter((bullet) => {
    for (const ship of world.ships) {
      if (!ship.alive || ship.id === bullet.owner || ship.invuln > 0) continue;
      if (!hits(ship, bullet, SHIP.radius + BULLET.radius)) continue;
      ship.hp -= 1;
      world.events.push({ type: "hit", ship: ship.id, by: bullet.owner });
      if (ship.hp <= 0) {
        ship.alive = false;
        ship.respawn = SHIP.respawnTicks;
        ship.thrust = false;
        const killer = byId.get(bullet.owner);
        if (killer) killer.score += 1;
        world.events.push({ type: "kill", victim: ship.id, killer: bullet.owner });
      }
      return false;
    }
    return true;
  });

  for (const ship of world.ships) {
    if (ship.alive || --ship.respawn > 0) continue;
    Object.assign(ship, spawnPoint(world), {
      vx: 0,
      vy: 0,
      hp: SHIP.maxHp,
      alive: true,
      cooldown: 0,
      invuln: SHIP.invulnTicks,
    });
    world.events.push({ type: "respawn", ship: ship.id });
  }
}
