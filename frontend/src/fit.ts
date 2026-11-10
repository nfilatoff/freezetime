// Fit a match tab into the window: a radar or video gets the height its column leaves, and a long side
// column scrolls inside itself, so the controls, picture and panels are all on screen without scrolling.
import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

const GAP = 28; // px kept free at the bottom of the window (page padding and a margin)

function useMeasure(compute: () => number | null): number {
  const [value, setValue] = useState(Infinity);
  const measure = () => {
    const next = compute();
    if (next !== null) setValue((prev) => (Math.abs(prev - next) > 2 ? next : prev));
  };
  useLayoutEffect(measure); // after every render: two or three rectangles, a state change only on a real change
  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return value;
}

/** Height (px) the element may take so its column ends at the bottom of the window; `Infinity` before
 * it is measured. `column` is a selector of the element's ancestor whose content follows it (default: main). */
export function useFitHeight(ref: RefObject<HTMLElement | null>, column?: string): number {
  return useMeasure(() => {
    const el = ref.current;
    const col = el && (column ? el.closest(column) : document.querySelector("main"));
    if (!el || !col) return null;
    const r = el.getBoundingClientRect();
    const below = col.getBoundingClientRect().bottom - r.bottom; // what follows the element in its column
    return Math.floor(window.innerHeight - (r.top + window.scrollY) - below - GAP);
  });
}

/** Height (px) from the element's top to the bottom of the window: for a side column that scrolls inside. */
export function useFitRest(ref: RefObject<HTMLElement | null>): number {
  return useMeasure(() => {
    const el = ref.current;
    if (!el) return null;
    return Math.floor(window.innerHeight - (el.getBoundingClientRect().top + window.scrollY) - GAP);
  });
}
