/** DPR-aware canvas that letterboxes the logical arena; the arena can change (each room has its own). */
export function createCanvasView(canvas, initialArena) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context is not available in this browser.");

  let arena = initialArena;
  const view = { dpr: 1, cssWidth: 1, cssHeight: 1, scale: 1, offsetX: 0, offsetY: 0 };

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.max(1, Math.floor(rect.width));
    const cssHeight = Math.max(1, Math.floor(rect.height));
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    const scale = Math.min(cssWidth / arena.width, cssHeight / arena.height);
    Object.assign(view, {
      dpr,
      cssWidth,
      cssHeight,
      scale,
      offsetX: (cssWidth - arena.width * scale) / 2,
      offsetY: (cssHeight - arena.height * scale) / 2,
    });
  }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  window.addEventListener("resize", resize);
  resize();

  return {
    ctx,
    view,
    get arena() {
      return arena;
    },
    setArena(next) {
      arena = next;
      resize();
    },
    useScreenSpace() {
      ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    },
    useWorldSpace() {
      const s = view.dpr * view.scale;
      ctx.setTransform(s, 0, 0, s, view.dpr * view.offsetX, view.dpr * view.offsetY);
    },
    dispose() {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    },
  };
}
