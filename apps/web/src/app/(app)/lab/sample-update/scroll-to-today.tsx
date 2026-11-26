'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/** Scrolls the grid sideways so today's column is in view (centred where possible). */
export function ScrollToToday({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const wrap = ref.current?.querySelector<HTMLElement>('.table-wrap');
    const today = wrap?.querySelector<HTMLElement>('[data-today]');
    if (!wrap || !today) return;
    const pinned = wrap.querySelector<HTMLElement>('thead th')?.offsetWidth ?? 0;
    const visible = wrap.clientWidth - pinned;
    wrap.scrollLeft = Math.max(0, today.offsetLeft - pinned - visible / 2 + today.offsetWidth / 2);
  }, []);
  return <div ref={ref}>{children}</div>;
}
