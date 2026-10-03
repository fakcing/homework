import { TAU, shortestAngleDelta, shortestDelta, wrapCoord } from "../math.js";

const DRAW_ORDER = ["pickup", "asteroid", "bullet", "particle", "ship"];

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

const DRAWERS = {
  ship(ctx, sprites, e, x, y, angle, t) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    if (e.invulnerable && Math.floor(t / 100) % 2) ctx.globalAlpha = 0.35;
    if (e.thrusting) sprites.draw(ctx, "flame", -20, 0, 36 + 8 * Math.sin(t / 35), 18);
    sprites.draw(ctx, "ship", 0, 0, 44, 44);
    ctx.restore();
  },
  bullet(ctx, sprites, e, x, y) {
    sprites.draw(ctx, e.behavior("homing") ? "bullet_homing" : "bullet", x, y, 18, 7, e.vel.angle);
  },
  asteroid(ctx, sprites, e, x, y, angle) {
    const size = (e.radius * 2) / 0.92;
    sprites.draw(ctx, `asteroid_${e.size}_${e.id % 2 ? "a" : "b"}`, x, y, size, size, angle);
    if (e.behavior("homing")) {
      ctx.strokeStyle = "rgba(255,69,58,0.7)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, e.radius * 1.08, 0, TAU);
      ctx.stroke();
    }
  },
  pickup(ctx, sprites, e, x, y, _angle, t) {
    const size = e.radius * 2.6 * (1 + 0.08 * Math.sin(t / 200));
    sprites.draw(ctx, `pickup_${e.tag}`, x, y, size, size);
  },
  particle(ctx, sprites, e, x, y) {
    const life = e.behavior("lifetime")?.fraction ?? 1;
    ctx.globalAlpha = life;
    sprites.draw(ctx, "spark", x, y, 8 + 14 * life, 8 + 14 * life);
    ctx.globalAlpha = 1;
  },
};

export function drawWorld(ctx, world, alpha, timeMs, sprites, debug = false) {
  for (const kind of DRAW_ORDER) {
    const draw = DRAWERS[kind];
    for (const e of world.ofKind(kind)) {
      const { x, y, angle } = interpolated(e, alpha, world.arena);
      withWrap(world.arena, x, y, e.radius + 24, (px, py) => {
        draw(ctx, sprites, e, px, py, angle, timeMs);
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
