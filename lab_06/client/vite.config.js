import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const flaky = new Map();

/** Dev-only fault injection for the Lab 3 failure gallery; everything else goes to the real server. */
function devFaults() {
  return {
    name: "dev-faults",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, "http://localhost");
        if (url.pathname === "/api/rooms" && url.searchParams.has("fault")) {
          const fault = url.searchParams.get("fault");
          if (fault === "timeout") return void setTimeout(() => res.end(), 60000);
          if (fault === "500") return void res.writeHead(500).end("boom");
          return void res
            .writeHead(200, { "Content-Type": "application/json" })
            .end('{"rooms": [ {"id": "alpha", ');
        }
        if (url.pathname.startsWith("/assets/")) {
          if (!fs.existsSync(path.join(server.config.publicDir, url.pathname))) {
            return void res.writeHead(404).end("not found"); // not Vite's SPA fallback (200 + index.html)
          }
          const delay = Number(url.searchParams.get("delay")) || 0;
          if (delay) await sleep(delay);
          const failFirst = Number(url.searchParams.get("flaky")) || 0;
          if (failFirst) {
            const n = (flaky.get(req.url) ?? 0) + 1;
            flaky.set(req.url, n);
            if (n <= failFirst) return void res.writeHead(503).end("try later");
          }
        }
        next();
      });
    },
  };
}

const API = "http://127.0.0.1:3000"; // 127.0.0.1, not "localhost": Node may resolve that to ::1

export default defineConfig({
  plugins: [devFaults()],
  server: {
    proxy: {
      "/api": API,
      "/health": API,
      "/ws": { target: API, ws: true },
    },
  },
});
