/** Tiny DOM helper. Always textContent, never innerHTML: room names come from the server. */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") el.className = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== false && value != null) el.setAttribute(key, value === true ? "" : value);
  }
  el.append(...children.flat().filter((c) => c != null));
  return el;
}

export function createOverlay(root) {
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

export const describeError = (err) => {
  switch (err?.name) {
    case "HttpError":
      return `The server answered ${err.status} for ${err.url}.`;
    case "TimeoutError":
      return "The server did not answer in time.";
    case "AbortError":
      return "Loading was cancelled.";
    case "BadPayloadError":
      return `The server sent unusable data: ${err.message}`;
    default:
      return err instanceof TypeError
        ? "Network error: is the server reachable?"
        : String(err?.message ?? err);
  }
};
