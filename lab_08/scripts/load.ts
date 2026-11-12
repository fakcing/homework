import { performance } from "node:perf_hooks";
import WebSocket from "ws";

const counts = [8, 32, 64, 128];
const base = process.env.SERVER_URL ?? "ws://127.0.0.1:3000";
const seconds = Number(process.env.LOAD_SECONDS ?? 3);

async function run(count: number): Promise<{ clients: number; p95Ms: number; over33: boolean }> {
  const sockets: WebSocket[] = [];
  const samples: number[] = [];
  const room = `load-${count}`;
  for (let i = 0; i < count; i++) {
    const socket = new WebSocket(`${base}/ws`);
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => {
        socket.send(JSON.stringify({ type: "join", room, name: `bot-${i}` }));
        resolve();
      });
      socket.once("error", reject);
    });
  }
  const end = performance.now() + seconds * 1000;
  let tick = 0;
  while (performance.now() < end) {
    const started = performance.now();
    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: "input", seq: ++tick, buttons: 1 }));
    }
    samples.push(performance.now() - started);
    await new Promise((resolve) => setTimeout(resolve, 33));
  }
  for (const socket of sockets) socket.close();
  samples.sort((a, b) => a - b);
  const p95Ms = samples[Math.floor(samples.length * 0.95)] ?? 0;
  return { clients: count, p95Ms, over33: p95Ms > 33 };
}

console.log("clients\tp95 input step (ms)\tstep > 33ms");
for (const count of counts) {
  try {
    const result = await run(count);
    console.log(`${result.clients}\t${result.p95Ms.toFixed(2)}\t${result.over33 ? "YES" : "no"}`);
    if (result.over33) break;
  } catch (error) {
    console.error(`load ${count} failed:`, error instanceof Error ? error.message : error);
    process.exitCode = 1;
    break;
  }
}
