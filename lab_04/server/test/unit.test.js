import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ConfigError, loadConfig } from "../src/config.js";
import { resolveStaticPath } from "../src/http.js";
import { createRateLimiter } from "../src/limiter.js";
import { MatchLog, NdjsonTransform } from "../src/matchlog.js";
import { CLOSE, parseMessage } from "../src/protocol.js";
import { RoomRegistry } from "../src/registry.js";
import { Room } from "../src/room.js";
import { trySend } from "../src/send.js";

const frame = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v));
const parse = (v, binary = false) => parseMessage(frame(v), binary, 2048);

test("config: defaults, overrides, and ALL problems reported at once", () => {
  const cfg = loadConfig({ PORT: "8080", LOG_DIR: "/tmp/x" }, "/");
  assert.equal(cfg.port, 8080);
  assert.equal(cfg.logDir, path.resolve("/tmp/x"));
  assert.equal(loadConfig({}).port, 3000);
  assert.throws(
    () => loadConfig({ PORT: "99999", LOG_DIR: " ", RATE_PER_SEC: "abc" }),
    (e) => e instanceof ConfigError && e.problems.length === 3,
  );
});

test("static paths: traversal, encoded traversal, NUL and bad escapes are rejected", () => {
  const root = path.resolve("/srv/dist");
  assert.equal(resolveStaticPath(root, "/"), path.join(root, "index.html"));
  assert.equal(resolveStaticPath(root, "/assets/a.png"), path.join(root, "assets", "a.png"));
  for (const bad of [
    "/../secret",
    "/a/../../secret",
    "/%2e%2e/secret",
    "/a%5c..%5csecret",
    "/x%00",
    "/%E0%A4%A",
  ]) {
    assert.equal(resolveStaticPath(root, bad), null, bad);
  }
});

test("protocol: valid messages are sanitized, everything else maps to a close code", () => {
  assert.deepEqual(parse({ type: "join", room: "abc", name: " Ann ", evil: 1 }).msg, {
    type: "join",
    room: "abc",
    name: "Ann",
  });
  assert.equal(parse("{nope").code, CLOSE.INVALID_PAYLOAD);
  assert.equal(parse("[1]").code, CLOSE.POLICY);
  assert.equal(parse({ type: "teleport" }).code, CLOSE.POLICY);
  assert.equal(
    parse({ type: "constructor" }).code,
    CLOSE.POLICY,
    "prototype keys are not message types",
  );
  assert.equal(parse({ type: "chat", text: "" }).code, CLOSE.POLICY);
  assert.equal(parse({ type: "chat", text: "x".repeat(201) }).code, CLOSE.POLICY);
  assert.equal(parse({ type: "join", room: "../x", name: "Ann" }).code, CLOSE.POLICY);
  assert.equal(parse({ type: "chat", text: "x".repeat(3000) }).code, CLOSE.TOO_BIG);
  assert.equal(parse({ type: "leave" }, true).code, CLOSE.UNSUPPORTED);
});

test("rate limiter: burst, then refill over time (fake clock)", () => {
  let t = 0;
  const limiter = createRateLimiter({ perSecond: 5, now: () => t });
  assert.deepEqual(
    Array.from({ length: 6 }, () => limiter.take()),
    [true, true, true, true, true, false],
  );
  t = 400; // +2 tokens
  assert.deepEqual([limiter.take(), limiter.take(), limiter.take()], [true, true, false]);
});

test("backpressure: a slow client gets no non-critical messages, critical ones still go out", () => {
  const sent = [];
  const slow = { readyState: 1, bufferedAmount: 1_000_000, send: (d) => sent.push(d) };
  let dropped = 0;
  assert.equal(
    trySend(slow, { type: "chat" }, { maxBuffered: 1000, onDrop: () => dropped++ }),
    false,
  );
  assert.equal(trySend(slow, { type: "welcome" }, { critical: true, maxBuffered: 1000 }), true);
  assert.equal(dropped, 1);
  assert.equal(sent.length, 1);
});

test("Room: events, and an 'error' event without a listener throws (would crash the process)", () => {
  const room = new Room({ id: "r", name: "R", max: 2, arena: {}, seed: 1 });
  const events = [];
  for (const type of ["join", "leave", "empty"]) room.on(type, () => events.push(type));
  const ok = { id: "a", name: "A", send() {} };
  assert.equal(room.add(ok), true);
  assert.equal(room.add({ id: "b", name: "B", send() {} }), true);
  assert.equal(room.add({ id: "c", name: "C", send() {} }), false, "full");
  room.remove("a");
  room.remove("b");
  assert.deepEqual(events, ["join", "join", "leave", "leave", "empty"]);

  const broken = new Room({ id: "x", name: "X", max: 2, arena: {}, seed: 1 });
  broken.add({
    id: "p",
    name: "P",
    send() {
      throw new Error("socket exploded");
    },
  });
  assert.throws(() => broken.broadcast({ type: "chat" }), /socket exploded/); // ERR_UNHANDLED_ERROR path
  let seen = null;
  broken.on("error", (e) => (seen = e));
  broken.broadcast({ type: "chat" });
  assert.equal(seen.message, "socket exploded");
});

test("registry deletes an emptied room and its match log is NDJSON, one event per line", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reg-"));
  const registry = new RoomRegistry({
    logDir: dir,
    maxRooms: 5,
    defaultMax: 4,
    logger: { error() {} },
  });
  const room = registry.create({ name: "Test" });
  assert.equal(registry.size, 1);
  room.add({ id: "a", name: "Ann", send() {} });
  room.chat(room.players()[0], "hi");
  room.remove("a");
  assert.equal(registry.size, 0);
  await registry.flush();
  await new Promise((r) => setTimeout(r, 30));
  const [file] = fs.readdirSync(dir);
  const lines = fs
    .readFileSync(path.join(dir, file), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  assert.deepEqual(
    lines.map((l) => l.type),
    ["room", "join", "chat", "leave"],
  );
});

test("NdjsonTransform + MatchLog: pipeline finishes and the file ends with a newline", async () => {
  const t = new NdjsonTransform();
  const chunks = [];
  t.on("data", (c) => chunks.push(c.toString()));
  t.write({ a: 1 });
  t.end({ b: 2 });
  await new Promise((r) => t.on("end", r));
  assert.equal(chunks.join(""), '{"a":1}\n{"b":2}\n');

  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ml-")), "match-x.ndjson");
  const log = new MatchLog(file);
  for (let i = 0; i < 1000; i++) log.write({ i });
  await log.end();
  assert.equal(fs.readFileSync(file, "utf8").trim().split("\n").length, 1000);
});
