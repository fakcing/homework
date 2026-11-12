export type Child = Node | string | null | undefined | false;
export type Props = Readonly<
  Record<string, string | number | boolean | EventListener | null | undefined>
>;

/** Tiny DOM helper. Always textContent, never innerHTML: room names come from the server. The tag name decides the element type. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") el.className = String(value);
    else if (typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== false && value != null)
      el.setAttribute(key, value === true ? "" : String(value));
  }
  el.append(...children.flat().filter((c): c is Node | string => c != null && c !== false));
  return el;
}

export interface Overlay {
  show(...nodes: Node[]): void;
  clear(): void;
}

export function createOverlay(root: HTMLElement): Overlay {
  return {
    show(...nodes) {
      root.replaceChildren(...nodes);
      root.classList.add("visible");
    },
    clear() {
      root.replaceChildren();
      root.classList.remove("visible");
    },
  };
}

export function describeError(err: unknown): string {
  if (err instanceof Error) {
    switch (err.name) {
      case "HttpError":
        return `The server answered with an error: ${err.message}.`;
      case "TimeoutError":
        return "The server did not answer in time.";
      case "AbortError":
        return "Loading was cancelled.";
      case "BadPayloadError":
        return `The server sent unusable data: ${err.message}`;
      default:
        return err instanceof TypeError ? "Network error: is the server reachable?" : err.message;
    }
  }
  return String(err);
}
