import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import { BadPayloadError, HttpError } from "../src/assets/errors.js";
import { loadAll } from "../src/assets/loadAll.js";
import { loadBinary, loadJson } from "../src/assets/loaders.js";
import { validateManifest } from "../src/assets/manifest.js";
import { fetchResponse } from "../src/assets/net.js";
import { withRetry } from "../src/assets/retry.js";
import { Lobby } from "../src/lobby/lobby.js";

const hits = new Map();
let server;
let base;

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    hits.set(url.pathname, (hits.get(url.pathname) ?? 0) + 1);
    const delay = Number(url.searchParams.get("delay")) || 0;
    const send = () => {
      if (url.pathname === "/404") return void res.writeHead(404).end();
      if (url.pathname === "/flaky") {
        if (hits.get("/flaky") <= 2) return void res.writeHead(503).end();
        return void res.end('{"ok":true}');
      }
      if (url.pathname === "/broken") return void res.end('{"a": [1, ');
      if (url.pathname === "/hang") return;
      res.end('{"ok":true}');
    };
    delay ? setTimeout(send, delay) : send();
  });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
const reset = () => hits.clear();

test("fetch ok-check: 404 becomes HttpError and is NOT retried", async () => {
  reset();
  await assert.rejects(
    withRetry(() => loadJson(`${base}/404`), { baseMs: 1 }),
    (e) => e instanceof HttpError && e.status === 404,
  );
  assert.equal(hits.get("/404"), 1);
});

test("5xx is retried with backoff until it succeeds", async () => {
  reset();
  const retries = [];
  const value = await withRetry(() => loadJson(`${base}/flaky`), {
    baseMs: 1,
    onRetry: (r) => retries.push(r.attempt),
  });
  assert.deepEqual(value, { ok: true });
  assert.deepEqual(retries, [1, 2]);
  assert.equal(hits.get("/flaky"), 3);
});

test("backoff delays are exponential with full jitter (injected random)", async () => {
  const delays = [];
  const fail = () => Promise.reject(new HttpError(503, "x"));
  await assert.rejects(
    withRetry(fail, {
      retries: 3,
      baseMs: 100,
      maxMs: 250,
      random: () => 0.5,
      sleep: async (ms) => delays.push(ms),
    }),
  );
  assert.deepEqual(delays, [50, 100, 125]); // 0.5 * min(250, 100 * 2^n)
});

test("timeout -> TimeoutError; broken JSON -> BadPayloadError (no retry)", async () => {
  reset();
  await assert.rejects(
    fetchResponse(`${base}/hang`, { timeoutMs: 40 }),
    (e) => e.name === "TimeoutError",
  );
  await assert.rejects(
    withRetry(() => loadJson(`${base}/broken`)),
    (e) => e instanceof BadPayloadError,
  );
  assert.equal(hits.get("/broken"), 1);
});

test("abort in the middle stops the request and is never retried", async () => {
  reset();
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(
    withRetry(() => loadJson(`${base}/hang`, { signal: controller.signal }), {
      signal: controller.signal,
    }),
    (e) => e.name === "AbortError",
  );
  assert.equal(hits.get("/hang"), 1);
});

const manifest = (n, path = "/ok") => ({
  assets: Array.from({ length: n }, (_, i) => ({
    key: `a${i}`,
    type: "json",
    src: `${base}${path}?delay=80&i=${i}`,
  })),
});

test("concurrent loadAll is much faster than sequential", async () => {
  const seq = await loadAll(manifest(5), { mode: "sequential" });
  const par = await loadAll(manifest(5), { mode: "concurrent" });
  assert.ok(seq.ms > 5 * 80 - 10, `sequential ${seq.ms}`);
  assert.ok(par.ms < seq.ms / 2, `concurrent ${par.ms} vs ${seq.ms}`);
});

test("loadAll reports progress per file and fails fast, aborting siblings", async () => {
  reset();
  const events = [];
  const bad = {
    assets: [
      ...manifest(3).assets,
      { key: "bad", type: "json", src: `${base}/404` },
      { key: "slow", type: "json", src: `${base}/hang` },
    ],
  };
  await assert.rejects(
    loadAll(bad, { onProgress: (e) => events.push(`${e.key}:${e.status}`) }),
    HttpError,
  );
  assert.ok(events.includes("bad:failed"));
  assert.ok(!events.includes("slow:failed"), "aborted sibling is not reported as a failure");
});

test("optional assets may fail (skipped); required ones may not", async () => {
  const m = {
    assets: [
      { key: "a", type: "json", src: `${base}/ok` },
      { key: "snd", type: "json", src: `${base}/404`, required: false },
    ],
  };
  const { assets, failed } = await loadAll(m);
  assert.deepEqual(Object.keys(assets), ["a"]);
  assert.equal(failed[0].key, "snd");
});

test("manifest validation rejects malformed manifests", () => {
  assert.throws(
    () => validateManifest({ assets: [{ key: "x", type: "video", src: "/x" }] }),
    BadPayloadError,
  );
  assert.throws(() => validateManifest({}), BadPayloadError);
});

test("Lobby polls on an interval, aborts on stop(), and treats timeouts as errors", async () => {
  let calls = 0;
  const signals = [];
  const room = { id: "r", name: "R", players: 0, max: 4, arena: { width: 100, height: 100 } };
  const lobby = new Lobby({
    intervalMs: 20,
    timeoutMs: 1000,
    fetchRooms: async ({ signal }) => (signals.push(signal), calls++, [room]),
  });
  lobby.start();
  await new Promise((r) => setTimeout(r, 90));
  assert.ok(calls >= 3, `polled ${calls} times`);
  assert.equal(lobby.status, "ready");
  lobby.stop();
  const after = calls;
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(calls, after, "no polling after stop()");

  const hanging = new Lobby({
    intervalMs: 1000,
    timeoutMs: 30,
    fetchRooms: ({ signal }) =>
      new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
  });
  hanging.start();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(hanging.status, "error");
  assert.equal(hanging.error.name, "TimeoutError");
  hanging.stop();
});

test("Lobby.stop() aborts the in-flight request without raising an error status", async () => {
  let seen;
  const lobby = new Lobby({ fetchRooms: ({ signal }) => ((seen = signal), new Promise(() => {})) });
  lobby.start();
  lobby.stop();
  assert.equal(seen.aborted, true);
  assert.notEqual(lobby.status, "error");
});

test("Lobby.join validates name and room, then emits `join`", async () => {
  const rooms = [
    { id: "a", name: "A", players: 1, max: 4, arena: { width: 10, height: 10 } },
    { id: "f", name: "F", players: 2, max: 2, arena: { width: 10, height: 10 } },
  ];
  const lobby = new Lobby({ fetchRooms: async () => rooms });
  lobby.start();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(lobby.join("Ann").ok, false, "no room selected");
  assert.equal(lobby.select("f"), false, "full room");
  assert.equal(lobby.select("a"), true);
  assert.equal(lobby.join("<script>").ok, false);
  let joined = null;
  lobby.addEventListener("join", (e) => (joined = e.detail));
  assert.equal(lobby.join("  Ann  ").ok, true);
  assert.equal(joined.name, "Ann");
  assert.equal(joined.room.id, "a");
  lobby.stop();
});

test("binary loader returns bytes", async () => {
  const bytes = await loadBinary(`${base}/ok`);
  assert.ok(bytes.byteLength > 0);
});
