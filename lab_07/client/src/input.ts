const PREVENT_DEFAULT = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"]);

export interface InputSource {
  isDown(code: string): boolean;
  justPressed(code: string): boolean;
  endStep(): void;
  dispose(): void;
}

/**
 * Keyboard state as a closure: `down` and `pressed` are private, the returned object is the API.
 * `justPressed` is edge-triggered and cleared by `endStep()` after every simulation step.
 */
export function createInput(target: Window): InputSource {
  const down = new Set<string>();
  const pressed = new Set<string>();

  const onKeyDown = (e: KeyboardEvent): void => {
    if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    down.add(e.code);
    pressed.add(e.code);
  };
  const onKeyUp = (e: KeyboardEvent): void => void down.delete(e.code);
  const onBlur = (): void => {
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
