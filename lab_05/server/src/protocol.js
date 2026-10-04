export const CLOSE = Object.freeze({
  GOING_AWAY: 1001,
  UNSUPPORTED: 1003, // binary frame
  INVALID_PAYLOAD: 1007, // not JSON
  POLICY: 1008, // unknown type, wrong shape, wrong state
  TOO_BIG: 1009,
  JOIN_TIMEOUT: 4001,
  RATE_LIMIT: 4002,
  ROOM_FULL: 4003,
  ROOM_NOT_FOUND: 4004,
});

const NAME_RE = /^[\p{L}\p{N} _-]{1,16}$/u;
const ID_RE = /^[\w-]{1,40}$/;
const MAX_CHAT = 200;

const isString = (v) => typeof v === "string";
/** One validator + sanitizer per message type; an unknown type has no entry. */
const SCHEMAS = {
  join: (m) =>
    isString(m.room) &&
    ID_RE.test(m.room) &&
    isString(m.name) &&
    NAME_RE.test(m.name.trim()) &&
    (m.format === undefined || m.format === "binary" || m.format === "json")
      ? { type: "join", room: m.room, name: m.name.trim(), format: m.format ?? "binary" }
      : null,
  input: (m) =>
    Number.isInteger(m.seq) &&
    m.seq >= 1 &&
    m.seq <= 4294967295 &&
    Number.isInteger(m.buttons) &&
    m.buttons >= 0 &&
    m.buttons <= 15
      ? { type: "input", seq: m.seq, buttons: m.buttons }
      : null,
  chat: (m) =>
    isString(m.text) && m.text.trim().length >= 1 && m.text.trim().length <= MAX_CHAT
      ? { type: "chat", text: m.text.trim() }
      : null,
  leave: () => ({ type: "leave" }),
};

const fail = (code, reason) => ({ ok: false, code, reason });

/** Validates one raw WebSocket frame. Never throws; returns {ok, msg} or {ok:false, code, reason}. */
export function parseMessage(raw, isBinary, maxBytes) {
  if (isBinary) return fail(CLOSE.UNSUPPORTED, "binary frames are not supported");
  if (raw.length > maxBytes) return fail(CLOSE.TOO_BIG, "message too large");
  let data;
  try {
    data = JSON.parse(raw.toString("utf8"));
  } catch {
    return fail(CLOSE.INVALID_PAYLOAD, "invalid JSON");
  }
  if (data === null || typeof data !== "object" || Array.isArray(data) || !isString(data.type)) {
    return fail(CLOSE.POLICY, "message must be an object with a string `type`");
  }
  if (!Object.hasOwn(SCHEMAS, data.type))
    return fail(CLOSE.POLICY, `unknown message type "${data.type.slice(0, 20)}"`);
  const msg = SCHEMAS[data.type](data);
  return msg ? { ok: true, msg } : fail(CLOSE.POLICY, `malformed "${data.type}" message`);
}
