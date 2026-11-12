// Sequential await vs Promise.all on the real asset files, behind a local server with fake latency.
import fs from "node:fs";
import http from "node:http";
import { loadAll } from "../src/assets/loadAll.js";
import { loadBinary } from "../src/assets/loaders.js";

const manifest = JSON.parse(fs.readFileSync("public/assets/manifest.json", "utf8"));
const loaders = { json: loadBinary, image: loadBinary, audio: loadBinary }; // bytes only: no DOM in Node

async function bench(latencyMs) {
  const server = http.createServer((req, res) => {
    const file = `public${new URL(req.url, "http://x").pathname}`;
    setTimeout(() => res.end(fs.readFileSync(file)), latencyMs);
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const m = {
    assets: manifest.assets.map((a) => ({ ...a, src: `http://127.0.0.1:${port}${a.src}` })),
  };
  const run = async (mode) => (await loadAll(m, { mode, loaders })).ms;
  await run("concurrent"); // warm-up
  const sequential = await run("sequential");
  const concurrent = await run("concurrent");
  server.close();
  return {
    latencyMs,
    files: m.assets.length,
    sequential: Math.round(sequential),
    concurrent: Math.round(concurrent),
  };
}

console.table(
  await Promise.all([]).then(async () => [await bench(50), await bench(150), await bench(300)]),
);
