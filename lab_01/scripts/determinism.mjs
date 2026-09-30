// Experiment 3 in Node: same 5 s of held thrust+turn, different frame pacing.
import { createShip } from "../src/sim/ship.js";
import { advance } from "../src/sim/step.js";

const STEP = 1 / 60;
const MAX_FRAME = 0.25;
const input = { isDown: (c) => c === "ArrowUp" || c === "ArrowRight", justPressed: () => false };
const start = () => createShip(640, 360);

function runFixed(frameMs) {
  let ship = start();
  let acc = 0;
  let steps = 0;
  while (steps < 300) {
    acc += Math.min(frameMs / 1000, MAX_FRAME);
    while (acc >= STEP && steps < 300) {
      ship = advance(ship, input, STEP);
      acc -= STEP;
      steps++;
    }
  }
  return { ship, steps };
}

function runVariable(frameMs) {
  let ship = start();
  let time = 0;
  let steps = 0;
  while (time < 5 - 1e-9) {
    const dt = Math.min(frameMs / 1000, MAX_FRAME);
    ship = advance(ship, input, dt);
    time += dt;
    steps++;
  }
  return { ship, steps };
}

const frames = [
  ["60 Hz (16.67 ms)", 1000 / 60],
  ["144 Hz (6.94 ms)", 1000 / 144],
  ["slow (100 ms)", 100],
  ["hitch (400 ms, clamped to 250)", 400],
];

for (const [title, runner] of [
  ["FIXED step", runFixed],
  ["VARIABLE step", runVariable],
]) {
  console.log(`\n${title}`);
  for (const [label, ms] of frames) {
    const { ship, steps } = runner(ms);
    const pos = `x=${ship.x.toFixed(6)}  y=${ship.y.toFixed(6)}`;
    console.log(`  ${label.padEnd(32)} steps=${String(steps).padStart(3)}  ${pos}`);
  }
}
