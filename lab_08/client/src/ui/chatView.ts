import { h } from "./dom.js";

const MAX_LINES = 100;

export interface ChatView {
  add(name: string, text: string, kind?: "msg" | "system"): void;
  setTitle(text: string): void;
  onSubmit(fn: (text: string) => void): void;
  destroy(): void;
}

/** Chat panel. The input swallows keydown so typing never steers the ship. */
export function createChatView(parent: HTMLElement): ChatView {
  const log = h("div", { class: "chat-log", role: "log", "aria-live": "polite" });
  const title = h("div", { class: "chat-title" }, "Chat");
  const input = h("input", {
    class: "chat-input",
    maxlength: "200",
    placeholder: "Press Enter to chat…",
    autocomplete: "off",
    "aria-label": "Chat message",
  });
  const root = h("aside", { class: "chat" }, title, log, input);
  let submit: (text: string) => void = () => {};

  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") return input.blur();
    if (e.key !== "Enter") return;
    const text = input.value.trim();
    input.value = "";
    if (text) submit(text);
  });
  const focusOnEnter = (e: KeyboardEvent): void => {
    if (e.key === "Enter" && document.activeElement !== input) {
      e.preventDefault();
      input.focus();
    }
  };
  window.addEventListener("keydown", focusOnEnter);
  parent.append(root);

  return {
    add(name, text, kind = "msg") {
      log.append(
        h("div", { class: `chat-line ${kind}` }, name ? h("b", {}, `${name}: `) : null, text),
      );
      while (log.childElementCount > MAX_LINES) log.firstElementChild?.remove();
      log.scrollTop = log.scrollHeight;
    },
    setTitle(text) {
      title.textContent = text;
    },
    onSubmit(fn) {
      submit = fn;
    },
    destroy() {
      window.removeEventListener("keydown", focusOnEnter);
      root.remove();
    },
  };
}
