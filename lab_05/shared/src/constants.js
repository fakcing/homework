export const TICK_HZ = 30;
export const DT = 1 / TICK_HZ;
export const ARENA = Object.freeze({ width: 1280, height: 720 });

export const BUTTON = Object.freeze({ THRUST: 1, LEFT: 2, RIGHT: 4, FIRE: 8 });

export const SHIP = Object.freeze({
  radius: 14,
  turnRate: 3.6, // rad/s
  thrust: 420, // units/s^2
  drag: 0.8, // 1/s
  maxSpeed: 600,
  maxHp: 3,
  fireCooldown: 8, // ticks
  respawnTicks: 60, // 2 s
  invulnTicks: 60,
});

export const BULLET = Object.freeze({ radius: 3, speed: 700, ttl: 36, noseOffset: 18 });
