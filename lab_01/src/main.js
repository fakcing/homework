import { createInput, createScriptedInput } from "./input.js";
import { createLoop } from "./loop.js";
import { createCanvasView } from "./render/canvas.js";
import { createStars, drawBackground, drawHud, drawShip } from "./render/draw.js";
import { interpolateShip } from "./render/interpolate.js";
import { ARENA } from "./sim/arena.js";
import { createShip } from "./sim/ship.js";
import { advance } from "./sim/step.js";

// Experiment switches:  ?exp=block | interval | variable   ?load=<ms>   ?auto
const params = new URLSearchParams(location.search);
const experiment = params.get("exp");
const extraLoadMs = Number(params.get("load")) || 0;
const autoRun = params.has("auto");
const AUTO_SECONDS = 5;

function busyWait(ms) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    /* burn CPU on purpose: blocks the only thread */
  }
}

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
  const input = autoRun ? createScriptedInput(["ArrowUp", "ArrowRight"]) : createInput(window);
  const stars = createStars(ARENA);

  const variableStep = experiment === "variable";
  const useInterval = experiment === "interval";
  const mode = `${variableStep ? "variable dt" : "fixed 60 Hz"} · ${useInterval ? "setInterval(16)" : "rAF"}${
    experiment === "block" ? " · block/60f" : ""
  }${extraLoadMs ? ` · +${extraLoadMs}ms load` : ""}`;

  let prev = createShip(ARENA.width / 2, ARENA.height / 2);
  let curr = prev;
  let simTime = 0;
  let simSteps = 0;
  let frameCount = 0;
  let autoResult = "";

  function simulate(dt) {
    prev = curr;
    curr = advance(curr, input, dt);
    input.endStep();
    simTime += dt;
    simSteps++;
    if (autoRun && !autoResult && simTime >= AUTO_SECONDS - 1e-9) {
      autoResult = `auto @ ${simTime.toFixed(3)}s / ${simSteps} steps: x=${curr.x.toFixed(4)} y=${curr.y.toFixed(4)}`;
      console.log(`[${experiment ?? "fixed"}] ${autoResult}`);
    }
  }

  function render(alpha, stats) {
    frameCount++;
    if (experiment === "block" && frameCount % 60 === 0) busyWait(100);
    if (extraLoadMs > 0) busyWait(extraLoadMs);

    const { ctx } = screen;
    screen.useScreenSpace();
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, screen.view.cssWidth, screen.view.cssHeight);

    screen.useWorldSpace();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, ARENA.width, ARENA.height);
    ctx.clip();
    drawBackground(ctx, ARENA, stars);
    drawShip(ctx, interpolateShip(prev, curr, alpha, ARENA), ARENA, performance.now());
    ctx.restore();

    screen.useScreenSpace();
    drawHud(ctx, stats, { mode, autoResult });
  }

  createLoop({ simulate, render, variableStep, useInterval, onError: showError }).start();
}

try {
  boot();
} catch (err) {
  showError(err);
}
