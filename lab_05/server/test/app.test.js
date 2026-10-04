import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import WebSocket from "ws";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "dogfight-"));
async function startApp(env = {}) {
  const logDir = tmp();
  const dist = tmp();
  fs.writeFileSync(path.join(dist, "index.html"), "<h1>client</h1>");
  const app = createApp(
    loadConfig({
      PORT: "0",
      HOST: "127.0.0.1",
      LOG_STDOUT: "0",
      LOG_DIR: logDir,
      CLIENT_DIST: dist,
      ...env,
    }),
  );
  const port = await app.start();
  return { app, port, base: `http://127.0.0.1:${port}`, logDir };
}

/** A ws client with an inbox: next(type?) resolves with the next (matching) message. */
function connect(port, options) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, options);
  const inbox = [];
  const waiters = [];
  ws.on("message", (d, isBinary) => {
    if (isBinary) return; // binary frames are game snapshots; these tests only look at chat/control
    inbox.push(JSON.parse(d));
    flush();
  });
  const flush = () => waiters.forEach((w) => w());
  const closed = new Promise((resolve) =>
    ws.on("close", (code, reason) => resolve({ code, reason: reason.toString() })),
  );
  ws.on("error", () => {});
  const opened = new Promise((resolve) => ws.on("open", resolve));
  const next = (type) =>
    new Promise((resolve) => {
      const check = () => {
        const i = inbox.findIndex((m) => !type || m.type === type);
        if (i < 0) return false;
        waiters.splice(waiters.indexOf(check), 1);
        resolve(inbox.splice(i, 1)[0]);
        return true;
      };
      if (!check()) waiters.push(check);
    });
  const send = (m) => ws.send(typeof m === "string" ? m : JSON.stringify(m));
  return { ws, next, send, closed, opened };
}

const apps = [];
const boot = async (env) => {
  const s = await startApp(env);
  apps.push(s.app);
  return s;
};
after(() => Promise.all(apps.map((a) => a.stop())));

const json = async (url, init) => {
  const res = await fetch(url, init);
  return { status: res.status, body: await res.json().catch(() => null) };
};

test("HTTP: /health, rooms GET/POST validation, 404/405, static + traversal", async () => {
  const { base, port } = await boot();
  assert.equal((await json(`${base}/health`)).body.status, "ok");
  assert.deepEqual((await json(`${base}/api/rooms`)).body, { rooms: [] });

  const post = (body, headers = { "Content-Type": "application/json" }) =>
    json(`${base}/api/rooms`, { method: "POST", headers, body });
  const created = await post(JSON.stringify({ name: "Alpha" }));
  assert.equal(created.status, 201);
  assert.equal(created.body.players, 0);
  assert.equal((await json(`${base}/api/rooms`)).body.rooms.length, 1);
  assert.equal((await post("{broken")).status, 400);
  assert.equal((await post(JSON.stringify({ name: "" }))).status, 400);
  assert.equal((await post(JSON.stringify({ name: "x", pad: "y".repeat(10000) }))).status, 413);
  assert.equal((await post("name=x", { "Content-Type": "text/plain" })).status, 415);
  assert.equal((await json(`${base}/api/rooms`, { method: "DELETE" })).status, 405);

  const index = await fetch(`${base}/`);
  assert.equal(await index.text(), "<h1>client</h1>");
  assert.equal((await fetch(`${base}/nope.js`)).status, 404);

  // fetch() would normalize "/../", so send the raw request line.
  const raw = (reqPath) =>
    new Promise((resolve) =>
      http.get(
        { host: "127.0.0.1", port, path: reqPath },
        (res) => (res.resume(), resolve(res.statusCode)),
      ),
    );
  // The WHATWG URL parser already collapses "/../" and "%2e%2e", so these never leave the root (404, never 200)...
  assert.equal(await raw("/../package.json"), 404);
  assert.equal(await raw("/%2e%2e/package.json"), 404);
  // ...but an encoded slash survives URL parsing and decodes to "/../": resolveStaticPath must refuse it.
  assert.equal(await raw("/a%2f..%2f..%2fpackage.json"), 400);
  assert.equal(await raw("/api/matches/..%2fserver.log"), 400);
});

async function createRoom(base, name = "Room") {
  return (
    await json(`${base}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
  ).body;
}

test("WS: two players join, chat, leave; the empty room disappears and its log is replayable", async () => {
  const { base, port, app, logDir } = await boot();
  const room = await createRoom(base);
  const a = connect(port);
  const b = connect(port);
  await Promise.all([a.opened, b.opened]);

  a.send({ type: "join", room: room.id, name: "Ann" });
  const welcomeA = await a.next("welcome");
  assert.equal(welcomeA.players.length, 1);
  b.send({ type: "join", room: room.id, name: "Bob" });
  assert.equal((await b.next("welcome")).players.length, 2);
  assert.equal((await a.next("joined")).player.name, "Bob");
  assert.equal((await json(`${base}/api/rooms`)).body.rooms[0].players, 2);

  a.send({ type: "chat", text: "hello" });
  assert.equal((await b.next("chat")).text, "hello");
  assert.equal((await a.next("chat")).name, "Ann");

  b.ws.close(1000);
  assert.ok((await a.next("left")).id);
  a.ws.close(1000);
  await a.closed;
  await until(() => app.registry.size === 0);

  const { matches } = (await json(`${base}/api/matches`)).body;
  assert.equal(matches.length, 1);
  let lines = [];
  await until(async () => {
    const res = await fetch(`${base}/api/matches/${matches[0].name}`); // streamed from disk
    assert.equal(res.headers.get("content-type"), "application/x-ndjson");
    lines = (await res.text())
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l).type);
    return lines.filter((t) => t === "leave").length === 2;
  });
  assert.deepEqual(lines, ["room", "join", "join", "chat", "leave", "leave"]);
  assert.equal((await fetch(`${base}/api/matches/match-nope.ndjson`)).status, 404);
  assert.ok(fs.existsSync(path.join(logDir, matches[0].name)));
});

async function until(check, ms = 1500) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  assert.fail("condition not met in time");
}

test("WS: every protocol violation closes the socket with its own code", async () => {
  const { base, port } = await boot();
  const room = await createRoom(base);
  const cases = [
    ["not JSON", (c) => c.send("{nope"), 1007],
    ["unknown type", (c) => c.send({ type: "teleport" }), 1008],
    ["malformed shape", (c) => c.send({ type: "chat", text: 42 }), 1008],
    ["chat before join", (c) => c.send({ type: "chat", text: "hi" }), 1008],
    ["binary before join", (c) => c.ws.send(Buffer.from([1, 2, 3]), { binary: true }), 1008],
    ["oversized frame", (c) => c.send("x".repeat(5000)), 1009],
    ["unknown room", (c) => c.send({ type: "join", room: "nope", name: "Ann" }), 4004],
    [
      "double join",
      (c) => (
        c.send({ type: "join", room: room.id, name: "Ann" }),
        c.send({ type: "join", room: room.id, name: "Ann" })
      ),
      1008,
    ],
  ];
  for (const [label, act, code] of cases) {
    const c = connect(port);
    await c.opened;
    act(c);
    assert.equal((await c.closed).code, code, label);
  }
});

test("WS: a full room refuses the third player (4003)", async () => {
  const { base, port } = await boot();
  const { body: room } = await json(`${base}/api/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Duo", max: 2 }),
  });
  const players = [connect(port), connect(port), connect(port)];
  await Promise.all(players.map((p) => p.opened));
  for (const [i, p] of players.slice(0, 2).entries()) {
    p.send({ type: "join", room: room.id, name: `P${i}` });
    await p.next("welcome");
  }
  players[2].send({ type: "join", room: room.id, name: "P2" });
  assert.equal((await players[2].closed).code, 4003);
});

test("WS: join must happen within the timeout (4001)", async () => {
  const { port } = await boot({ JOIN_TIMEOUT_MS: "100" });
  const c = connect(port);
  assert.equal((await c.closed).code, 4001);
});

test("WS: more than RATE_PER_SEC messages per second closes with 4002", async () => {
  const { base, port } = await boot({ RATE_PER_SEC: "3" });
  const room = await createRoom(base);
  const c = connect(port);
  await c.opened;
  c.send({ type: "join", room: room.id, name: "Ann" });
  for (let i = 0; i < 12; i++) c.send({ type: "chat", text: `m${i}` });
  assert.equal((await c.closed).code, 4002);
});

test("WS: heartbeat cuts off a client that stops answering pings, keeps a healthy one", async () => {
  const { port, app } = await boot({ PING_INTERVAL_MS: "40" });
  const healthy = connect(port);
  const mute = connect(port, { autoPong: false });
  await Promise.all([healthy.opened, mute.opened]);
  const { code } = await mute.closed; // terminated: no close frame, so 1006
  assert.equal(code, 1006);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(healthy.ws.readyState, WebSocket.OPEN);
  assert.equal(app.ws.count, 1);
});

test(
  "SIGTERM: sockets get 1001, logs are finished, exit code is 0",
  { skip: process.platform === "win32" },
  async () => {
    const logDir = tmp();
    const child = spawn(process.execPath, ["src/index.js"], {
      cwd: path.join(import.meta.dirname, ".."),
      env: { ...process.env, PORT: "0", HOST: "127.0.0.1", LOG_DIR: logDir },
    });
    let out = "";
    const port = await new Promise((resolve) =>
      child.stdout.on("data", (d) => {
        out += d;
        const m = out.match(/"msg":"listening".*?"port":(\d+)/);
        if (m) resolve(Number(m[1]));
      }),
    );
    const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
    await new Promise((r) => setTimeout(r, 100)); // seeded rooms are created right after listen
    const room = (await json(`http://127.0.0.1:${port}/api/rooms`)).body.rooms[0];
    const c = connect(port);
    await c.opened;
    c.send({ type: "join", room: room.id, name: "Ann" });
    await c.next("welcome");
    c.send({ type: "chat", text: "bye" });
    await c.next("chat");

    child.kill("SIGTERM");
    assert.equal((await c.closed).code, 1001);
    assert.equal(await exited, 0);
    const match = fs.readdirSync(logDir).find((f) => f.startsWith("match-"));
    const types = fs
      .readFileSync(path.join(logDir, match), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l).type);
    assert.deepEqual(types, ["room", "join", "chat", "leave"]);
    assert.match(fs.readFileSync(path.join(logDir, "server.log"), "utf8"), /"msg":"stopped"/);
  },
);
