import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { BUTTON, Seq, ShipId, addShip, createWorld, stepWorld } from "@dogfight/shared";

const frames: number[] = [];
const world = createWorld(0x07);
for (let i = 0; i < 8; i++) addShip(world, ShipId.parse(i));
const started = performance.now();
for (let tick = 1; tick <= 30 * 30; tick++) {
  const frameStart = performance.now();
  const inputs = new Map(
    Array.from({ length: 8 }, (_, i) => [
      ShipId.parse(i),
      { seq: Seq.parse(tick), buttons: BUTTON.THRUST | (tick % 12 === i ? BUTTON.FIRE : 0) },
    ]),
  );
  stepWorld(world, inputs);
  frames.push(performance.now() - frameStart);
}
frames.sort((a, b) => a - b);
const percentile = (p: number): number => frames[Math.floor((frames.length - 1) * p)] ?? 0;
const report = {
  seconds: 30,
  bots: 8,
  frameMs: {
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: frames.at(-1) ?? 0,
  },
  gcPauseMs: "run node --trace-gc --expose-gc to capture exact pauses",
  bulletPool: world.bulletPool.stats,
  elapsedMs: performance.now() - started,
};
fs.mkdirSync("artifacts", { recursive: true });
fs.writeFileSync("artifacts/profile-after.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
