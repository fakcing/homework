import { createAudio } from "./audio/audio.js";
import { loadAll } from "./assets/loadAll.js";
import { loadManifest } from "./assets/manifest.js";
import { createInput } from "./input.js";
import { createLoop } from "./loop.js";
import { manifestUrl, patchManifest, readDebug, roomsUrl } from "./faults.js";
import { Lobby } from "./lobby/lobby.js";
import { createRoomRequest, createRoomsFetcher } from "./lobby/api.js";
import { GameSession } from "./net/session.js";
import { createCanvasView } from "./render/canvas.js";
import { createStars, drawBackground, drawHud, drawLoading } from "./render/draw.js";
import { Effects, drawNetgraph, drawScene, drawScoreboard } from "./render/drawGame.js";
import { createSprites } from "./render/sprites.js";
import { ARENA, BUTTON, DT } from "@dogfight/shared";
import { createOverlay, describeError, h } from "./ui/dom.js";
import { createChatView } from "./ui/chatView.js";
import { createLobbyView } from "./ui/lobbyView.js";

const params = new URLSearchParams(location.search);
const debugOptions = readDebug(params);
const num = (name, fallback) =>
  params.has(name) && Number.isFinite(Number(params.get(name)))
    ? Number(params.get(name))
    : fallback;
// ?format=json  ?predict=0  ?lag=100 (RTT, ms)  ?jitter=20  ?loss=5 (%)  ?chaos=0.5  ?interp=100 (ms)
const netOptions = {
  format: params.get("format") === "json" ? "json" : "binary",
  predict: params.get("predict") !== "0",
  lagMs: num("lag", 0),
  jitterMs: num("jitter", 0),
  lossPct: num("loss", 0),
  chaos: num("chaos", 0),
  interpDelayMs: num("interp", 100),
};

// Everything the render function reads lives here; phase: loading | error | lobby | playing.
const ui = { phase: "loading", files: new Map(), done: 0, total: 0, message: "" };
let session = null;
const effects = new Effects();
let sprites = null;
let stars = createStars(ARENA);
let hudMode = "";
const KEYS = [
  ["ArrowUp", "KeyW", BUTTON.THRUST],
  ["ArrowLeft", "KeyA", BUTTON.LEFT],
  ["ArrowRight", "KeyD", BUTTON.RIGHT],
  ["Space", "Space", BUTTON.FIRE],
];

function showFatal(err) {
  console.error(err);
  const el = document.getElementById("error");
  el.textContent = `Something went wrong:\n\n${err instanceof Error ? err.message : String(err)}`;
  el.classList.add("visible");
}

const nextClick = (button) =>
  new Promise((resolve) => button.addEventListener("click", resolve, { once: true }));

/** Loads manifest + assets; on any failure shows the reason and a Retry button instead of crashing. */
async function loadResources(overlay) {
  for (;;) {
    const controller = new AbortController();
    const cancel = h("button", { onClick: () => controller.abort() }, "Cancel");
    Object.assign(ui, {
      phase: "loading",
      files: new Map(),
      done: 0,
      total: 0,
      message: "Loading…",
    });
    overlay.show(h("div", { class: "toolbar" }, cancel));
    try {
      const manifest = patchManifest(
        await loadManifest(manifestUrl(debugOptions), { signal: controller.signal }),
        debugOptions,
      );
      const { assets, failed, ms } = await loadAll(manifest, {
        signal: controller.signal,
        mode: debugOptions.mode,
        onProgress: ({ key, status, done, total, attempt }) => {
          ui.files.set(key, { status, attempt });
          Object.assign(ui, { done, total });
        },
      });
      const buffers = Object.fromEntries(
        ["fire", "hit", "explode", "pickup"].map((k) => [k, assets[k]]),
      );
      console.log(
        `[loadAll] ${debugOptions.mode}: ${ms.toFixed(0)} ms, skipped: ${failed.map((f) => f.key).join(", ") || "none"}`,
      );
      overlay.clear();
      return {
        sprites: createSprites(assets.sheet, assets.atlas),
        audio: createAudio(buffers),
        ms,
        failed,
      };
    } catch (err) {
      console.warn("Loading failed:", err);
      const retry = h("button", { class: "primary" }, "Retry");
      Object.assign(ui, { phase: "error", message: describeError(err) });
      overlay.show(h("div", { class: "toolbar" }, retry));
      await nextClick(retry);
    }
  }
}

function runLobby(overlay, audio) {
  ui.phase = "lobby";
  const lobby = new Lobby({
    fetchRooms: createRoomsFetcher(roomsUrl(debugOptions)),
    createRoom: createRoomRequest,
  });
  const view = createLobbyView(overlay, lobby);
  return new Promise((resolve) => {
    lobby.addEventListener(
      "join",
      (e) => {
        audio.unlock(); // still inside the click's call stack, so the browser lets the context start
        view.destroy();
        resolve(e.detail);
      },
      { once: true },
    );
  });
}

/** Joins the room over WebSocket and runs the networked game until Esc. */
function playUntilLeave({ name, room }, screen, audio) {
  const input = createInput(window);
  const life = new AbortController();
  const chat = createChatView(document.body);
  screen.setArena(room.arena);
  stars = createStars(room.arena);
  hudMode = `${name} @ ${room.name} · ${netOptions.format}${netOptions.predict ? "" : " · NO prediction"}`;

  session = new GameSession({
    ...netOptions,
    url: `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
    room,
    name,
    WebSocketImpl: WebSocket,
    readButtons: () =>
      KEYS.reduce((bits, [a, b, bit]) => bits | (input.isDown(a) || input.isDown(b) ? bit : 0), 0),
  });
  audio.attach(session, life.signal);
  session.addEventListener("exploded", ({ detail }) => effects.explode(detail.x, detail.y), {
    signal: life.signal,
  });

  const system = (text) => chat.add("", text, "system");
  const title = () => chat.setTitle(`${room.name} · ${session.names.size} online`);
  session.addEventListener(
    "control",
    ({ detail: m }) => {
      if (m.type === "welcome") system(`You joined ${m.room.name} (slot ${m.slot})`);
      else if (m.type === "joined") system(`${m.player.name} joined`);
      else if (m.type === "left") {
        system(`${session.names.get(m.slot) ?? "Someone"} left`);
        session.names.delete(m.slot);
      } else if (m.type === "chat") chat.add(m.name, m.text);
      else if (m.type === "error") system(`Server: ${m.message}`);
      title();
    },
    { signal: life.signal },
  );
  session.addEventListener("reconnecting", () => system("Connection lost, retrying…"), {
    signal: life.signal,
  });
  session.addEventListener(
    "close",
    ({ detail }) =>
      detail.code !== 1000 &&
      system(`Disconnected (${detail.code}${detail.reason ? `: ${detail.reason}` : ""})`),
    { signal: life.signal },
  );
  chat.onSubmit((text) => session.socket.send({ type: "chat", text }));
  session.connect();
  ui.phase = "playing";

  return new Promise((resolve) => {
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.code !== "Escape") return;
        life.abort();
        session.close();
        input.dispose();
        chat.destroy();
        session = null;
        resolve();
      },
      { signal: life.signal },
    );
  });
}

function boot() {
  const canvas = document.getElementById("game");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("#game canvas not found");
  const screen = createCanvasView(canvas, ARENA);
  const overlay = createOverlay(document.getElementById("overlay"));

  function render(alpha, stats) {
    const { ctx, view } = screen;
    screen.useScreenSpace();
    if (ui.phase === "loading" || ui.phase === "error") return drawLoading(ctx, view, ui);

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, view.cssWidth, view.cssHeight);
    screen.useWorldSpace();
    const arena = screen.arena;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, arena.width, arena.height);
    ctx.clip();
    drawBackground(ctx, arena, stars);
    const now = performance.now();
    if (session) {
      const scene = session.view(alpha, now);
      drawScene(ctx, scene, sprites, arena, now, session);
      effects.draw(ctx, sprites, now);
    }
    ctx.restore();
    if (session) {
      screen.useScreenSpace();
      drawHud(ctx, stats, hudMode);
      drawScoreboard(ctx, view, session);
      drawNetgraph(ctx, view, session.netgraph(now));
    }
  }

  createLoop({ step: DT, simulate: () => session?.step(), render, onError: showFatal }).start();

  // The game starts only after `await loadResources()` has resolved.
  (async () => {
    const loaded = await loadResources(overlay);
    sprites = loaded.sprites;
    for (;;) {
      const choice = await runLobby(overlay, loaded.audio);
      await playUntilLeave(choice, screen, loaded.audio);
    }
  })().catch(showFatal);
}

try {
  boot();
} catch (err) {
  showFatal(err);
}
