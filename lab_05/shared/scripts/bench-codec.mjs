import {
  SIZES,
  addShip,
  createWorld,
  decodeInput,
  decodeSnapshot,
  decodeSnapshotJson,
  encodeInput,
  encodeInputJson,
  encodeSnapshot,
  encodeSnapshotJson,
  snapshotOf,
  stepWorld,
  BUTTON,
  TICK_HZ,
} from "../src/index.js";

function scene(ships, bulletsPerShip) {
  const w = createWorld(11);
  for (let i = 0; i < ships; i++) addShip(w, i);
  for (let t = 0; t < 40; t++)
    stepWorld(
      w,
      new Map(
        w.ships.map((s) => [
          s.id,
          {
            seq: t + 1,
            buttons: BUTTON.THRUST | BUTTON.RIGHT | (t % 10 < bulletsPerShip ? BUTTON.FIRE : 0),
          },
        ]),
      ),
    );
  return snapshotOf(w);
}
const time = (fn, n = 20000) => {
  const t = performance.now();
  for (let i = 0; i < n; i++) fn();
  return ((performance.now() - t) * 1000) / n;
};

console.log(
  "| сцена | JSON, байт | binary, байт | менше у | JSON, KB/s на клієнта | binary, KB/s | encode+decode JSON, мкс | binary, мкс |",
);
console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");
for (const [label, ships, bullets] of [
  ["2 кораблі, 0 куль", 2, 0],
  ["2 кораблі, ~6 куль", 2, 3],
  ["8 кораблів, ~24 кулі", 8, 3],
]) {
  const snap = scene(ships, bullets);
  const j = encodeSnapshotJson(snap).length;
  const b = encodeSnapshot(snap).byteLength;
  const tj = time(() => decodeSnapshotJson(encodeSnapshotJson(snap)));
  const tb = time(() => decodeSnapshot(encodeSnapshot(snap)));
  console.log(
    `| ${label} (${snap.ships.length}+${snap.bullets.length}) | ${j} | ${b} | ${(j / b).toFixed(1)}× | ${((j * TICK_HZ) / 1024).toFixed(1)} | ${((b * TICK_HZ) / 1024).toFixed(1)} | ${tj.toFixed(1)} | ${tb.toFixed(1)} |`,
  );
}
const input = { seq: 123456, buttons: 9 };
console.log(
  `\ninput: JSON ${encodeInputJson(input).length} B (${encodeInputJson(input)}), binary ${encodeInput(input).byteLength} B; decode ${time(() => decodeInput(encodeInput(input))).toFixed(2)} мкс. Заголовок snapshot ${SIZES.header} B, корабель ${SIZES.ship} B, куля ${SIZES.bullet} B.`,
);
