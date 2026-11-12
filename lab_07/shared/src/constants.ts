export const TICK_HZ = 30;
export const DT = 1 / TICK_HZ;
export const ARENA = { width: 1280, height: 720 } as const;

export const BUTTON = { THRUST: 1, LEFT: 2, RIGHT: 4, FIRE: 8 } as const;
export const MAX_BUTTONS = 15; // all four bits set

export const SHIP = {
  radius: 14,
  turnRate: 3.6, // rad/s
  thrust: 420, // units/s^2
  drag: 0.8, // 1/s
  maxSpeed: 600,
  maxHp: 3,
  fireCooldown: 8, // ticks
  respawnTicks: 60, // 2 s
  invulnTicks: 60,
} as const;

export const BULLET = { radius: 3, speed: 700, ttl: 36, noseOffset: 18 } as const;
export const MAX_SHIPS = 16;
export const MAX_BULLETS = 512;
