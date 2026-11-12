import { ARENA, BUTTON, DT } from "@dogfight/shared";
import { BadPayloadError } from "./assets/errors.js";
import { loadAll } from "./assets/loadAll.js";
import { loadManifest } from "./assets/manifest.js";
import { createAudio } from "./audio/audio.js";
import type { AudioApi } from "./audio/audio.js";
import { manifestUrl, patchManifest, readDebug, roomsUrl } from "./faults.js";
import { createInput } from "./input.js";
import { createRoomRequest, createRoomsFetcher } from "./lobby/api.js";
import type { RoomInfo } from "./lobby/api.js";
import { Lobby } from "./lobby/lobby.js";
import { createLoop } from "./loop.js";
import { GameSession } from "./net/session.js";
import { createCanvasView } from "./render/canvas.js";
import type { CanvasView } from "./render/canvas.js";
import { createStars, drawBackground, drawHud, drawLoading } from "./render/draw.js";
import type { LoadingUi, Star } from "./render/draw.js";
import { Effects, drawNetgraph, drawScene, drawScoreboard } from "./render/drawGame.js";
import { createSprites } from "./render/sprites.js";
import type { Sprites } from "./render/sprites.js";
import { createChatView } from "./ui/chatView.js";
import { createOverlay, describeError, h } from "./ui/dom.js";
import type { Overlay } from "./ui/dom.js";
import { createLobbyView } from "./ui/lobbyView.js";
import { assertNever } from "@dogfight/shared";

const params = new URLSearchParams(location.search);
const debugOptions = readDebug(params);
const num = (name: string, fallback: number): number => {
  const raw = params.get(name);
  return raw !== null && Number.isFinite(Number(raw)) ? Number(raw) : fallback;
};
// ?format=json  ?predict=0  ?lag=100 (RTT, ms)  ?jitter=20  ?loss=5 (%)  ?chaos=0.5  ?interp=100 (ms)
const netOptions = {
  format: params.get("format") === "json" ? ("json" as const) : ("binary" as const),
  predict: params.get("predict") !== "0",
  lagMs: num("lag", 0),
  jitterMs: num("jitter", 0),
  lossPct: num("loss", 0),
  chaos: num("chaos", 0),
  interpDelayMs: num("interp", 100),
};

type Phase = "loading" | "error" | "lobby" | "playing";
// Everything the render function reads lives here.
const ui: LoadingUi & { phase: Phase } = {
  phase: "loading",
  files: new Map(),
  done: 0,
  total: 0,
  message: "",
};
let session: GameSession | null = null;
let sprites: Sprites | null = null;
let stars: Star[] = createStars(ARENA);
let hudMode = "";
const effects = new Effects();
const KEYS: readonly (readonly [string, string, number])[] = [
  ["ArrowUp", "KeyW", BUTTON.THRUST],
  ["ArrowLeft", "KeyA", BUTTON.LEFT],
  ["ArrowRight", "KeyD", BUTTON.RIGHT],
  ["Space", "Space", BUTTON.FIRE],
];

function showFatal(err: unknown): void {
  console.error(err);
  const el = document.getElementById("error");
  if (el) {
    el.textContent = `Something went wrong:\n\n${err instanceof Error ? err.message : String(err)}`;
    el.classList.add("visible");
  }
}

const nextClick = (button: HTMLElement): Promise<Event> =>
  new Promise((resolve) => button.addEventListener("click", resolve, { once: true }));

interface Resources {
  sprites: Sprites;
  audio: AudioApi;
}

/** Loads manifest + assets; on any failure shows the reason and a Retry button instead of crashing. */
async function loadResources(overlay: Overlay): Promise<Resources> {
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
      // The manifest said "image" and "audio", but the type system cannot know what came back: check at runtime.
      const sheet = assets.sheet;
      if (!(sheet instanceof ImageBitmap))
        throw new BadPayloadError("The spritesheet did not decode to an image");
      const buffers: Record<string, AudioBuffer> = {};
      for (const key of ["fire", "hit", "explode", "pickup"]) {
        const buffer = assets[key];
        if (buffer instanceof AudioBuffer) buffers[key] = buffer;
      }
      console.log(
        `[loadAll] ${debugOptions.mode}: ${ms.toFixed(0)} ms, skipped: ${failed.map((f) => f.key).join(", ") || "none"}`,
      );
      const loaded: Resources = {
        sprites: createSprites(sheet, assets.atlas),
        audio: createAudio(buffers),
      };
      overlay.clear();
      return loaded;
    } catch (err: unknown) {
      console.warn("Loading failed:", err);
      const retry = h("button", { class: "primary" }, "Retry");
      Object.assign(ui, { phase: "error", message: describeError(err) });
      overlay.show(h("div", { class: "toolbar" }, retry));
      await nextClick(retry);
    }
  }
}

interface Choice {
  name: string;
  room: RoomInfo;
}

function runLobby(overlay: Overlay, audio: AudioApi): Promise<Choice> {
  ui.phase = "lobby";
  const lobby = new Lobby({
    fetchRooms: createRoomsFetcher(roomsUrl(debugOptions)),
    createRoom: createRoomRequest,
  });
  const view = createLobbyView(overlay, lobby);
  return new Promise((resolve) => {
    lobby.on(
      "join",
      (choice) => {
        void audio.unlock(); // still inside the click's call stack, so the browser lets the context start
        view.destroy();
        resolve(choice);
      },
      { once: true },
    );
  });
}

/** Joins the room over WebSocket and runs the networked game until Esc. */
function playUntilLeave(
  { name, room }: Choice,
  screen: CanvasView,
  audio: AudioApi,
): Promise<void> {
  const input = createInput(window);
  const life = new AbortController();
  const chat = createChatView(document.body);
  screen.setArena(room.arena);
  stars = createStars(room.arena);
  hudMode = `${name} @ ${room.name} · ${netOptions.format}${netOptions.predict ? "" : " · NO prediction"}`;

  const current = new GameSession({
    ...netOptions,
    url: `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
    room,
    name,
    readButtons: () =>
      KEYS.reduce((bits, [a, b, bit]) => bits | (input.isDown(a) || input.isDown(b) ? bit : 0), 0),
  });
  session = current;
  audio.attach(current, life.signal);
  current.on("exploded", ({ x, y }) => effects.explode(x, y), { signal: life.signal });

  const system = (text: string): void => chat.add("", text, "system");
  current.on(
    "control",
    (m) => {
      switch (m.type) {
        case "welcome":
          system(`You joined ${m.room.name} (slot ${m.slot})`);
          break;
        case "joined":
          system(`${m.player.name} joined`);
          break;
        case "left":
          system(`${current.names.get(m.slot) ?? "Someone"} left`);
          current.names.delete(m.slot);
          break;
        case "chat":
          chat.add(m.name, m.text);
          break;
        case "error":
          system(`Server: ${m.message}`);
          break;
        default:
          assertNever(m); // a new server message without a case is a compile error
      }
      chat.setTitle(`${room.name} · ${current.names.size} online`);
    },
    { signal: life.signal },
  );
  current.on("reconnecting", () => system("Connection lost, retrying…"), { signal: life.signal });
  current.on(
    "close",
    ({ code, reason }) =>
      code !== 1000 && system(`Disconnected (${code}${reason ? `: ${reason}` : ""})`),
    { signal: life.signal },
  );
  chat.onSubmit((text) => current.socket.send({ type: "chat", text }));
  current.connect();
  ui.phase = "playing";

  return new Promise((resolve) => {
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.code !== "Escape") return;
        life.abort();
        current.close();
        input.dispose();
        chat.destroy();
        session = null;
        resolve();
      },
      { signal: life.signal },
    );
  });
}

function boot(): void {
  const canvas = document.getElementById("game");
  const overlayRoot = document.getElementById("overlay");
  if (!(canvas instanceof HTMLCanvasElement) || !overlayRoot)
    throw new Error("#game canvas or #overlay not found");
  const screen = createCanvasView(canvas, ARENA);
  const overlay = createOverlay(overlayRoot);

  createLoop({
    step: DT,
    simulate: () => session?.step(),
    render(alpha, stats) {
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
      if (session && sprites) {
        drawScene(ctx, session.view(alpha, now), sprites, arena, now, session);
        effects.draw(ctx, sprites, now);
      }
      ctx.restore();
      if (session) {
        screen.useScreenSpace();
        drawHud(ctx, stats, hudMode);
        drawScoreboard(ctx, view, session);
        drawNetgraph(ctx, view, session.netgraph(now));
      }
    },
    onError: showFatal,
  }).start();

  // The game starts only after `await loadResources()` has resolved.
  void (async () => {
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
} catch (err: unknown) {
  showFatal(err);
}
