// Wire formats. Binary = DataView, little-endian, first byte = protocol version. JSON = same data, for comparison.
const VERSION = 1;
export const TYPE = Object.freeze({ INPUT: 1, SNAPSHOT: 2 });
export const SIZES = Object.freeze({ input: 7, header: 9, ship: 28, bullet: 24 });
const LE = true;
const F_ALIVE = 1;
const F_THRUST = 2;
const F_INVULN = 4;
const ANGLE_SCALE = 32767 / Math.PI;

export class ProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProtocolError";
  }
}

const viewOf = (data) =>
  data instanceof DataView
    ? data
    : ArrayBuffer.isView(data)
      ? new DataView(data.buffer, data.byteOffset, data.byteLength)
      : new DataView(data);

function check(view, type, minBytes) {
  if (view.byteLength < minBytes) throw new ProtocolError("truncated packet");
  if (view.getUint8(0) !== VERSION)
    throw new ProtocolError(`unsupported protocol version ${view.getUint8(0)}`);
  if (view.getUint8(1) !== type)
    throw new ProtocolError(`unexpected packet type ${view.getUint8(1)}`);
}

/** input: [u8 version][u8 type][u32 seq][u8 buttons] = 7 bytes */
export function encodeInput({ seq, buttons }) {
  const view = new DataView(new ArrayBuffer(SIZES.input));
  view.setUint8(0, VERSION);
  view.setUint8(1, TYPE.INPUT);
  view.setUint32(2, seq, LE);
  view.setUint8(6, buttons);
  return view.buffer;
}

export function decodeInput(data) {
  const view = viewOf(data);
  if (view.byteLength !== SIZES.input) throw new ProtocolError("input packet must be 7 bytes");
  check(view, TYPE.INPUT, SIZES.input);
  const buttons = view.getUint8(6);
  if (buttons > 15) throw new ProtocolError("unknown button bits");
  return { seq: view.getUint32(2, LE), buttons };
}

/**
 * snapshot: header [u8 ver][u8 type][u32 tick][u8 ships][u16 bullets], then
 *  ship (28 B):   u8 id, u8 flags, u8 hp, u8 cooldown, u16 score, i16 angle, f32 x y vx vy, u32 lastSeq
 *  bullet (24 B): u16 id, u8 owner, u8 ttl, f32 x y vx vy, u32 fireSeq
 */
export function encodeSnapshot({ tick, ships, bullets }) {
  const view = new DataView(
    new ArrayBuffer(SIZES.header + ships.length * SIZES.ship + bullets.length * SIZES.bullet),
  );
  view.setUint8(0, VERSION);
  view.setUint8(1, TYPE.SNAPSHOT);
  view.setUint32(2, tick, LE);
  view.setUint8(6, ships.length);
  view.setUint16(7, bullets.length, LE);
  let o = SIZES.header;
  for (const s of ships) {
    view.setUint8(o, s.id);
    view.setUint8(
      o + 1,
      (s.alive ? F_ALIVE : 0) | (s.thrust ? F_THRUST : 0) | (s.invuln ? F_INVULN : 0),
    );
    view.setUint8(o + 2, s.hp);
    view.setUint8(o + 3, s.cooldown);
    view.setUint16(o + 4, Math.min(s.score, 65535), LE);
    view.setInt16(o + 6, Math.round(s.angle * ANGLE_SCALE), LE);
    view.setFloat32(o + 8, s.x, LE);
    view.setFloat32(o + 12, s.y, LE);
    view.setFloat32(o + 16, s.vx, LE);
    view.setFloat32(o + 20, s.vy, LE);
    view.setUint32(o + 24, s.lastSeq, LE);
    o += SIZES.ship;
  }
  for (const b of bullets) {
    view.setUint16(o, b.id, LE);
    view.setUint8(o + 2, b.owner);
    view.setUint8(o + 3, b.ttl);
    view.setFloat32(o + 4, b.x, LE);
    view.setFloat32(o + 8, b.y, LE);
    view.setFloat32(o + 12, b.vx, LE);
    view.setFloat32(o + 16, b.vy, LE);
    view.setUint32(o + 20, b.fireSeq, LE);
    o += SIZES.bullet;
  }
  return view.buffer;
}

export function decodeSnapshot(data) {
  const view = viewOf(data);
  check(view, TYPE.SNAPSHOT, SIZES.header);
  const nShips = view.getUint8(6);
  const nBullets = view.getUint16(7, LE);
  if (view.byteLength !== SIZES.header + nShips * SIZES.ship + nBullets * SIZES.bullet) {
    throw new ProtocolError("snapshot length does not match its header");
  }
  let o = SIZES.header;
  const ships = [];
  for (let i = 0; i < nShips; i++, o += SIZES.ship) {
    const flags = view.getUint8(o + 1);
    ships.push({
      id: view.getUint8(o),
      alive: (flags & F_ALIVE) !== 0,
      thrust: (flags & F_THRUST) !== 0,
      invuln: (flags & F_INVULN) !== 0,
      hp: view.getUint8(o + 2),
      cooldown: view.getUint8(o + 3),
      score: view.getUint16(o + 4, LE),
      angle: view.getInt16(o + 6, LE) / ANGLE_SCALE,
      x: view.getFloat32(o + 8, LE),
      y: view.getFloat32(o + 12, LE),
      vx: view.getFloat32(o + 16, LE),
      vy: view.getFloat32(o + 20, LE),
      lastSeq: view.getUint32(o + 24, LE),
    });
  }
  const bullets = [];
  for (let i = 0; i < nBullets; i++, o += SIZES.bullet) {
    bullets.push({
      id: view.getUint16(o, LE),
      owner: view.getUint8(o + 2),
      ttl: view.getUint8(o + 3),
      x: view.getFloat32(o + 4, LE),
      y: view.getFloat32(o + 8, LE),
      vx: view.getFloat32(o + 12, LE),
      vy: view.getFloat32(o + 16, LE),
      fireSeq: view.getUint32(o + 20, LE),
    });
  }
  return { tick: view.getUint32(2, LE), ships, bullets };
}

// ---- JSON variants (behind a flag, for the size/speed comparison) ----
export const encodeInputJson = ({ seq, buttons }) =>
  JSON.stringify({ type: "input", seq, buttons });
export const encodeSnapshotJson = (snap) => JSON.stringify({ type: "snapshot", ...snap });
export function decodeSnapshotJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProtocolError("snapshot is not JSON");
  }
  if (
    data?.type !== "snapshot" ||
    !Number.isInteger(data.tick) ||
    !Array.isArray(data.ships) ||
    !Array.isArray(data.bullets)
  ) {
    throw new ProtocolError("malformed JSON snapshot");
  }
  return { tick: data.tick, ships: data.ships, bullets: data.bullets };
}

/** World -> the plain snapshot object both codecs accept. */
export const snapshotOf = (world) => ({
  tick: world.tick,
  ships: world.ships.map((s) => ({
    id: s.id,
    alive: s.alive,
    thrust: s.thrust,
    invuln: s.invuln > 0,
    hp: s.hp,
    cooldown: s.cooldown,
    score: s.score,
    angle: s.angle,
    x: s.x,
    y: s.y,
    vx: s.vx,
    vy: s.vy,
    lastSeq: s.lastSeq,
  })),
  bullets: world.bullets.map((b) => ({
    id: b.id,
    owner: b.owner,
    ttl: b.ttl,
    x: b.x,
    y: b.y,
    vx: b.vx,
    vy: b.vy,
    fireSeq: b.fireSeq,
  })),
});
