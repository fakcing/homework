import type { Manifest } from "./assets/manifest.js";

export type Fault =
  "sprite404" | "sound404" | "json" | "flaky" | "timeout" | "rooms500" | "roomsjson";
const FAULTS: readonly string[] = [
  "sprite404",
  "sound404",
  "json",
  "flaky",
  "timeout",
  "rooms500",
  "roomsjson",
];

export interface DebugOptions {
  readonly fault: Fault | null;
  readonly slowMs: number;
  readonly mode: "concurrent" | "sequential";
}

const isFault = (v: string | null): v is Fault => v !== null && FAULTS.includes(v);

/** Debug switches for the failure gallery:  ?fault=…  ?slow=<ms>  ?mode=sequential */
export function readDebug(params: URLSearchParams): DebugOptions {
  const fault = params.get("fault");
  return {
    fault: isFault(fault) ? fault : null,
    slowMs: Number(params.get("slow")) || 0,
    mode: params.get("mode") === "sequential" ? "sequential" : "concurrent",
  };
}

export const manifestUrl = ({ fault }: DebugOptions): string =>
  fault === "json" ? "/assets/manifest.broken.json" : "/assets/manifest.json";

export function roomsUrl({ fault }: DebugOptions): string {
  switch (fault) {
    case "timeout":
      return "/api/rooms?fault=timeout";
    case "rooms500":
      return "/api/rooms?fault=500";
    case "roomsjson":
      return "/api/rooms?fault=json";
    case "sprite404":
    case "sound404":
    case "json":
    case "flaky":
    case null:
      return "/api/rooms";
    default:
      return assertNeverFault(fault);
  }
}

function assertNeverFault(fault: never): never {
  throw new Error(`unhandled fault ${String(fault)}`);
}

export function patchManifest(manifest: Manifest, { fault, slowMs }: DebugOptions): Manifest {
  const run = Date.now(); // new URL each reload so the dev server's failure counter starts over
  const assets = manifest.assets.map((a) => {
    let src = a.src;
    if (fault === "sprite404" && a.key === "sheet") src = "/assets/missing-sprites.png";
    if (fault === "sound404" && a.key === "explode") src = "/assets/missing-explode.wav";
    const query: string[] = [];
    if (slowMs) query.push(`delay=${slowMs}`);
    if (fault === "flaky" && a.key === "atlas") query.push("flaky=2", `run=${run}`);
    return { ...a, src: query.length ? `${src}?${query.join("&")}` : src };
  });
  return { ...manifest, assets };
}
