import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import WebSocket from "ws";
import {
  BUTTON,
  decodeSnapshot,
  decodeSnapshotJson,
  encodeInput,
  encodeInputJson,
} from "@dogfight/shared";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { RoomGame } from "../src/game.js";
import { createTicker } from "../src/ticker.js";

/** Fake clock: timers fire LATE by `lateMs` every time, like a busy event loop. */
function simulate({ hz, seconds, lateMs }) {
  let t = 0;
  const timers = [];
  const ticker = createTicker({
    hz,
    onTick: () => {},
    now: () => t,
    schedule: (fn, ms) => timers.push({ at: t + ms + lateMs, fn }) && timers.at(-1),
    cancel: () => {},
  });
  ticker.start();
  while (timers.length && t < seconds * 1000) {
    timers.sort((a, b) => a.at - b.at);
    const timer = timers.shift();
    t = timer.at;
    timer.fn();
  }
  return ticker.stats;
}

test("ticker: late timers do not accumulate drift (30 Hz over 10 s stays ~300 ticks)", () => {
  for (const lateMs of [0, 7, 20]) {
    const { ticks } = simulate({ hz: 30, seconds: 10, lateMs });
    assert.ok(ticks >= 298 && ticks <= 301, `lateMs=${lateMs}: ${ticks} ticks`);
  }
  const src = fs
    .readFileSync(new URL("../src/ticker.js", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.doesNotMatch(src, /setInterval/);
});

test("ticker: after a long stall it skips ticks instead of spiralling", () => {
  let t = 0;
  let ran = 0;
  const pending = [];
  const ticker = createTicker({
    hz: 30,
    onTick: () => ran++,
    now: () => t,
    schedule: (fn) => pending.push(fn),
    cancel: () => {},
  });
  ticker.start();
  t = 5000; // the process was frozen for 5 s
  pending.pop()();
  assert.equal(ran, 5, "maxCatchUp ticks only");
  assert.ok(ticker.stats.skipped > 100);
});

test("RoomGame: ignores stale seq, steps a ship only when it has an input, drops a huge backlog", () => {
  const room = Object.assign([], {
    seed: 1,
    id: "r",
    emit() {},
    [Symbol.iterator]: Array.prototype[Symbol.iterator],
  });
  const game = new RoomGame({
    room,
    logger: { error() {} },
    ticker: { schedule: () => 0, cancel: () => {} },
  });
  game.addPlayer(0);
  const x0 = game.world.ships[0].x;
  game.tick();
  assert.equal(game.world.ships[0].x, x0, "no input: not stepped");
  assert.equal(game.stats.stalls, 1);
  assert.equal(game.pushInput(0, { seq: 5, buttons: BUTTON.THRUST }), true);
  assert.equal(game.pushInput(0, { seq: 5, buttons: 0 }), false, "duplicate");
  assert.equal(game.pushInput(0, { seq: 4, buttons: 0 }), false, "stale");
  game.tick();
  assert.equal(game.world.ships[0].lastSeq, 5);
  for (let s = 6; s < 26; s++) game.pushInput(0, { seq: s, buttons: 0 });
  game.tick();
  assert.equal(
    game.world.ships[0].lastSeq,
    23,
    "20 queued: kept the newest 3, applied the oldest of those",
  );
  assert.ok(game.stats.droppedInputs >= 17);
});

// ---- end to end over real sockets ----
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "g5-"));
async function boot() {
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
  const room = await (
    await fetch(`http://127.0.0.1:${port}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Duel" }),
    })
  ).json();
  return { app, port, room };
}

function bot(port, room, name, format) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const snapshots = [];
  const control = [];
  let bytes = 0;
  const closed = new Promise((r) => ws.on("close", (code) => r(code)));
  ws.on("error", () => {});
  ws.on("message", (data, isBinary) => {
    bytes += data.length;
    if (isBinary) snapshots.push(decodeSnapshot(data));
    else {
      const text = data.toString();
      const m = JSON.parse(text);
      m.type === "snapshot" ? snapshots.push(decodeSnapshotJson(text)) : control.push(m);
    }
  });
  const ready = new Promise((r) =>
    ws.on(
      "open",
      () => (ws.send(JSON.stringify({ type: "join", room: room.id, name, format })), r()),
    ),
  );
  return {
    ws,
    snapshots,
    control,
    closed,
    ready,
    get bytes() {
      return bytes;
    },
  };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("e2e: two bots get ~30 snapshots/s; inputs (binary and JSON) move only their own ship; bad packets close", async () => {
  const { app, port, room } = await boot();
  const a = bot(port, room, "Ann", "binary");
  const b = bot(port, room, "Bob", "json");
  try {
    await Promise.all([a.ready, b.ready]);
    await wait(100);
    const welcomeA = a.control.find((m) => m.type === "welcome");
    const welcomeB = b.control.find((m) => m.type === "welcome");
    assert.deepEqual([welcomeA.slot, welcomeB.slot, welcomeA.tickHz], [0, 1, 30]);

    const startTick = a.snapshots.at(-1).tick;
    for (let seq = 1; seq <= 15; seq++) {
      a.ws.send(encodeInput({ seq, buttons: BUTTON.THRUST })); // binary 7-byte input
      b.ws.send(encodeInputJson({ seq, buttons: 0 })); // JSON input
      await wait(33);
    }
    await wait(200);
    const rate = (a.snapshots.at(-1).tick - startTick) / 0.7; // roughly the sending time + wait
    assert.ok(rate > 20 && rate < 40, `snapshot rate ~${rate.toFixed(1)}/s`);
    const last = a.snapshots.at(-1);
    const shipA = last.ships.find((s) => s.id === 0);
    const shipB = last.ships.find((s) => s.id === 1);
    assert.ok(shipA.lastSeq >= 14 && shipB.lastSeq >= 14, "server acknowledged both inputs");
    assert.ok(Math.hypot(shipA.vx, shipA.vy) > 20, "thrusting ship accelerated");
    assert.equal(Math.hypot(shipB.vx, shipB.vy), 0, "idle ship did not");
    assert.ok(
      b.snapshots.length > 5 && typeof b.snapshots[0].tick === "number",
      "JSON bot got JSON snapshots",
    );
    assert.ok(
      b.bytes > a.bytes * 2,
      `JSON stream (${b.bytes} B) is much larger than binary (${a.bytes} B)`,
    );

    a.ws.send(new Uint8Array([9, 9, 9]), { binary: true });
    assert.equal(await a.closed, 1008);
  } finally {
    a.ws.terminate();
    b.ws.terminate();
    await app.stop();
  }
});
