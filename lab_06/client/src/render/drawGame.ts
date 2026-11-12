import { SHIP, TAU, assertNever } from "@dogfight/shared";
import type { BulletSnap, Entity, ShipId, ShipSnap } from "@dogfight/shared";
import type { Netgraph, SceneView } from "../net/session.js";
import type { Arena, ViewMetrics } from "./canvas.js";
import type { Sprites } from "./sprites.js";

const COLORS = [
  "#f5f5f7",
  "#ff9f0a",
  "#30d158",
  "#bf5af2",
  "#ff453a",
  "#64d2ff",
  "#ffd60a",
  "#ac8e68",
];
const MONO = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
const colorOf = (id: number): string => COLORS[id % COLORS.length] ?? "#f5f5f7";

export interface SceneContext {
  readonly slot: ShipId | null;
  readonly names: ReadonlyMap<ShipId, string>;
  readonly latest: { readonly ships: readonly ShipSnap[] } | null;
}

/** Calls draw() for the object and for ghost copies when it straddles an arena edge. */
function wrapped(
  arena: Arena,
  x: number,
  y: number,
  reach: number,
  draw: (px: number, py: number) => void,
): void {
  for (const ox of [-arena.width, 0, arena.width]) {
    for (const oy of [-arena.height, 0, arena.height]) {
      const px = x + ox;
      const py = y + oy;
      if (px < -reach || px > arena.width + reach || py < -reach || py > arena.height + reach)
        continue;
      draw(px, py);
    }
  }
}

function drawBullet(
  ctx: CanvasRenderingContext2D,
  sprites: Sprites,
  arena: Arena,
  b: BulletSnap,
  mine: boolean,
): void {
  wrapped(arena, b.x, b.y, 20, (x, y) =>
    sprites.draw(ctx, mine ? "bullet" : "bullet_homing", x, y, 18, 7, Math.atan2(b.vy, b.vx)),
  );
}

function drawShip(
  ctx: CanvasRenderingContext2D,
  sprites: Sprites,
  arena: Arena,
  s: ShipSnap,
  t: number,
  label: string,
): void {
  if (!s.alive) return;
  const color = colorOf(s.id);
  wrapped(arena, s.x, s.y, 60, (x, y) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.save();
    ctx.rotate(s.angle);
    if (s.invuln && Math.floor(t / 100) % 2) ctx.globalAlpha = 0.35;
    if (s.thrust) sprites.draw(ctx, "flame", -20, 0, 36 + 8 * Math.sin(t / 35), 18);
    sprites.draw(ctx, "ship", 0, 0, 44, 44);
    ctx.restore();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, SHIP.radius + 8, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = MONO;
    ctx.textAlign = "center";
    ctx.fillText(label, 0, -34);
    ctx.restore();
  });
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  scene: SceneView,
  sprites: Sprites,
  arena: Arena,
  t: number,
  session: SceneContext,
): void {
  const entities: Entity[] = [...scene.bullets, ...scene.ships];
  for (const e of entities) {
    switch (e.kind) {
      case "bullet":
        drawBullet(ctx, sprites, arena, e, e.owner === session.slot);
        break;
      case "ship":
        drawShip(ctx, sprites, arena, e, t, session.names.get(e.id) ?? `#${e.id}`);
        break;
      default:
        assertNever(e); // a new entity kind without a drawer is a compile error
    }
  }
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

/** Render-only particles (Math.random is fine here: it never feeds the simulation). */
export class Effects {
  #p: Particle[] = [];
  #last: number | null = null;

  explode(x: number, y: number): void {
    for (let i = 0; i < 36; i++) {
      const a = Math.random() * TAU;
      const v = 60 + Math.random() * 220;
      this.#p.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 0.5 + Math.random() * 0.6,
      });
    }
  }

  draw(ctx: CanvasRenderingContext2D, sprites: Sprites, now: number): void {
    const dt = Math.min(0.05, (now - (this.#last ?? now)) / 1000);
    this.#last = now;
    this.#p = this.#p.filter((p) => (p.life -= dt) > 0);
    for (const p of this.#p) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      ctx.globalAlpha = Math.min(1, p.life / 0.5);
      sprites.draw(ctx, "spark", p.x, p.y, 16, 16);
    }
    ctx.globalAlpha = 1;
  }
}

export function drawScoreboard(
  ctx: CanvasRenderingContext2D,
  view: ViewMetrics,
  session: SceneContext,
): void {
  const ships = session.latest?.ships ?? [];
  ctx.font = "13px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  [...ships]
    .sort((a, b) => b.score - a.score)
    .forEach((s, i) => {
      ctx.fillStyle = s.alive ? colorOf(s.id) : "rgba(245,245,247,0.4)";
      const hp = s.alive ? "♥".repeat(s.hp) + "♡".repeat(SHIP.maxHp - s.hp) : "respawning";
      ctx.fillText(
        `${session.names.get(s.id) ?? `#${s.id}`}${s.id === session.slot ? " (you)" : ""}  ${hp}  ${s.score}`,
        view.cssWidth - 16,
        16 + i * 18,
      );
    });
}

/** Bottom-right: RTT, snapshot age, bytes/s, input queue, correction (+ sparkline of the last 3 s). */
export function drawNetgraph(ctx: CanvasRenderingContext2D, view: ViewMetrics, g: Netgraph): void {
  const x = view.cssWidth - 16;
  let y = view.cssHeight - 16;
  const lines: [string, string][] = [
    [
      `correction ${g.correction.toFixed(2)} px`,
      g.correction > 4 ? "#ff453a" : "rgba(245,245,247,0.86)",
    ],
    [`input queue ${g.queue}`, "rgba(245,245,247,0.86)"],
    [
      `↓ ${(g.inBps / 1024).toFixed(1)} KB/s   ↑ ${(g.outBps / 1024).toFixed(2)} KB/s`,
      "rgba(245,245,247,0.86)",
    ],
    [
      `snapshot age ${g.snapshotAgeMs.toFixed(0)} ms`,
      g.snapshotAgeMs > 100 ? "#ff9f0a" : "rgba(245,245,247,0.86)",
    ],
    [`RTT ${g.rttMs.toFixed(0)} ms`, "rgba(245,245,247,0.86)"],
  ];
  ctx.font = MONO;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  for (const [text, color] of lines) {
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    y -= 16;
  }
  const w = 120;
  const h = 28;
  const max = Math.max(4, ...g.history);
  ctx.strokeStyle = "rgba(10,132,255,0.9)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  g.history.forEach((v, i) => {
    const px = x - w + (i / 90) * w;
    const py = y - 4 - (v / max) * h;
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  });
  ctx.stroke();
}
