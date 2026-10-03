import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { MATCH_FILE_RE, listMatches, streamReplay } from "./matchlog.js";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".wav": "audio/wav",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};
const MAX_BODY_BYTES = 4096;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Maps a URL path to a file under `root`, or null for anything that could escape it. */
export function resolveStaticPath(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null; // malformed %-escape
  }
  if (decoded.includes("\0") || decoded.split(/[\\/]+/).includes("..")) return null;
  const target = path.join(root, decoded === "/" ? "index.html" : decoded);
  const rel = path.relative(root, target);
  return rel.startsWith("..") || path.isAbsolute(rel) ? null : target;
}

function sendJson(res, status, body, headers = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
    ...headers,
  });
  res.end(data);
}

async function readJsonBody(req) {
  if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "payload too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

const publicRoom = (r) => ({
  id: r.id,
  name: r.name,
  players: r.size,
  max: r.max,
  arena: r.arena,
  seed: r.seed,
});

export function createRequestHandler({ config, registry, logger, sockets }) {
  const allow = (req, ...methods) => {
    if (!methods.includes(req.method)) throw new HttpError(405, `use ${methods.join(" or ")}`);
  };

  async function serveStatic(req, res, pathname) {
    allow(req, "GET", "HEAD");
    const file = resolveStaticPath(config.clientDist, pathname);
    if (!file) throw new HttpError(400, "bad path");
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) throw new HttpError(404, "not found");
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream",
      "Content-Length": info.size,
      "X-Content-Type-Options": "nosniff",
    });
    if (req.method === "HEAD") return void res.end();
    await pipeline(createReadStream(file), res);
  }

  async function route(req, res) {
    const { pathname } = new URL(req.url, "http://localhost");

    if (pathname === "/health") {
      allow(req, "GET");
      return sendJson(res, 200, {
        status: "ok",
        uptimeSec: Math.round(process.uptime()),
        rooms: registry.size,
        sockets: sockets(),
        rssMb: Math.round(process.memoryUsage().rss / 1048576),
      });
    }
    if (pathname === "/api/rooms") {
      allow(req, "GET", "POST");
      if (req.method === "GET")
        return sendJson(res, 200, { rooms: registry.list().map(publicRoom) });
      const body = await readJsonBody(req);
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      const max = body?.max ?? registry.defaultMax;
      if (name.length < 1 || name.length > 24)
        throw new HttpError(400, "`name` must be 1–24 characters");
      if (!Number.isInteger(max) || max < 2 || max > 16)
        throw new HttpError(400, "`max` must be an integer in [2, 16]");
      let room;
      try {
        room = registry.create({ name, max });
      } catch (err) {
        throw new HttpError(503, err.message);
      }
      return sendJson(res, 201, publicRoom(room), { Location: `/api/rooms/${room.id}` });
    }
    if (pathname === "/api/matches") {
      allow(req, "GET");
      return sendJson(res, 200, { matches: await listMatches(config.logDir) });
    }
    if (pathname.startsWith("/api/matches/")) {
      allow(req, "GET");
      const name = pathname.slice("/api/matches/".length);
      if (!MATCH_FILE_RE.test(name)) throw new HttpError(400, "bad match name"); // also kills ".."
      const file = path.join(config.logDir, name);
      const info = await stat(file).catch(() => null);
      if (!info) throw new HttpError(404, "no such match");
      return streamReplay(file, info.size, res); // the file is never read into memory
    }
    return serveStatic(req, res, pathname);
  }

  return async (req, res) => {
    try {
      await route(req, res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) logger.error("request failed", { url: req.url, message: err.message });
      if (res.headersSent) return void res.destroy();
      const headers = status === 405 ? { Allow: "GET, POST, HEAD" } : {};
      sendJson(res, status, { error: status === 500 ? "internal error" : err.message }, headers);
    }
  };
}
