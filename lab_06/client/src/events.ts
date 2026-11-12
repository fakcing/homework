/**
 * An EventTarget with a typed event map: `emit("join", detail)` and `on("join", (detail) => …)` are checked
 * against `E`, so a typo in the event name or a wrong detail shape is a compile error, not a silent no-op.
 */
export class TypedEvents<E extends Record<string, unknown>> extends EventTarget {
  protected emit<K extends keyof E & string>(type: K, detail: E[K]): void {
    this.dispatchEvent(new CustomEvent<E[K]>(type, { detail }));
  }

  on<K extends keyof E & string>(
    type: K,
    listener: (detail: E[K]) => void,
    options?: AddEventListenerOptions,
  ): () => void {
    const handler = (event: Event): void => {
      if (event instanceof CustomEvent) listener(event.detail); // `detail` is `any` in lib.dom; K ties it to E[K] here
    };
    this.addEventListener(type, handler, options);
    return () => this.removeEventListener(type, handler);
  }
}
