import { randomUUID } from "node:crypto";
import { TICK_HZ, decodeInput, ProtocolError } from "@dogfight/shared";
import { WebSocketServer } from "ws";
import { createRateLimiter } from "./limiter.js";
import { CLOSE, parseMessage } from "./protocol.js";
import { trySend, trySendSnapshot } from "./send.js";

const OPEN = 1;

export function attachWebSocket({ server, registry, config, logger }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxMessageBytes });
  const sessions = new Set();
  let dropped = 0;

  server.on("upgrade", (req, socket, head) => {
    if (new URL(req.url, "http://localhost").pathname !== "/ws") {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  const send = (ws, message, critical = false) =>
    trySend(ws, message, {
      critical,
      maxBuffered: config.maxBufferedBytes,
      onDrop: () => dropped++,
    });

  function reject(ws, code, reason) {
    send(ws, { type: "error", code, message: reason }, true);
    ws.close(code, reason);
  }

  function leave(session) {
    const { room, player } = session;
    if (!room || !player) return;
    session.room = session.player = null;
    room.remove(player.id);
    room.broadcast({ type: "left", id: player.id, slot: player.slot });
  }

  function join(session, { room: roomId, name, format }) {
    const { ws } = session;
    if (session.player) return reject(ws, CLOSE.POLICY, "already joined");
    const room = registry.get(roomId);
    if (!room) return reject(ws, CLOSE.ROOM_NOT_FOUND, "room not found");
    const slot = room.freeSlot();
    if (slot < 0) return reject(ws, CLOSE.ROOM_FULL, "room is full");
    const player = {
      id: session.id,
      slot,
      name,
      format,
      send: (message, o) => send(ws, message, o?.critical),
      sendSnapshot: (data) =>
        trySendSnapshot(ws, data, {
          maxBuffered: config.maxBufferedBytes,
          onDrop: () => dropped++,
        }),
    };
    if (!room.add(player)) return reject(ws, CLOSE.ROOM_FULL, "room is full");
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

  /** Binary frames are inputs: 7 bytes, version byte first. Anything else is a protocol violation. */
  function handleBinary(session, data) {
    if (!session.player) return reject(session.ws, CLOSE.POLICY, "join first");
    if (!session.inputLimiter.take())
      return reject(session.ws, CLOSE.RATE_LIMIT, "input rate exceeded");
    try {
      session.room.game.pushInput(session.player.slot, decodeInput(data));
    } catch (err) {
      if (!(err instanceof ProtocolError)) throw err;
      reject(session.ws, CLOSE.POLICY, err.message);
    }
  }

  function handle(session, msg) {
    if (msg.type === "join") return join(session, msg);
    if (!session.player) return reject(session.ws, CLOSE.POLICY, "join first");
    if (msg.type === "input") return void session.room.game.pushInput(session.player.slot, msg);
    if (msg.type === "chat") return session.room.chat(session.player, msg.text);
    if (msg.type === "leave") leave(session);
  }

  wss.on("connection", (ws) => {
    const session = {
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

    ws.on("pong", () => (session.missed = 0));
    ws.on("error", (err) => logger.warn("socket error", { id: session.id, message: err.message })); // required!
    ws.on("message", (data, isBinary) => {
      if (ws.readyState !== OPEN) return;
      if (isBinary) return handleBinary(session, data);
      const parsed = parseMessage(data, isBinary, config.maxMessageBytes);
      if (!parsed.ok) return reject(ws, parsed.code, parsed.reason);
      // Inputs (JSON flavour) have their own, higher budget than chat/control messages.
      const limiter = parsed.msg.type === "input" ? session.inputLimiter : session.limiter;
      if (!limiter.take()) return reject(ws, CLOSE.RATE_LIMIT, "rate limit exceeded");
      handle(session, parsed.msg);
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
          new Promise((resolve) => {
            s.ws.once("close", resolve);
            s.ws.close(CLOSE.GOING_AWAY, "server shutting down");
          }),
      );
      const force = setTimeout(() => sessions.forEach((s) => s.ws.terminate()), 1500);
      await Promise.all(closing);
      clearTimeout(force);
      await new Promise((resolve) => wss.close(resolve));
    },
  };
}
