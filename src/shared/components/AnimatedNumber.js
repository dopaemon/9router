"use client";

import { useEffect, useRef, useState } from "react";

/**
 * AnimatedNumber — renders a number that eases toward its new value.
 *
 * Why: the usage page updates live (SSE), and a plain text swap makes it
 * impossible to notice that a counter moved. Easing the digits over ~600 ms
 * keeps additions visible without turning the dashboard into a slot machine.
 *
 * - `value` may arrive as null/undefined while the first stats payload loads.
 * - `format` defaults to the same Intl grouping the rest of the page uses.
 * - When the target jumps by more than `snapAfter`, the animation is skipped:
 *   a 40k-token jump would otherwise spin for seconds with no visual benefit.
 * - Respects `prefers-reduced-motion`: renders the final value immediately.
 */
export default function AnimatedNumber({
  value,
  format,
  duration = 600,
  snapAfter = 0,
  className,
  title,
}) {
  const target = Number.isFinite(Number(value)) ? Number(value) : 0;
  const fmt = format || ((n) => new Intl.NumberFormat().format(n));
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);
  const rafRef = useRef(null);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const from = displayRef.current;
    const delta = Math.abs(target - from);

    if (reduced || duration <= 0 || (snapAfter > 0 && delta > snapAfter) || delta === 0) {
      displayRef.current = target;
      const settle = requestAnimationFrame(() => setDisplay(target));
      return () => cancelAnimationFrame(settle);
    }

    const startedAt = performance.now();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const tick = (now) => {
      const t = Math.min(1, (now - startedAt) / duration);
      // easeOutCubic: fast start, settles softly on the final digit
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + (target - from) * eased;
      displayRef.current = current;
      setDisplay(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        displayRef.current = target;
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration, snapAfter]);

  // Integer counters must not show fractions mid-animation.
  const rendered = fmt(Math.round(display));
  return (
    <span className={className} title={title ?? fmt(target)}>
      {rendered}
    </span>
  );
}
