import { createAudio } from "./audio/audio.js";
import { loadAll } from "./assets/loadAll.js";
import { loadManifest } from "./assets/manifest.js";
import { createInput } from "./input.js";
import { createLoop } from "./loop.js";
import { manifestUrl, patchManifest, readDebug, roomsUrl } from "./faults.js";
import { Lobby } from "./lobby/lobby.js";
import { createRoomRequest, createRoomsFetcher } from "./lobby/api.js";
import { ReconnectingSocket } from "./net/socket.js";
import { createCanvasView } from "./render/canvas.js";
import { createStars, drawBackground, drawGameHud, drawHud, drawLoading } from "./render/draw.js";
import { drawWorld } from "./render/drawWorld.js";
import { createSprites } from "./render/sprites.js";
import { ARENA } from "./sim/arena.js";
import { Game } from "./sim/game.js";
import { SHIP } from "./sim/ship.js";
import { createOverlay, describeError, h } from "./ui/dom.js";
import { createChatView } from "./ui/chatView.js";
import { createLobbyView } from "./ui/lobbyView.js";

const params = new URLSearchParams(location.search);
const debugOptions = readDebug(params);
const showHitboxes = params.has("debug");

// Everything the render function reads lives here; phase: loading | error | lobby | playing.
const ui = { phase: "loading", files: new Map(), done: 0, total: 0, message: "" };
let game = null;
let sprites = null;
let stars = createStars(ARENA);
let hudMode = "";

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

/** Chat over WebSocket. The game itself stays local until Lab 5; the server only knows who is in the room. */
function connectChat({ name, room }, signal) {
  const chat = createChatView(document.body);
  const socket = new ReconnectingSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
  );
  const players = new Map();
  const system = (text) => chat.add("", text, "system");
  const refreshTitle = () => chat.setTitle(`${room.name} · ${players.size} online`);

  socket.addEventListener("open", () => socket.send({ type: "join", room: room.id, name }));
  socket.addEventListener("reconnecting", () => system("Connection lost, retrying…"));
  socket.addEventListener(
    "close",
    ({ detail }) =>
      detail.code !== 1000 &&
      system(`Disconnected (${detail.code}${detail.reason ? `: ${detail.reason}` : ""})`),
  );
  socket.addEventListener("message", ({ detail: m }) => {
    switch (m.type) {
      case "welcome":
        players.clear();
        m.players.forEach((p) => players.set(p.id, p.name));
        system(`You joined ${m.room.name}`);
        break;
      case "joined":
        players.set(m.player.id, m.player.name);
        system(`${m.player.name} joined`);
        break;
      case "left":
        system(`${players.get(m.id) ?? "Someone"} left`);
        players.delete(m.id);
        break;
      case "chat":
        chat.add(m.name, m.text);
        break;
      case "error":
        system(`Server: ${m.message}`);
        break;
    }
    refreshTitle();
  });
  chat.onSubmit((text) => socket.send({ type: "chat", text }));
  socket.connect();
  signal.addEventListener(
    "abort",
    () => {
      socket.close();
      chat.destroy();
    },
    { once: true },
  );
}

function playUntilLeave({ name, room }, screen, audio) {
  const input = createInput(window);
  const life = new AbortController();
  screen.setArena(room.arena);
  stars = createStars(room.arena);
  game = new Game({ arena: room.arena, seed: Number(params.get("seed")) || room.seed, input });
  audio.attach(game.world.events, life.signal);
  connectChat({ name, room }, life.signal);
  hudMode = `${name} @ ${room.name} · fixed 60 Hz`;
  ui.phase = "playing";
  return new Promise((resolve) => {
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.code !== "Escape") return;
        life.abort(); // detaches the audio listeners together
        input.dispose();
        game = null;
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
    const arena = game?.world.arena ?? ARENA;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, arena.width, arena.height);
    ctx.clip();
    drawBackground(ctx, arena, stars);
    if (game) drawWorld(ctx, game.world, alpha, performance.now(), sprites, showHitboxes);
    ctx.restore();
    if (game) {
      screen.useScreenSpace();
      drawHud(ctx, stats, hudMode);
      drawGameHud(ctx, view, game, SHIP.maxHp);
    }
  }

  createLoop({ simulate: (dt) => game?.step(dt), render, onError: showFatal }).start();

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
