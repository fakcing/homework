import fs from "node:fs";
import http from "node:http";
import type { Server } from "node:http";
import path from "node:path";
import type { Config } from "./config.js";
import { createRequestHandler } from "./http.js";
import { createLogger } from "./logger.js";
import type { Logger } from "./logger.js";
import { Metrics } from "./metrics.js";
import { RoomRegistry } from "./registry.js";
import { attachWebSocket } from "./ws.js";
import type { WsApi } from "./ws.js";

export interface App {
  readonly server: Server;
  readonly registry: RoomRegistry;
  readonly logger: Logger;
  readonly ws: WsApi;
  readonly metrics: Metrics;
  start(): Promise<number>;
  stop(): Promise<void>;
}

export function createApp(config: Config): App {
  fs.mkdirSync(config.logDir, { recursive: true });
  const logger = createLogger(path.join(config.logDir, "server.log"), { echo: config.logStdout });
  const metrics = new Metrics();
  let ready = false;
  const registry = new RoomRegistry({
    logDir: config.logDir,
    maxRooms: config.maxRooms,
    defaultMax: config.roomMaxPlayers,
    logger,
  });
  const server = http.createServer(
    createRequestHandler({
      config,
      registry,
      logger,
      sockets: () => ws.count,
      ready: () => ready,
      metrics,
    }),
  );
  const ws = attachWebSocket({ server, registry, config, logger, metrics });
  let stopping: Promise<void> | null = null;

  return {
    server,
    registry,
    logger,
    ws,
    metrics,
    async start() {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, resolve);
      });
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new Error("server is not listening on a TCP port"); // string = unix socket
      logger.info("listening", { host: config.host, port: address.port });
      ready = true;
      return address.port;
    },
    /** Graceful: close sockets (1001) -> stop accepting -> finish match logs -> flush the app log. */
    stop() {
      stopping ??= (async () => {
        ready = false;
        await ws.close();
        server.closeIdleConnections();
        const force = setTimeout(() => server.closeAllConnections(), 1000);
        await new Promise<void>((resolve) => server.close(() => resolve()));
        clearTimeout(force);
        await registry.flush();
        logger.info("stopped");
        await logger.close();
      })();
      return stopping;
    },
  };
}
