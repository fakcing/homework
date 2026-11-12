// A) a 300 ms synchronous handler stalls every other request.  B) an 'error' event nobody listens to.
import { spawn, spawnSync } from "node:child_process";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The server runs in a CHILD process: if client and server shared one event loop, the block would
// freeze the client's timers too and the measurement would be meaningless.
const serverCode = `
  import http from "node:http";
  import { monitorEventLoopDelay } from "node:perf_hooks";
  const lag = monitorEventLoopDelay({ resolution: 10 }); lag.enable();
  const busy = (ms) => { for (const end = performance.now() + ms; performance.now() < end; ); };
  http.createServer((req, res) => {
    if (req.url === "/block") busy(300);            // synchronous work: nothing else can run
    res.end(req.url === "/lag" ? String(Math.round(lag.max / 1e6)) : "ok");
  }).listen(0, "127.0.0.1", function () { console.log(this.address().port); });
`;
const child = spawn(process.execPath, ["--input-type=module", "-e", serverCode]);
const port = await new Promise((resolve) => child.stdout.once("data", (d) => resolve(Number(d))));
const url = (p) => `http://127.0.0.1:${port}${p}`;
const timed = async (label, path) => {
  const t = performance.now();
  await fetch(url(path));
  return `${label}: ${Math.round(performance.now() - t)} ms`;
};
await fetch(url("/fast")); // warm-up

const calm = await Promise.all([1, 2, 3].map((i) => timed(`/fast #${i} (no blocking)`, "/fast")));
const jobs = [timed("/block", "/block")];
for (let i = 1; i <= 3; i++) {
  await sleep(40);
  jobs.push(timed(`/fast #${i} (sent ${i * 40} ms after /block)`, "/fast"));
}
const stalled = await Promise.all(jobs);
console.log("A) latency of /fast requests");
[...calm, ...stalled].forEach((l) => console.log("  " + l));
console.log(`  server event-loop delay (max): ${await (await fetch(url("/lag"))).text()} ms`);
child.kill();

const run = (code) =>
  spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    encoding: "utf8",
    timeout: 3000,
  });
const header = `import { EventEmitter } from "node:events"; const room = new EventEmitter();
 const t = setInterval(() => console.log("  tick"), 40); setTimeout(() => { clearInterval(t); }, 300);`;
const bad = run(`${header} setTimeout(() => room.emit("error", new Error("send failed")), 100);`);
console.log("B) emit('error') with NO listener");
console.log(
  `  exit code ${bad.status}; ticks printed: ${(bad.stdout.match(/tick/g) ?? []).length}; stderr: ${bad.stderr
    .split("\n")
    .find((l) => l.includes("Error"))
    .trim()}`,
);
const good = run(
  `${header} room.on("error", (e) => console.log("  handled:", e.message)); setTimeout(() => room.emit("error", new Error("send failed")), 100);`,
);
console.log("   same, WITH a listener");
console.log(
  `  exit code ${good.status}; ticks printed: ${(good.stdout.match(/tick/g) ?? []).length}; ${good.stdout
    .split("\n")
    .find((l) => l.includes("handled"))
    .trim()}`,
);
