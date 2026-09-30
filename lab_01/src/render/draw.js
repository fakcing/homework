const COLORS = {
  bg: "#0a0a0f",
  grid: "rgba(255,255,255,0.045)",
  border: "rgba(255,255,255,0.18)",
  ship: "#f5f5f7",
  accent: "#0a84ff",
  flame: "#ff9f0a",
  text: "rgba(245,245,247,0.86)",
  muted: "rgba(245,245,247,0.5)",
  warn: "#ff453a",
};
const GRID = 80;
const FRAME_BUDGET_MS = 1000 / 60;

/** Deterministic pseudo-random starfield (mulberry32) so it is stable across reloads. */
export function createStars(arena, count = 90, seed = 1337) {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, () => ({
    x: rnd() * arena.width,
    y: rnd() * arena.height,
    r: 0.6 + rnd() * 1.2,
    a: 0.2 + rnd() * 0.6,
  }));
}

export function drawBackground(ctx, arena, stars) {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, arena.width, arena.height);

  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = GRID; x < arena.width; x += GRID) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, arena.height);
  }
  for (let y = GRID; y < arena.height; y += GRID) {
    ctx.moveTo(0, y);
    ctx.lineTo(arena.width, y);
  }
  ctx.stroke();

  for (const star of stars) {
    ctx.fillStyle = `rgba(255,255,255,${star.a})`;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = COLORS.border;
  ctx.strokeRect(0.5, 0.5, arena.width - 1, arena.height - 1);
}

function drawShipAt(ctx, x, y, angle, thrusting, timeMs) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  if (thrusting) {
    const length = 14 + 7 * Math.sin(timeMs / 35);
    ctx.fillStyle = COLORS.flame;
    ctx.beginPath();
    ctx.moveTo(-9, -5);
    ctx.lineTo(-9 - length, 0);
    ctx.lineTo(-9, 5);
    ctx.closePath();
    ctx.fill();
  }

  ctx.beginPath();
  ctx.moveTo(18, 0);
  ctx.lineTo(-12, -11);
  ctx.lineTo(-6, 0);
  ctx.lineTo(-12, 11);
  ctx.closePath();
  ctx.fillStyle = COLORS.ship;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = COLORS.accent;
  ctx.stroke();
  ctx.restore();
}

/** Draws the ship plus ghost copies when it straddles an arena edge. */
export function drawShip(ctx, ship, arena, timeMs) {
  const margin = 30;
  for (const ox of [-arena.width, 0, arena.width]) {
    for (const oy of [-arena.height, 0, arena.height]) {
      const x = ship.x + ox;
      const y = ship.y + oy;
      if (x < -margin || x > arena.width + margin || y < -margin || y > arena.height + margin) {
        continue;
      }
      drawShipAt(ctx, x, y, ship.angle, ship.thrust, timeMs);
    }
  }
}

export function drawHud(ctx, stats, meta) {
  const lines = [
    [`steps/s   ${stats.stepsPerSec.toFixed(1)}`, COLORS.text],
    [`frames/s  ${stats.framesPerSec.toFixed(1)}`, COLORS.text],
    [
      `frame     ${stats.frameMs.toFixed(1)} ms  (σ ${stats.jitterMs.toFixed(2)}, max ${stats.maxFrameMs.toFixed(1)})`,
      stats.frameMs > FRAME_BUDGET_MS * 1.5 ? COLORS.warn : COLORS.text,
    ],
    [`work      ${stats.workMs.toFixed(2)} ms`, COLORS.text],
    [`mode      ${meta.mode}`, COLORS.muted],
    [`arrows / WASD to fly`, COLORS.muted],
  ];
  if (meta.autoResult) lines.push([meta.autoResult, COLORS.accent]);

  ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textBaseline = "top";
  lines.forEach(([text, color], i) => {
    ctx.fillStyle = color;
    ctx.fillText(text, 16, 16 + i * 18);
  });
}
