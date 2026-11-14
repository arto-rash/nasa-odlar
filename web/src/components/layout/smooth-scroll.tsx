"use client";

import Lenis from "lenis";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Inertial scrolling on long-form pages. Off for full-screen map views (they own
// the wheel) and for people who prefer reduced motion.
const NO_SMOOTH = /\/(explore|risk)(\/|$)/;

export function SmoothScroll() {
  const pathname = usePathname();
  useEffect(() => {
    if (NO_SMOOTH.test(pathname)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({ lerp: 0.11, wheelMultiplier: 0.95, smoothWheel: true });
    let raf = 0;
    const loop = (t: number) => {
      lenis.raf(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, [pathname]);
  return null;
}
