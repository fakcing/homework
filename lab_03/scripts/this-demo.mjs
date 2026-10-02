// What happens when `ship.fire` is handed to a listener as a bare function.
import { createScriptedInput } from "../src/input.js";
import { Ship } from "../src/sim/ship.js";
import { Vector2 } from "../src/sim/vector2.js";
import { World } from "../src/sim/world.js";

function make() {
  const world = new World();
  const ship = world.spawn(
    new Ship({ pos: new Vector2(300, 300), input: createScriptedInput([]), invulnerable: 0 }),
  );
  return { world, ship };
}

function trial(label, attach) {
  const { world, ship } = make();
  const target = new EventTarget();
  try {
    attach(target, ship);
    target.dispatchEvent(new Event("keydown"));
    console.log(`${label.padEnd(38)} bullets spawned: ${world.count("bullet")}`);
  } catch (err) {
    console.log(`${label.padEnd(38)} THROWS ${err.constructor.name}: ${err.message}`);
  }
}

console.log("--- BUG ---");
// Inside the listener `this` is the EventTarget, not the ship: this.alive is undefined,
// so fire() quietly returns false. No error, no bullet.
trial("addEventListener('keydown', ship.fire)", (t, ship) =>
  t.addEventListener("keydown", ship.fire),
);
// A detached method has no `this` at all (class bodies are strict) -> TypeError.
trial("const { fire } = ship; fire()", (t, ship) => {
  const { fire } = ship;
  fire();
});

console.log("--- FIXES ---");
trial("arrow wrapper  () => ship.fire()", (t, ship) =>
  t.addEventListener("keydown", () => ship.fire()),
);
trial("ship.fire.bind(ship)", (t, ship) => t.addEventListener("keydown", ship.fire.bind(ship)));
trial("ship.fire.call(ship)", (t, ship) =>
  t.addEventListener("keydown", () => ship.fire.call(ship)),
);
