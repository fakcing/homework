import { wrapShip } from "./arena.js";
import { integrate } from "./ship.js";

/** One full simulation step for a ship: physics, then arena wrap-around. */
export const advance = (ship, input, dt) => wrapShip(integrate(ship, input, dt));
