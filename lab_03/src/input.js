const PREVENT_DEFAULT = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"]);

/**
 * Keyboard state as a closure: `down` and `pressed` are private, the returned object is the API.
 * `justPressed` is edge-triggered and cleared by `endStep()` after every *simulation step*
 * (not every frame), so a press is seen by exactly one step even at 120 Hz or after a hitch.
 */
export function createInput(target) {
  const down = new Set();
  const pressed = new Set();

  const onKeyDown = (e) => {
    if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    down.add(e.code);
    pressed.add(e.code);
  };
  const onKeyUp = (e) => down.delete(e.code);
  const onBlur = () => {
    down.clear(); // a key released while the window was unfocused would stay "stuck"
    pressed.clear();
  };

  target.addEventListener("keydown", onKeyDown);
  target.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  return {
    isDown: (code) => down.has(code),
    justPressed: (code) => pressed.has(code),
    endStep: () => pressed.clear(),
    dispose() {
      target.removeEventListener("keydown", onKeyDown);
      target.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    },
  };
}

/** Input with a fixed set of held keys — used by the reproducible experiment 3 (`?auto`). */
export function createScriptedInput(keys) {
  const held = new Set(keys);
  return {
    isDown: (code) => held.has(code),
    justPressed: () => false,
    endStep() {},
    dispose() {},
  };
}
