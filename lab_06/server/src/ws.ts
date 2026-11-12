import { randomUUID } from "node:crypto";
import { TICK_HZ, assertNever, decodeInput, ProtocolError } from "@dogfight/shared";
import type { ClientMessage, ServerMessage } from "@dogfight/shared";
import { WebSocketServer } from "ws";
import type { RawData, WebSocket } from "ws";
import type { Server } from "node:http";
import type { Config } from "./config.js";
import type { GameRoom } from "./game.js";
import { createRateLimiter } from "./limiter.js";
import type { RateLimiter } from "./limiter.js";
import type { Logger } from "./logger.js";
import { CLOSE, parseTextFrame } from "./protocol.js";
import type { RoomRegistry } from "./registry.js";
import type { Player } from "./room.js";
import { trySend, trySendSnapshot } from "./send.js";

const OPEN = 1;

interface Session {
  readonly id: string;
  readonly ws: WebSocket;
  readonly limiter: RateLimiter;
  readonly inputLimiter: RateLimiter;
  readonly joinTimer: ReturnType<typeof setTimeout>;
  missed: number;
  room: GameRoom | null;
  player: Player | null;
}

export interface WsApi {
  readonly wss: WebSocketServer;
  readonly count: number;
  readonly dropped: number;
  close(): Promise<void>;
}

const toBuffer = (data: RawData): Buffer =>
  Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);

export function attachWebSocket({
  server,
  registry,
  config,
  logger,
}: {
  server: Server;
  registry: RoomRegistry;
  config: Config;
  logger: Logger;
}): WsApi {
  const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxMessageBytes });
  const sessions = new Set<Session>();
  let dropped = 0;

  server.on("upgrade", (req, socket, head) => {
    if (new URL(req.url ?? "/", "http://localhost").pathname !== "/ws") {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  const send = (ws: WebSocket, message: ServerMessage, critical = false): boolean =>
    trySend(ws, message, {
      critical,
      maxBuffered: config.maxBufferedBytes,
      onDrop: () => dropped++,
    });

  /** Every protocol violation ends here: log it, tell the client why (best effort) and close with the code. */
  function reject(session: Session, code: number, reason: string): void {
    logger.warn("connection rejected", { id: session.id, code, reason });
    send(session.ws, { type: "error", code, message: reason }, true);
    session.ws.close(code, reason);
  }

  function leave(session: Session): void {
    const { room, player } = session;
    if (!room || !player) return;
    session.room = null;
    session.player = null;
    room.remove(player.id);
    room.broadcast({ type: "left", id: player.id, slot: player.slot });
  }

  function join(
    session: Session,
    { room: roomId, name, format }: Extract<ClientMessage, { type: "join" }>,
  ): void {
    const { ws } = session;
    if (session.player) return reject(session, CLOSE.POLICY, "already joined");
    const room = registry.get(roomId);
    if (!room) return reject(session, CLOSE.ROOM_NOT_FOUND, "room not found");
    const slot = room.freeSlot();
    if (slot === null) return reject(session, CLOSE.ROOM_FULL, "room is full");
    const player: Player = {
      id: session.id,
      slot,
      name,
      format,
      send: (message, o) => void send(ws, message, o?.critical),
      sendSnapshot: (data) =>
        void trySendSnapshot(ws, data, {
          maxBuffered: config.maxBufferedBytes,
          onDrop: () => dropped++,
        }),
    };
    if (!room.add(player)) return reject(session, CLOSE.ROOM_FULL, "room is full");
    session.room = room;
    session.player = player;
    clearTimeout(session.joinTimer);
    send(
      ws,
      {
        type: "welcome",
        you: player.id,
        slot,
        format,
        tickHz: TICK_HZ,
        room: { id: room.id, name: room.name, max: room.max },
        players: room.players(),
      },
      true,
    );
    room.broadcast(
      { type: "joined", player: { id: player.id, name, slot } },
      { except: player.id },
    );
  }

  function handle(session: Session, message: ClientMessage): void {
    if (message.type === "join") return join(session, message);
    const { room, player } = session;
    if (!room || !player) return reject(session, CLOSE.POLICY, "join first");
    switch (message.type) {
      case "input":
        room.game.pushInput(player.slot, { seq: message.seq, buttons: message.buttons });
        return;
      case "chat":
        room.chat(player, message.text);
        return;
      case "leave":
        leave(session);
        return;
      default:
        return assertNever(message); // a new ClientMessage variant without a case is a compile error
    }
  }

  /** Binary frames are inputs: 7 bytes, version byte first. The decoder checks length, version and ranges itself. */
  function handleBinary(session: Session, data: Buffer): void {
    if (!session.room || !session.player) return reject(session, CLOSE.POLICY, "join first");
    if (!session.inputLimiter.take())
      return reject(session, CLOSE.RATE_LIMIT, "input rate exceeded");
    try {
      session.room.game.pushInput(session.player.slot, decodeInput(data));
    } catch (err: unknown) {
      if (!(err instanceof ProtocolError)) throw err;
      reject(session, CLOSE.POLICY, err.message);
    }
  }

  wss.on("connection", (ws: WebSocket) => {
    const session: Session = {
      id: randomUUID().slice(0, 8),
      ws,
      missed: 0,
      room: null,
      player: null,
      limiter: createRateLimiter({ perSecond: config.ratePerSec }),
      inputLimiter: createRateLimiter({ perSecond: config.inputRatePerSec }),
      joinTimer: setTimeout(
        () => ws.close(CLOSE.JOIN_TIMEOUT, "join timeout"),
        config.joinTimeoutMs,
      ),
    };
    sessions.add(session);

    ws.on("pong", () => {
      session.missed = 0;
    });
    ws.on("error", (err: Error) =>
      logger.warn("socket error", { id: session.id, message: err.message }),
    ); // required!
    ws.on("message", (data: RawData, isBinary: boolean) => {
      if (ws.readyState !== OPEN) return;
      const buffer = toBuffer(data);
      if (isBinary) return handleBinary(session, buffer);
      const parsed = parseTextFrame(buffer, config.maxMessageBytes);
      if (!parsed.ok) return reject(session, parsed.code, parsed.reason);
      // Inputs (JSON flavour) have their own, higher budget than chat/control messages.
      const limiter = parsed.message.type === "input" ? session.inputLimiter : session.limiter;
      if (!limiter.take()) return reject(session, CLOSE.RATE_LIMIT, "rate limit exceeded");
      handle(session, parsed.message);
    });
    ws.on("close", () => {
      clearTimeout(session.joinTimer);
      sessions.delete(session);
      leave(session);
    });
  });

  // Ping every interval; a client that has not answered two pings in a row is cut off.
  const heartbeat = setInterval(() => {
    for (const session of sessions) {
      if (session.missed >= 2) {
        logger.warn("heartbeat lost", { id: session.id });
        session.ws.terminate();
        continue;
      }
      session.missed++;
      session.ws.ping();
    }
  }, config.pingIntervalMs);
  heartbeat.unref();

  return {
    wss,
    get count() {
      return sessions.size;
    },
    get dropped() {
      return dropped;
    },
    async close() {
      clearInterval(heartbeat);
      const closing = [...sessions].map(
        (s) =>
          new Promise<void>((resolve) => {
            s.ws.once("close", () => resolve());
            s.ws.close(CLOSE.GOING_AWAY, "server shutting down");
          }),
      );
      const force = setTimeout(() => sessions.forEach((s) => s.ws.terminate()), 1500);
      await Promise.all(closing);
      clearTimeout(force);
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
