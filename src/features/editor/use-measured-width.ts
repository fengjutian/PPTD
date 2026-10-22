import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * The width of an element in CSS pixels, kept up to date while the window or
 * the panel around it changes.
 *
 * The thumbnail needs it because the text of a page can only be drawn with the
 * scale of the box it is drawn in. A page that is drawn in a box of a
 * different size has to be drawn with a different scale, otherwise the text of
 * the preview does not have the size it has on the canvas.
 */
export function useMeasuredWidth<T extends HTMLElement>(): { ref: RefObject<T | null>; width: number } {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = ref.current;
    // Environments without a resize observer (the server side of a test) keep
    // the width they were given instead of measuring anything.
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      setWidth((current) => (Math.abs(current - next) > 0.5 ? next : current));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}
