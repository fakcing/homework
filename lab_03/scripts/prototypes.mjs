// The one prototype-chain experiment of Lab 2.
import { createScriptedInput } from "../src/input.js";
import { Entity } from "../src/sim/entity.js";
import { Ship } from "../src/sim/ship.js";
import { Vector2 } from "../src/sim/vector2.js";

const make = () => new Ship({ pos: new Vector2(0, 0), input: createScriptedInput([]) });
const a = make();
const b = make();
const log = (label, value) => console.log(`${label.padEnd(58)} ${value}`);

log("Object.getPrototypeOf(a) === Ship.prototype", Object.getPrototypeOf(a) === Ship.prototype);
log(
  "Object.getPrototypeOf(Ship.prototype) === Entity.prototype",
  Object.getPrototypeOf(Ship.prototype) === Entity.prototype,
);
log(
  "Object.getPrototypeOf(Entity.prototype) === Object.prototype",
  Object.getPrototypeOf(Entity.prototype) === Object.prototype,
);
log("a instanceof Ship / Entity", `${a instanceof Ship} / ${a instanceof Entity}`);
log("Object.keys(a)", Object.keys(a).join(", "));
log("Object.hasOwn(a, 'fire')  (method lives on the prototype)", Object.hasOwn(a, "fire"));
log("a.fire === b.fire  (one shared function)", a.fire === b.fire);
log("Object.hasOwn(a, 'hp')  (#hp is private, hp is a getter)", Object.hasOwn(a, "hp"));
log("Object.hasOwn(Ship.prototype, 'hp')", Object.hasOwn(Ship.prototype, "hp"));
log("a.id !== b.id", `${a.id} !== ${b.id}`);
