import { TAU, createRng, shortestAngleDelta, shortestDelta, wrapCoord } from "../math.js";

const DRAW_ORDER = ["pickup", "asteroid", "bullet", "particle", "ship"];
const PICKUP_COLORS = { repair: "#30d158", homing: "#ff9f0a" };
const shapes = new WeakMap();

function interpolated(e, alpha, arena) {
  const { prevPos, pos } = e;
  return {
    x: wrapCoord(prevPos.x + shortestDelta(prevPos.x, pos.x, arena.width) * alpha, arena.width),
    y: wrapCoord(prevPos.y + shortestDelta(prevPos.y, pos.y, arena.height) * alpha, arena.height),
    angle: e.prevAngle + shortestAngleDelta(e.prevAngle, e.angle) * alpha,
  };
}

/** Calls draw() for the entity and for ghost copies when it straddles an arena edge. */
function withWrap(arena, x, y, reach, draw) {
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

function asteroidShape(e) {
  let shape = shapes.get(e);
  if (!shape) {
    const rnd = createRng(e.id * 7919);
    const n = 11;
    shape = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * TAU;
      const r = e.radius * (0.78 + 0.3 * rnd());
      return [Math.cos(a) * r, Math.sin(a) * r];
    });
    shapes.set(e, shape);
  }
  return shape;
}

const DRAWERS = {
  ship(ctx, e, x, y, angle, t) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    if (e.invulnerable && Math.floor(t / 100) % 2) ctx.globalAlpha = 0.35;
    if (e.thrusting) {
      ctx.fillStyle = "#ff9f0a";
      ctx.beginPath();
      ctx.moveTo(-9, -5);
      ctx.lineTo(-9 - (14 + 7 * Math.sin(t / 35)), 0);
      ctx.lineTo(-9, 5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(18, 0);
    ctx.lineTo(-12, -11);
    ctx.lineTo(-6, 0);
    ctx.lineTo(-12, 11);
    ctx.closePath();
    ctx.fillStyle = "#f5f5f7";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#0a84ff";
    ctx.stroke();
    ctx.restore();
  },
  bullet(ctx, e, x, y) {
    const heading = e.vel.angle;
    ctx.strokeStyle = e.behavior("homing") ? "#ff9f0a" : "#64d2ff";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - Math.cos(heading) * 10, y - Math.sin(heading) * 10);
    ctx.stroke();
  },
  asteroid(ctx, e, x, y, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    asteroidShape(e).forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = e.behavior("homing") ? "#ff453a" : "rgba(245,245,247,0.7)";
    ctx.stroke();
    ctx.restore();
  },
  pickup(ctx, e, x, y, _angle, t) {
    const color = PICKUP_COLORS[e.tag] ?? "#fff";
    const r = e.radius * (1 + 0.08 * Math.sin(t / 200));
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = "bold 14px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(e.tag === "repair" ? "+" : "H", x, y + 1);
  },
  particle(ctx, e, x, y) {
    const life = e.behavior("lifetime")?.fraction ?? 1;
    ctx.fillStyle = `rgba(255,159,10,${life})`;
    ctx.beginPath();
    ctx.arc(x, y, 1 + 2 * life, 0, TAU);
    ctx.fill();
  },
};

export function drawWorld(ctx, world, alpha, timeMs, debug = false) {
  for (const kind of DRAW_ORDER) {
    const draw = DRAWERS[kind];
    for (const e of world.ofKind(kind)) {
      const { x, y, angle } = interpolated(e, alpha, world.arena);
      withWrap(world.arena, x, y, e.radius + 24, (px, py) => {
        draw(ctx, e, px, py, angle, timeMs);
        if (debug && e.collidable) {
          ctx.strokeStyle = "rgba(48,209,88,0.6)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(px, py, e.radius, 0, TAU);
          ctx.stroke();
        }
      });
    }
  }
}
