import { createInput } from "./input.js";
import { createLoop } from "./loop.js";
import { createCanvasView } from "./render/canvas.js";
import { createStars, drawBackground, drawGameHud, drawHud } from "./render/draw.js";
import { drawWorld } from "./render/drawWorld.js";
import { ARENA } from "./sim/arena.js";
import { Game } from "./sim/game.js";
import { SHIP } from "./sim/ship.js";

// ?seed=<n> reproducible run · ?debug draws collision circles
const params = new URLSearchParams(location.search);
const seed = Number(params.get("seed")) || Date.now() >>> 0;
const debug = params.has("debug");

function showError(err) {
  console.error(err);
  const el = document.getElementById("error");
  if (el) {
    el.textContent = `Something went wrong:\n\n${err instanceof Error ? err.message : String(err)}`;
    el.classList.add("visible");
  }
}

function boot() {
  const canvas = document.getElementById("game");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("#game canvas not found");

  const screen = createCanvasView(canvas, ARENA);
  const game = new Game({ input: createInput(window), seed });
  const stars = createStars(ARENA);
  const mode = `fixed 60 Hz · rAF · seed ${seed}${debug ? " · debug" : ""}`;

  function render(alpha, stats) {
    const { ctx, view } = screen;
    screen.useScreenSpace();
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, view.cssWidth, view.cssHeight);

    screen.useWorldSpace();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, ARENA.width, ARENA.height);
    ctx.clip();
    drawBackground(ctx, ARENA, stars);
    drawWorld(ctx, game.world, alpha, performance.now(), debug);
    ctx.restore();

    screen.useScreenSpace();
    drawHud(ctx, stats, mode);
    drawGameHud(ctx, view, game, SHIP.maxHp);
  }

  createLoop({ simulate: (dt) => game.step(dt), render, onError: showError }).start();
}

try {
  boot();
} catch (err) {
  showError(err);
}
