// rss of a server while ONE slow client downloads a big match log: streaming vs read-everything.
//   node scripts/rss-demo.mjs [sizeMb=120]      -> docs/rss.svg + docs/rss-data.json
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NdjsonTransform, streamReplay } from "../src/matchlog.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rssMb = () => Math.round(process.memoryUsage().rss / 1048576);

if (process.argv[2] === "--serve") {
  // child: `--serve <mode> <file>`
  const [, , , mode, file] = process.argv;
  const size = fs.statSync(file).size;
  http
    .createServer((req, res) => {
      if (req.url === "/rss") return void res.end(String(rssMb()));
      if (mode === "stream") return streamReplay(file, size, res); // the real server code path
      const all = fs.readFileSync(file); // naive: the whole file in memory
      res.writeHead(200, { "Content-Length": size });
      res.end(all);
    })
    .listen(0, "127.0.0.1", function () {
      console.log(this.address().port);
    });
} else {
  const sizeMb = Number(process.argv[2]) || 120;
  const file = path.join(os.tmpdir(), `rss-demo-${sizeMb}mb.ndjson`);
  fs.rmSync(file, { force: true });
  {
    const sample = (i) => ({
      t: "2026-01-01T00:00:00.000Z",
      type: "chat",
      id: "a1b2c3d4",
      text: `message number ${i} `.padEnd(60, "x"),
    });
    const total = Math.ceil((sizeMb * 1048576) / (JSON.stringify(sample(0)).length + 1));
    function* events() {
      for (let i = 0; i < total; i++) yield sample(i);
    }
    await pipeline(Readable.from(events()), new NdjsonTransform(), fs.createWriteStream(file));
  }
  const bytes = fs.statSync(file).size;
  console.log(`log file: ${(bytes / 1048576).toFixed(0)} MB`);

  async function measure(mode) {
    const child = spawn(process.execPath, [import.meta.filename, "--serve", mode, file]);
    const port = await new Promise((resolve) =>
      child.stdout.once("data", (d) => resolve(Number(d))),
    );
    const sample = async () => Number(await (await fetch(`http://127.0.0.1:${port}/rss`)).text());
    const points = [[0, await sample()]];
    const t0 = performance.now();
    let downloading = true;
    const sampler = (async () => {
      while (downloading) {
        await sleep(200);
        points.push([+((performance.now() - t0) / 1000).toFixed(1), await sample()]);
      }
    })();
    await new Promise((resolve, reject) =>
      http.get(`http://127.0.0.1:${port}/log`, async (res) => {
        let received = 0;
        for await (const chunk of res) {
          received += chunk.length;
          await sleep(5); // a slow client: ~10 MB/s at best
        }
        received === bytes ? resolve() : reject(new Error(`short download ${received}/${bytes}`));
      }),
    );
    downloading = false;
    await sampler;
    child.kill();
    return points;
  }

  const stream = await measure("stream");
  const naive = await measure("naive");
  const stats = (p) => ({
    min: Math.min(...p.map((x) => x[1])),
    max: Math.max(...p.map((x) => x[1])),
  });
  console.log("stream (pipeline):", stats(stream), " naive (readFileSync):", stats(naive));

  const W = 720,
    H = 360,
    M = { l: 56, r: 20, t: 36, b: 44 };
  const tMax = Math.max(stream.at(-1)[0], naive.at(-1)[0]);
  const yMax = Math.ceil(Math.max(stats(stream).max, stats(naive).max) / 50) * 50;
  const X = (t) => M.l + (t / tMax) * (W - M.l - M.r);
  const Y = (v) => H - M.b - (v / yMax) * (H - M.t - M.b);
  const line = (pts, color) =>
    `<polyline fill="none" stroke="${color}" stroke-width="2.5" points="${pts.map(([t, v]) => `${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join(" ")}"/>`;
  const grid = Array.from({ length: yMax / 50 + 1 }, (_, i) => i * 50)
    .map(
      (v) =>
        `<line x1="${M.l}" x2="${W - M.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#8884" /><text x="${M.l - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="currentColor">${v}</text>`,
    )
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="system-ui,sans-serif" color="#666">
<rect width="${W}" height="${H}" fill="#fff"/>
<text x="${M.l}" y="22" font-size="14" font-weight="600" fill="#222">Server rss while one slow client downloads a ${(bytes / 1048576).toFixed(0)} MB match log</text>${grid}
<text x="${W / 2}" y="${H - 8}" text-anchor="middle" font-size="11" fill="currentColor">seconds</text>
<text x="14" y="${H / 2}" font-size="11" fill="currentColor" transform="rotate(-90 14 ${H / 2})" text-anchor="middle">rss, MB</text>
${line(naive, "#d1342f")}${line(stream, "#1a7f37")}
<rect x="${W - 250}" y="42" width="12" height="3" fill="#1a7f37"/><text x="${W - 232}" y="47" font-size="12" fill="#222">createReadStream → pipeline → res</text>
<rect x="${W - 250}" y="62" width="12" height="3" fill="#d1342f"/><text x="${W - 232}" y="67" font-size="12" fill="#222">readFileSync → res.end(buffer)</text></svg>`;
  const docs = path.join(import.meta.dirname, "..", "..", "docs");
  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(docs, "rss.svg"), svg);
  fs.writeFileSync(
    "docs/rss-data.json",
    JSON.stringify({ sizeMb: Math.round(bytes / 1048576), stream, naive }),
  );
}
