// Headless two-client experiments against the REAL server (in-process). `node scripts/netlab.mjs [--quick]`
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import WebSocket from "ws";
import { BUTTON } from "@dogfight/shared";
import { createApp } from "../../server/src/app.js";
import { loadConfig } from "../../server/src/config.js";
import { GameSession } from "../src/net/session.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "netlab-"));
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pct = (list, p) =>
  list.length
    ? [...list].sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor(list.length * p))]
    : 0;

export async function runScenario({
  format = "binary",
  predict = true,
  lagMs = 0,
  jitterMs = 0,
  lossPct = 0,
  chaos = 0,
  interpDelayMs = 100,
  seconds = 3,
  seed = 1,
} = {}) {
  const app = createApp(
    loadConfig({
      PORT: "0",
      HOST: "127.0.0.1",
      LOG_STDOUT: "0",
      LOG_DIR: tmp(),
      CLIENT_DIST: tmp(),
    }),
  );
  const port = await app.start();
  const post = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Lab" }),
  };
  const room = await (await fetch(`http://127.0.0.1:${port}/api/rooms`, post)).json();

  let buttons = 0;
  const make = (name, extra, read) =>
    new GameSession({
      url: `ws://127.0.0.1:${port}/ws`,
      room,
      name,
      WebSocketImpl: WebSocket,
      format,
      readButtons: read,
      ...extra,
    });
  const a = make(
    "Subject",
    { predict, lagMs, jitterMs, lossPct, chaos, interpDelayMs, random: rng(seed) },
    () => buttons,
  );
  const b = make("Opponent", {}, () => BUTTON.THRUST | BUTTON.LEFT);
  const timers = [setInterval(() => a.step(), 1000 / 30), setInterval(() => b.step(), 1000 / 30)];
  a.connect();
  b.connect();
  while (a.slot === null || b.slot === null) await sleep(10);
  await sleep(1200); // idle: the subject stands still

  const me = () => a.view(1, performance.now()).ships.find((s) => s.id === a.slot);
  const start = me();
  const t0 = performance.now();
  buttons = BUTTON.THRUST;
  let inputLatencyMs = null;
  while (performance.now() - t0 < 2000 && inputLatencyMs === null) {
    await sleep(2);
    const s = me();
    if (s && start && Math.hypot(s.x - start.x, s.y - start.y) > 0.3)
      inputLatencyMs = performance.now() - t0;
  }

  // measured phase: circle + fire
  const corrections = [];
  a.addEventListener("reconcile", ({ detail }) => corrections.push(detail.magnitude));
  let starved = 0;
  let frames = 0;
  const probe = setInterval(() => {
    frames++;
    const latest = a.buffer.latest;
    if (latest && a.renderTick(performance.now()) > latest.tick) starved++;
  }, 16);
  const snaps0 = a.stats.snapshots;
  const t1 = performance.now();
  for (let i = 0; performance.now() - t1 < seconds * 1000; i++) {
    buttons = BUTTON.THRUST | BUTTON.RIGHT | (i % 2 ? BUTTON.FIRE : 0);
    await sleep(500);
  }
  const elapsed = (performance.now() - t1) / 1000;
  const g = a.netgraph(performance.now());
  clearInterval(probe);
  timers.forEach(clearInterval);
  const dropped = app.ws.dropped;
  const game = [...app.registry.list()][0]?.game;
  const result = {
    inputLatencyMs: Math.round(inputLatencyMs ?? -1),
    meanCorrection: corrections.reduce((s, v) => s + v, 0) / (corrections.length || 1),
    p95Correction: pct(corrections, 0.95),
    maxCorrection: Math.max(0, ...corrections),
    inBps: Math.round(g.inBps),
    outBps: Math.round(g.outBps),
    snapshotsPerSec: (a.stats.snapshots - snaps0) / elapsed,
    starvedPct: (100 * starved) / (frames || 1),
    rttMs: Math.round(g.rttMs),
    droppedInputs: game?.stats.droppedInputs ?? 0,
    droppedSnapshots: dropped,
  };
  a.close();
  b.close();
  await app.stop();
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const seconds = process.argv.includes("--quick") ? 2 : 4;
  const row = (label, r, cols) => `| ${label} | ${cols.map((c) => c(r)).join(" | ")} |`;
  const f = (n, d = 2) => n.toFixed(d);
  const run = async (title, head, scenarios, cols) => {
    console.log(
      `\n### ${title}\n\n| сценарій | ${head.join(" | ")} |\n| --- | ${head.map(() => "---").join(" | ")} |`,
    );
    for (const [label, opts] of scenarios)
      console.log(row(label, await runScenario({ seconds, ...opts }), cols));
  };
  await run(
    "Поправки (px) і трафік",
    ["середня", "p95", "макс", "↓ B/s", "↑ B/s", "RTT мс"],
    [
      ["binary, lag 0", {}],
      ["json, lag 0", { format: "json" }],
      ["binary, RTT 100", { lagMs: 100 }],
      ["binary, RTT 100 ±20", { lagMs: 100, jitterMs: 20 }],
      ["binary, RTT 100 ±20, loss 5%", { lagMs: 100, jitterMs: 20, lossPct: 5 }],
      ["chaos 2, RTT 100", { chaos: 2, lagMs: 100 }],
      ["chaos 10, RTT 100", { chaos: 10, lagMs: 100 }],
      ["chaos 50, RTT 100", { chaos: 50, lagMs: 100 }],
    ],
    [
      (r) => f(r.meanCorrection),
      (r) => f(r.p95Correction),
      (r) => f(r.maxCorrection),
      (r) => r.inBps,
      (r) => r.outBps,
      (r) => r.rttMs,
    ],
  );
  await run(
    "Від натискання до руху свого корабля на екрані",
    ["мс"],
    [
      ["без передбачення, RTT 100", { predict: false, lagMs: 100 }],
      ["передбачення, RTT 100", { lagMs: 100 }],
      ["без передбачення, RTT 0", { predict: false }],
    ],
    [(r) => r.inputLatencyMs],
  );
  await run(
    "Затримка інтерполяції (RTT 100 ±40, loss 3%)",
    ["знімків/с", "кадрів без знімка %"],
    [
      ["33 мс (1 тік)", { interpDelayMs: 33 }],
      ["66 мс (2 тіки)", { interpDelayMs: 66 }],
      ["100 мс (3 тіки)", { interpDelayMs: 100 }],
      ["150 мс (4.5 тіка)", { interpDelayMs: 150 }],
    ].map(([l, o]) => [l, { lagMs: 100, jitterMs: 40, lossPct: 3, ...o }]),
    [(r) => f(r.snapshotsPerSec, 1), (r) => f(r.starvedPct, 1)],
  );
  process.exit(0);
}
