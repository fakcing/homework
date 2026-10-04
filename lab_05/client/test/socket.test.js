import assert from "node:assert/strict";
import { test } from "node:test";
import { ReconnectingSocket } from "../src/net/socket.js";

class FakeWS extends EventTarget {
  static instances = [];
  sent = [];
  constructor(url) {
    super();
    this.url = url;
    FakeWS.instances.push(this);
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close(code = 1000) {
    this.fire("close", { code, reason: "" });
  }
  fire(type, props = {}) {
    this.dispatchEvent(Object.assign(new Event(type), props));
  }
}

function setup(options = {}) {
  FakeWS.instances = [];
  const timers = [];
  const socket = new ReconnectingSocket("ws://x/ws", {
    WebSocketImpl: FakeWS,
    baseMs: 100,
    maxMs: 400,
    random: () => 1,
    schedule: (fn, ms) => timers.push({ fn, ms }),
    ...options,
  });
  socket.connect();
  return { socket, timers, ws: () => FakeWS.instances.at(-1) };
}

test("send() queues while offline and flushes after the `join` sent from the open handler", () => {
  const { socket, ws } = setup();
  socket.addEventListener("open", () => socket.send({ type: "join" }));
  assert.equal(socket.send({ type: "chat", text: "early" }), false);
  ws().fire("open");
  assert.deepEqual(
    ws().sent.map((m) => m.type),
    ["join", "chat"],
  );
});

test("reconnect delay grows exponentially, is capped, and resets after a successful open", () => {
  const { timers, ws } = setup();
  for (let i = 0; i < 4; i++) ws().fire("close", { code: 1006 }) || timers.at(-1).fn();
  assert.deepEqual(
    timers.map((t) => t.ms),
    [100, 200, 400, 400],
  );
  ws().fire("open");
  ws().fire("close", { code: 1006 });
  assert.equal(timers.at(-1).ms, 100);
});

test("no reconnect after a user close or a final (policy) close code", () => {
  const a = setup();
  a.ws().fire("close", { code: 4004 });
  assert.equal(a.timers.length, 0);
  const b = setup();
  b.ws().fire("open");
  b.socket.close();
  assert.equal(b.timers.length, 0);
});
