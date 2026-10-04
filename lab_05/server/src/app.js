import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequestHandler } from "./http.js";
import { createLogger } from "./logger.js";
import { RoomRegistry } from "./registry.js";
import { attachWebSocket } from "./ws.js";

export function createApp(config) {
  fs.mkdirSync(config.logDir, { recursive: true });
  const logger = createLogger(path.join(config.logDir, "server.log"), { echo: config.logStdout });
  const registry = new RoomRegistry({
    logDir: config.logDir,
    maxRooms: config.maxRooms,
    defaultMax: config.roomMaxPlayers,
    logger,
  });
  let ws = null;
  const server = http.createServer(
    createRequestHandler({ config, registry, logger, sockets: () => ws?.count ?? 0 }),
  );
  ws = attachWebSocket({ server, registry, config, logger });
  let stopping = null;

  return {
    server,
    registry,
    logger,
    get ws() {
      return ws;
    },
    async start() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, resolve);
      });
      const { port } = server.address();
      logger.info("listening", { host: config.host, port });
      return port;
    },
    /** Graceful: close sockets (1001) -> stop accepting -> finish match logs -> flush the app log. */
    stop() {
      stopping ??= (async () => {
        await ws.close();
        server.closeIdleConnections();
        const force = setTimeout(() => server.closeAllConnections(), 1000);
        await new Promise((resolve) => server.close(resolve));
        clearTimeout(force);
        await registry.flush();
        logger.info("stopped");
        await logger.close();
      })();
      return stopping;
    },
  };
}
