/** Debug switches for the failure gallery:  ?fault=sprite404|sound404|json|flaky|timeout|rooms500|roomsjson  ?slow=<ms>  ?mode=sequential */
export function readDebug(params) {
  return {
    fault: params.get("fault"),
    slowMs: Number(params.get("slow")) || 0,
    mode: params.get("mode") === "sequential" ? "sequential" : "concurrent",
  };
}

export const manifestUrl = ({ fault }) =>
  fault === "json" ? "/assets/manifest.broken.json" : "/assets/manifest.json";

export function roomsUrl({ fault }) {
  const map = { timeout: "timeout", rooms500: "500", roomsjson: "json" };
  return map[fault] ? `/api/rooms?fault=${map[fault]}` : "/api/rooms";
}

export function patchManifest(manifest, { fault, slowMs }) {
  const run = Date.now(); // new URL each reload so the mock server's failure counter starts over
  const assets = manifest.assets.map((a) => {
    let src = a.src;
    if (fault === "sprite404" && a.key === "sheet") src = "/assets/missing-sprites.png";
    if (fault === "sound404" && a.key === "explode") src = "/assets/missing-explode.wav";
    const query = [];
    if (slowMs) query.push(`delay=${slowMs}`);
    if (fault === "flaky" && a.key === "atlas") query.push("flaky=2", `run=${run}`);
    return { ...a, src: query.length ? `${src}?${query.join("&")}` : src };
  });
  return { ...manifest, assets };
}
