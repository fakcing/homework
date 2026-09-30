export const SHIP_PARAMS = Object.freeze({
  turnRate: 3.6, // rad/s
  thrust: 420, // units/s^2
  drag: 0.8, // 1/s, exponential damping
  maxSpeed: 600, // units/s
});

const LEFT = ["ArrowLeft", "KeyA"];
const RIGHT = ["ArrowRight", "KeyD"];
const FORWARD = ["ArrowUp", "KeyW"];
const anyDown = (input, codes) => codes.some((c) => input.isDown(c));

export function createShip(x, y) {
  return { x, y, vx: 0, vy: 0, angle: -Math.PI / 2, thrust: false };
}

/**
 * Pure function: (state, input, dt) -> new state. No DOM, no canvas, no clock, no mutation.
 * Semi-implicit Euler: velocity first, then position with the new velocity.
 */
export function integrate(ship, input, dt, params = SHIP_PARAMS) {
  const turn = Number(anyDown(input, RIGHT)) - Number(anyDown(input, LEFT));
  const thrust = anyDown(input, FORWARD);
  const angle = ship.angle + turn * params.turnRate * dt;

  let vx = ship.vx;
  let vy = ship.vy;
  if (thrust) {
    vx += Math.cos(angle) * params.thrust * dt;
    vy += Math.sin(angle) * params.thrust * dt;
  }

  const damping = Math.exp(-params.drag * dt); // frame-rate independent drag
  vx *= damping;
  vy *= damping;

  const speed = Math.hypot(vx, vy);
  if (speed > params.maxSpeed) {
    const k = params.maxSpeed / speed;
    vx *= k;
    vy *= k;
  }

  return { x: ship.x + vx * dt, y: ship.y + vy * dt, vx, vy, angle, thrust };
}
