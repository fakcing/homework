import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import type { Config } from "./config.js";
import type { Logger } from "./logger.js";
import { MATCH_FILE_RE, listMatches, streamReplay } from "./matchlog.js";
import type { RoomRegistry } from "./registry.js";
import type { Room } from "./room.js";

const MIME: Readonly<Record<string, string>> = {
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
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Body of POST /api/rooms: the schema validates it and the handler gets typed values. */
const CreateRoomBody = z.object({
  name: z.string().trim().min(1).max(24),
  max: z.number().int().min(2).max(16).optional(),
});

/** Maps a URL path to a file under `root`, or null for anything that could escape it. */
export function resolveStaticPath(root: string, urlPath: string): string | null {
  let decoded: string;
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

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
    ...headers,
  });
  res.end(data);
}

/** The request body is `unknown` until a schema says otherwise. */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "payload too large");
    chunks.push(buf);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

const publicRoom = (r: Room) => ({
  id: r.id,
  name: r.name,
  players: r.size,
  max: r.max,
  arena: r.arena,
  seed: r.seed,
});

export interface HttpDeps {
  readonly config: Config;
  readonly registry: RoomRegistry;
  readonly logger: Logger;
  readonly sockets: () => number;
}

export function createRequestHandler({
  config,
  registry,
  logger,
  sockets,
}: HttpDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const allow = (req: IncomingMessage, ...methods: string[]): void => {
    if (!methods.includes(req.method ?? ""))
      throw new HttpError(405, `use ${methods.join(" or ")}`);
  };

  async function serveStatic(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<void> {
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

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");

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
      const body = CreateRoomBody.safeParse(await readJsonBody(req));
      if (!body.success) throw new HttpError(400, body.error.issues[0]?.message ?? "invalid body");
      try {
        const room = registry.create(
          body.data.max === undefined ? { name: body.data.name } : body.data,
        );
        return sendJson(res, 201, publicRoom(room), { Location: `/api/rooms/${room.id}` });
      } catch (err: unknown) {
        throw new HttpError(503, err instanceof Error ? err.message : "cannot create room");
      }
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
    } catch (err: unknown) {
      const status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof Error ? err.message : String(err);
      if (status === 500) logger.error("request failed", { url: req.url, message });
      if (res.headersSent) return void res.destroy();
      sendJson(
        res,
        status,
        { error: status === 500 ? "internal error" : message },
        status === 405 ? { Allow: "GET, POST, HEAD" } : {},
      );
    }
  };
}
