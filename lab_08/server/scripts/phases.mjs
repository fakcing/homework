// libuv phases: timers -> pending -> idle/prepare -> poll (I/O) -> check (setImmediate) -> close.
// process.nextTick and promise callbacks run between phases, nextTick first.
import fs from "node:fs";

const queue = (label) => {
  setTimeout(() => console.log(`  ${label}: setTimeout 0`), 0);
  setImmediate(() => console.log(`  ${label}: setImmediate`));
  process.nextTick(() => console.log(`  ${label}: nextTick`));
  Promise.resolve().then(() => console.log(`  ${label}: promise`));
};

console.log("inside an I/O callback (poll phase): order is deterministic");
fs.readFile(import.meta.filename, () => queue("io"));
