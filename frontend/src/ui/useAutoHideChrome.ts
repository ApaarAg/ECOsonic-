import { useEffect, useRef, useState } from "react";

export interface AutoHideChromeOptions {
  /** Keep chrome pinned visible while interacting (e.g. dropdown open or focus inside header). */
  pinned?: boolean;
  /** Respect user reduced-motion preference (shorter opacity fade, gentler threshold). */
  reducedMotion?: boolean;
  /** Idle delay after scrolling stops before chrome restores (ms). */
  idleRestoreMs?: number;
}

/**
 * Coordinates smooth header auto-hide during active cinematic scrolling:
 * - Visible initially when idle
 * - Hides gently once scroll displacement occurs while pointer is clear of the top bar
 * - Restores after scroll inactivity or immediately when moving pointer to top edge
 * - Avoids permanent lockouts on touch/mobile viewports via inactivity restore
 */
export function useAutoHideChrome({
  pinned = false,
  idleRestoreMs = 950,
}: AutoHideChromeOptions = {}): boolean {
  const [scrollHidden, setScrollHidden] = useState(false);
  const lastScrollYRef = useRef<number>(
    typeof window !== "undefined" ? window.scrollY : 0,
  );
  const idleTimerRef = useRef<number | null>(null);
  const pointerNearTopRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const clearIdleTimer = () => {
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };

    const scheduleRestore = () => {
      clearIdleTimer();
      idleTimerRef.current = window.setTimeout(() => {
        setScrollHidden(false);
        idleTimerRef.current = null;
      }, idleRestoreMs);
    };

    const handleScroll = () => {
      const y = window.scrollY;
      const delta = Math.abs(y - lastScrollYRef.current);
      lastScrollYRef.current = y;

      // Ignore tiny sub-pixel scroll jitter; keep chrome visible near very top (ACT 01 landing)
      if (y <= 16) {
        clearIdleTimer();
        setScrollHidden(false);
        return;
      }

      if (delta >= 4 && !pointerNearTopRef.current) {
        setScrollHidden(true);
      }
      scheduleRestore();
    };

    const handlePointerMove = (ev: PointerEvent) => {
      if (ev.pointerType === "touch") return;
      const nearTop = ev.clientY <= 84;
      pointerNearTopRef.current = nearTop;
      if (nearTop) {
        clearIdleTimer();
        setScrollHidden(false);
      }
    };

    const handleTouchStart = (ev: TouchEvent) => {
      const touchY = ev.touches[0]?.clientY ?? 999;
      if (touchY <= 84) {
        clearIdleTimer();
        setScrollHidden(false);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("touchstart", handleTouchStart, { passive: true });

    return () => {
      clearIdleTimer();
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("touchstart", handleTouchStart);
    };
  }, [idleRestoreMs]);

  return pinned || !scrollHidden;
}
