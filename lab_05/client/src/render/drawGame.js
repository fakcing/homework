import { SHIP, TAU } from "@dogfight/shared";

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

/** Calls draw() for the object and for ghost copies when it straddles an arena edge. */
function wrapped(arena, x, y, reach, draw) {
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

export function drawScene(ctx, scene, sprites, arena, t, session) {
  for (const b of scene.bullets) {
    const mine = b.owner === session.slot;
    wrapped(arena, b.x, b.y, 20, (x, y) =>
      sprites.draw(ctx, mine ? "bullet" : "bullet_homing", x, y, 18, 7, Math.atan2(b.vy, b.vx)),
    );
  }
  for (const s of scene.ships) {
    if (!s.alive) continue;
    const color = COLORS[s.id % COLORS.length];
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
      ctx.fillText(session.names.get(s.id) ?? `#${s.id}`, 0, -34);
      ctx.restore();
    });
  }
}

/** Render-only particles (Math.random is fine here: it never feeds the simulation). */
export class Effects {
  #p = [];

  explode(x, y) {
    for (let i = 0; i < 36; i++) {
      const a = Math.random() * TAU;
      const v = 60 + Math.random() * 220;
      this.#p.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 0.5 + Math.random() * 0.6,
        max: 1.1,
      });
    }
  }

  draw(ctx, sprites, now) {
    const dt = Math.min(0.05, (now - (this.last ?? now)) / 1000);
    this.last = now;
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

export function drawScoreboard(ctx, view, session) {
  const ships = session.buffer.latest?.ships ?? [];
  ctx.font = "13px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  [...ships]
    .sort((a, b) => b.score - a.score)
    .forEach((s, i) => {
      ctx.fillStyle = s.alive ? COLORS[s.id % COLORS.length] : "rgba(245,245,247,0.4)";
      const hp = s.alive ? "♥".repeat(s.hp) + "♡".repeat(SHIP.maxHp - s.hp) : "respawning";
      ctx.fillText(
        `${session.names.get(s.id) ?? `#${s.id}`}${s.id === session.slot ? " (you)" : ""}  ${hp}  ${s.score}`,
        view.cssWidth - 16,
        16 + i * 18,
      );
    });
}

/** Bottom-right: RTT, snapshot age, bytes/s, input queue, correction (+ sparkline of the last 3 s). */
export function drawNetgraph(ctx, view, g) {
  const x = view.cssWidth - 16;
  let y = view.cssHeight - 16;
  const lines = [
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
