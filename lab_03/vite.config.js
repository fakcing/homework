import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ROOMS = [
  { id: "alpha", name: "Alpha Station", max: 8, arena: { width: 1280, height: 720 }, seed: 11 },
  { id: "nebula", name: "Nebula Run", max: 6, arena: { width: 1600, height: 900 }, seed: 22 },
  { id: "pocket", name: "Pocket Arena", max: 4, arena: { width: 960, height: 540 }, seed: 33 },
  { id: "full", name: "Full House", max: 2, arena: { width: 1280, height: 720 }, seed: 44 },
];
const flaky = new Map();

/** Mock backend for Lab 3 (Lab 4 replaces it): /api/rooms + latency/failure injection for /assets. */
function mockBackend() {
  const makeHandler = (dirOf) => async (req, res, next) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/rooms") {
      const fault = url.searchParams.get("fault");
      if (fault === "timeout") return void setTimeout(() => res.end(), 60000); // never answers in time
      if (fault === "500") {
        res.statusCode = 500;
        return void res.end("boom");
      }
      res.setHeader("Content-Type", "application/json");
      if (fault === "json") return void res.end('{"rooms": [ {"id": "alpha", ');
      const wave = Math.floor(Date.now() / 3000);
      const rooms = ROOMS.map((r, i) => ({
        ...r,
        players: r.id === "full" ? r.max : (wave + i * 2) % (r.max - 1),
      }));
      return void res.end(JSON.stringify({ rooms }));
    }
    if (url.pathname.startsWith("/assets/")) {
      // Vite's SPA fallback would answer 200 + index.html for a missing file; a real server says 404.
      if (!fs.existsSync(path.join(dirOf(), url.pathname))) {
        res.statusCode = 404;
        return void res.end("not found");
      }
      const delay = Number(url.searchParams.get("delay")) || 0;
      if (delay) await sleep(delay);
      const failFirst = Number(url.searchParams.get("flaky")) || 0; // fail the first N requests with 503
      if (failFirst) {
        const n = (flaky.get(req.url) ?? 0) + 1;
        flaky.set(req.url, n);
        if (n <= failFirst) {
          res.statusCode = 503;
          return void res.end("try later");
        }
      }
    }
    next();
  };
  return {
    name: "mock-backend",
    configureServer: (server) =>
      void server.middlewares.use(makeHandler(() => server.config.publicDir)),
    configurePreviewServer: (server) =>
      void server.middlewares.use(makeHandler(() => path.resolve(server.config.build.outDir))),
  };
}

export default defineConfig({ plugins: [mockBackend()] });
