import WebSocket from "ws";

const url = process.argv[2] ?? process.env.PUBLIC_WS_URL;
if (!url) {
  console.error("Usage: node scripts/rtt.mjs wss://your-host.example/ws");
  process.exit(2);
}
const ws = new WebSocket(url, { origin: new URL(url).origin.replace("wss:", "https:") });
await new Promise((resolve, reject) => {
  ws.once("open", resolve);
  ws.once("error", reject);
});
const samples = [];
for (let i = 0; i < 20; i++) {
  const started = performance.now();
  await new Promise((resolve, reject) => {
    ws.once("pong", resolve);
    ws.once("error", reject);
    ws.ping();
  });
  samples.push(performance.now() - started);
  await new Promise((resolve) => setTimeout(resolve, 50));
}
ws.close();
samples.sort((a, b) => a - b);
const percentile = (p) => samples[Math.floor((samples.length - 1) * p)];
console.log(
  JSON.stringify(
    {
      url,
      samples: samples.length,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      minMs: samples[0],
      maxMs: samples.at(-1),
    },
    null,
    2,
  ),
);
