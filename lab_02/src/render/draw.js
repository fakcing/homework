import { TAU, createRng } from "../math.js";

export const COLORS = {
  bg: "#0a0a0f",
  grid: "rgba(255,255,255,0.045)",
  border: "rgba(255,255,255,0.18)",
  text: "rgba(245,245,247,0.86)",
  muted: "rgba(245,245,247,0.5)",
  accent: "#0a84ff",
  warn: "#ff453a",
  good: "#30d158",
};
const GRID = 80;
const FRAME_BUDGET_MS = 1000 / 60;
const FONT = "12px ui-monospace, SFMono-Regular, Menlo, monospace";

export function createStars(arena, count = 90, seed = 1337) {
  const rnd = createRng(seed);
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
    ctx.arc(star.x, star.y, star.r, 0, TAU);
    ctx.fill();
  }
  ctx.strokeStyle = COLORS.border;
  ctx.strokeRect(0.5, 0.5, arena.width - 1, arena.height - 1);
}

/** Loop diagnostics (steps/s, frames/s, frame time) from Lab 1, top-left. */
export function drawHud(ctx, stats, mode) {
  const lines = [
    [`steps/s   ${stats.stepsPerSec.toFixed(1)}`, COLORS.text],
    [`frames/s  ${stats.framesPerSec.toFixed(1)}`, COLORS.text],
    [
      `frame     ${stats.frameMs.toFixed(1)} ms (σ ${stats.jitterMs.toFixed(2)})`,
      stats.frameMs > FRAME_BUDGET_MS * 1.5 ? COLORS.warn : COLORS.text,
    ],
    [mode, COLORS.muted],
    ["arrows/WASD fly · Space fire", COLORS.muted],
  ];
  ctx.font = FONT;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  lines.forEach(([text, color], i) => {
    ctx.fillStyle = color;
    ctx.fillText(text, 16, 16 + i * 18);
  });
}

/** Game HUD: score, hit points, homing ammo timer, respawn countdown. */
export function drawGameHud(ctx, view, game, maxHp) {
  const right = view.cssWidth - 16;
  const hp = game.ship.hp;
  const lines = [
    [`SCORE ${String(game.score).padStart(6, "0")}`, COLORS.text],
    [`HP ${"♥".repeat(hp)}${"♡".repeat(maxHp - hp)}`, hp <= 1 ? COLORS.warn : COLORS.text],
  ];
  if (game.ship.homingLeft > 0) {
    lines.push([`HOMING ${game.ship.homingLeft.toFixed(1)}s`, COLORS.accent]);
  }
  ctx.font = "14px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textBaseline = "top";
  ctx.textAlign = "right";
  lines.forEach(([text, color], i) => {
    ctx.fillStyle = color;
    ctx.fillText(text, right, 16 + i * 20);
  });

  if (game.respawnIn > 0) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "20px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = COLORS.warn;
    ctx.fillText(
      `Ship destroyed — respawn in ${game.respawnIn.toFixed(1)}s`,
      view.cssWidth / 2,
      view.cssHeight / 2,
    );
  }
}
