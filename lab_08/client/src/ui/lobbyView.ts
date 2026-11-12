import type { Lobby } from "../lobby/lobby.js";
import type { Overlay } from "./dom.js";
import { describeError, h } from "./dom.js";

export interface LobbyView {
  destroy(): void;
}

/** DOM for the Lobby model. Everything it subscribes to is removed through one AbortController. */
export function createLobbyView(
  overlay: Overlay,
  lobby: Lobby,
  { defaultName = "Pilot" }: { defaultName?: string } = {},
): LobbyView {
  const life = new AbortController();
  const { signal } = life;

  const nameInput = h("input", {
    id: "pilot",
    maxlength: "16",
    value: defaultName,
    autocomplete: "off",
  });
  const list = h("div", { class: "rooms", role: "radiogroup", "aria-label": "Rooms" });
  const status = h("p", { class: "status", role: "status" });
  const hint = h("p", { class: "hint" });
  const joinBtn = h(
    "button",
    { class: "primary", disabled: true, onClick: () => submit() },
    "Join",
  );
  const refreshBtn = h("button", { onClick: () => lobby.refresh() }, "Refresh");
  const newBtn = h(
    "button",
    {
      onClick: async () => {
        try {
          await lobby.create(`${nameInput.value.trim() || defaultName}'s room`);
          hint.textContent = "";
        } catch (err: unknown) {
          hint.textContent = describeError(err);
        }
      },
    },
    "New room",
  );

  function submit(): void {
    const result = lobby.join(nameInput.value);
    hint.textContent = result.ok ? "" : result.reason;
  }

  function renderRooms(): void {
    list.replaceChildren(
      ...lobby.rooms.map((room) => {
        const full = room.players >= room.max;
        return h(
          "button",
          {
            class: `room${room.id === lobby.selectedId ? " selected" : ""}`,
            role: "radio",
            "aria-checked": String(room.id === lobby.selectedId),
            disabled: full,
            onClick: () => lobby.select(room.id),
          },
          h("strong", {}, room.name),
          h(
            "span",
            {},
            `${room.players}/${room.max}${full ? " · full" : ""} · ${room.arena.width}×${room.arena.height}`,
          ),
        );
      }),
    );
    joinBtn.disabled = lobby.selectedId === null;
  }

  function renderStatus(): void {
    const text: Record<typeof lobby.status, string> = {
      idle: "",
      loading: "Loading rooms…",
      ready: `${lobby.rooms.length} rooms · updates every few seconds`,
      error: `${describeError(lobby.error)} Retrying automatically.`,
    };
    status.textContent = text[lobby.status];
    status.classList.toggle("error", lobby.status === "error");
  }

  lobby.on("rooms", renderRooms, { signal });
  lobby.on("status", renderStatus, { signal });
  nameInput.addEventListener("keydown", (e) => e.key === "Enter" && submit(), { signal });
  // No point polling while the tab is hidden.
  document.addEventListener(
    "visibilitychange",
    () => (document.hidden ? lobby.stop() : lobby.start()),
    { signal },
  );

  overlay.show(
    h(
      "section",
      { class: "card" },
      h("h1", {}, "Dogfight"),
      h("label", { for: "pilot" }, "Pilot name"),
      nameInput,
      h("label", {}, "Room"),
      list,
      status,
      hint,
      h("div", { class: "row" }, newBtn, refreshBtn, joinBtn),
    ),
  );
  renderRooms();
  renderStatus();
  lobby.start();
  nameInput.focus();

  return {
    destroy() {
      life.abort();
      lobby.stop(); // aborts the request that may still be in flight
      overlay.clear();
    },
  };
}
