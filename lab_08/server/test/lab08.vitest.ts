import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { Metrics } from "../src/metrics.js";

const temp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "dogfight-lab08-"));

async function appWith(env: Record<string, string> = {}) {
  const logDir = temp();
  const dist = temp();
  fs.writeFileSync(path.join(dist, "index.html"), "ok");
  const app = createApp(
    loadConfig({
      PORT: "0",
      HOST: "127.0.0.1",
      LOG_STDOUT: "0",
      LOG_DIR: logDir,
      CLIENT_DIST: dist,
      ...env,
    }),
  );
  const port = await app.start();
  return { app, port, logDir };
}

describe("Lab 8 production contract", () => {
  it("parses allowed origins and connection limits with Zod", () => {
    const config = loadConfig({
      ALLOWED_ORIGINS: "https://a.example, https://b.example",
      MAX_CONNECTIONS_PER_IP: "4",
    });
    expect(config.allowedOrigins).toEqual(["https://a.example", "https://b.example"]);
    expect(config.maxConnectionsPerIp).toBe(4);
  });
  it("rejects an invalid connection limit", () => {
    expect(() => loadConfig({ MAX_CONNECTIONS_PER_IP: "0" })).toThrow();
  });
  it("defaults to wildcard origin for local development", () => {
    expect(loadConfig({}).allowedOrigins).toEqual(["*"]);
  });
  it("returns health, readiness and git SHA", async () => {
    const { app, port } = await appWith({ GIT_SHA: "abc123" });
    try {
      const health = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json());
      const ready = await fetch(`http://127.0.0.1:${port}/ready`);
      expect(health).toMatchObject({ status: "ok", gitSha: "abc123" });
      expect(ready.status).toBe(200);
      expect(await ready.json()).toMatchObject({ status: "ready", gitSha: "abc123" });
    } finally {
      await app.stop();
    }
  });
  it("exports prometheus metrics", async () => {
    const { app, port } = await appWith();
    try {
      const response = await fetch(`http://127.0.0.1:${port}/metrics`);
      const body = await response.text();
      expect(response.headers.get("content-type")).toContain("text/plain");
      expect(body).toContain("dogfight_players");
      expect(body).toContain("dogfight_process_rss_bytes");
    } finally {
      await app.stop();
    }
  });
  it("rejects a WebSocket with a disallowed Origin", async () => {
    const { app, port } = await appWith({ ALLOWED_ORIGINS: "https://allowed.example" });
    try {
      const status = await new Promise<number>((resolve) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
          headers: { Origin: "https://blocked.example" },
        });
        socket.on("error", () => {});
        socket.once("unexpected-response", (_request, response) => {
          resolve(response.statusCode);
        });
      });
      expect(status).toBe(403);
    } finally {
      await app.stop();
    }
  });
  it("allows a WebSocket with an allowed Origin", async () => {
    const { app, port } = await appWith({ ALLOWED_ORIGINS: "https://allowed.example" });
    try {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        headers: { Origin: "https://allowed.example" },
      });
      await new Promise<void>((resolve, reject) => {
        socket.once("open", () => resolve());
        socket.once("error", reject);
      });
      expect(app.ws.count).toBe(1);
      socket.close();
    } finally {
      await app.stop();
    }
  });
  it("renders metrics counters", () => {
    const metrics = new Metrics();
    metrics.observeMessage(10);
    metrics.observeMessage(20);
    expect(metrics.totals).toEqual({ messages: 2, bytes: 30, stepSamples: 0 });
  });
  it("filters secrets from JSON logs", async () => {
    const file = path.join(temp(), "server.log");
    const logger = createLogger(file, { echo: false });
    logger.info("login", { room: "r1", player: "p1", password: "hidden", apiKey: "hidden" });
    await logger.close();
    const content = fs.readFileSync(file, "utf8");
    expect(content).toContain('"room":"r1"');
    expect(content).not.toContain("hidden");
  });
  it("records room and player identifiers in logs", async () => {
    const file = path.join(temp(), "server.log");
    const logger = createLogger(file, { echo: false });
    logger.info("player joined", { room: "room-1", player: "player-1" });
    await logger.close();
    expect(fs.readFileSync(file, "utf8")).toMatch(/room-1.*player-1/);
  });
});
