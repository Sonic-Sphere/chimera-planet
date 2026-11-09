interface OutfitDragOptions {
  root: HTMLElement;
  assign: (slot: number, part: string) => void;
  move: (from: number, to: number) => void;
}
/** One pointer gesture for mouse, pen and touch; taps keep the ordinary button path. */
export function installOutfitDrag({
  root,
  assign,
  move,
}: OutfitDragOptions): void {
  let gesture: {
    id: number;
    x: number;
    y: number;
    part: string;
    from: number | null;
    touch: boolean;
    active: boolean;
  } | null = null;
  let ghost: HTMLElement | null = null,
    target: HTMLElement | null = null,
    suppressClick = false;
  const clean = () => {
    ghost?.remove();
    ghost = null;
    target?.classList.remove("drop-target");
    target = null;
    if (gesture && root.hasPointerCapture(gesture.id))
      root.releasePointerCapture(gesture.id);
    gesture = null;
  };
  root.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !event.isPrimary) return;
    const source = (event.target as Element).closest<HTMLElement>(
      '.sound:not(:disabled), .slot-target[data-dressed="true"]',
    );
    if (!source) return;
    const from =
      source.dataset.slot === undefined ? null : Number(source.dataset.slot);
    const part = source.dataset.part;
    if (!part) return;
    gesture = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      part,
      from,
      touch: event.pointerType === "touch",
      active: false,
    };
  });
  document.addEventListener(
    "pointermove",
    (event) => {
      if (!gesture || gesture.id !== event.pointerId) return;
      const dx = event.clientX - gesture.x,
        dy = event.clientY - gesture.y;
      if (!gesture.active) {
        if (Math.hypot(dx, dy) < 7) return;
        // A horizontal finger swipe browses the palette; an upward drag dresses a performer.
        if (
          gesture.touch &&
          gesture.from === null &&
          Math.abs(dx) > Math.abs(dy)
        ) {
          clean();
          return;
        }
        gesture.active = true;
        root.setPointerCapture(event.pointerId);
        const outfit = document.querySelector<HTMLElement>(
          `#palette [data-part="${gesture.part}"]`,
        );
        if (outfit) {
          ghost = outfit.cloneNode(true) as HTMLElement;
          ghost.removeAttribute("data-part");
          ghost.setAttribute("aria-hidden", "true");
          Object.assign(ghost.style, {
            position: "fixed",
            width: "72px",
            height: "72px",
            minHeight: "0",
            opacity: ".95",
            pointerEvents: "none",
            zIndex: "1000",
            translate: "none",
            transform: "rotate(-7deg)",
          });
          document.body.append(ghost);
        }
      }
      event.preventDefault();
      if (ghost) {
        ghost.style.left = `${event.clientX - 36}px`;
        ghost.style.top = `${event.clientY - 36}px`;
      }
      const hit =
        document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest<HTMLElement>(".slot-target") ?? null;
      if (hit !== target) {
        target?.classList.remove("drop-target");
        target = hit;
        target?.classList.add("drop-target");
      }
    },
    { passive: false },
  );
  document.addEventListener("pointerup", (event) => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const done = gesture,
      destination = target?.dataset.slot;
    if (done.active) {
      event.preventDefault();
      suppressClick = true;
      setTimeout(() => {
        suppressClick = false;
      }, 0);
    }
    clean();
    if (!done.active || destination === undefined) return;
    if (done.from === null) assign(Number(destination), done.part);
    else move(done.from, Number(destination));
  });
  document.addEventListener("pointercancel", (event) => {
    if (gesture?.id === event.pointerId) clean();
  });
  root.addEventListener(
    "click",
    (event) => {
      if (suppressClick) {
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressClick = false;
      }
    },
    true,
  );
}
