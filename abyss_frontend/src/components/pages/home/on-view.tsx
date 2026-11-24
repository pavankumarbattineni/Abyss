"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Plays a homepage section's motion once, when it first comes into view.
 *
 * Renders its element with data-motion="idle" (rendered by the server too,
 * so nothing flashes) and switches it to "on" in view; globals.css ("Home
 * motion") styles both, the idle state only while scripting is available --
 * without JavaScript the content is simply shown. Reduced motion: on at once.
 * A section already reached -- any part of it above the top of the screen
 * (a fast flick, a jump to a link further down) -- counts as seen, so no part
 * of it is ever left waiting on screen.
 */
export function OnView({
  as: Tag = "div",
  className,
  children,
  ...rest
}: {
  as?: "div" | "ol";
  className?: string;
  children: ReactNode;
} & React.AriaAttributes & { id?: string }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const play = () => node.setAttribute("data-motion", "on");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      play();
      return;
    }
    let frame = 0;
    const stop = () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
    const reached = () => node.getBoundingClientRect().top < 0;
    const observer = new IntersectionObserver(
      (entries) => {
        // Once a good part of it is on screen (not as its edge peeks in from
        // below), or once it is reached from below.
        if (entries.some((entry) => entry.isIntersecting && (entry.intersectionRatio >= 0.25 || reached()))) {
          play();
          stop();
        }
      },
      { threshold: [0, 0.25], rootMargin: "0px 0px -10% 0px" },
    );
    // Jumped past it entirely: the observer sees no change (out of view before
    // and after), so check where it is -- once per frame, until it has played.
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (reached()) {
          play();
          stop();
        }
      });
    };
    observer.observe(node);
    window.addEventListener("scroll", onScroll, { passive: true });
    return stop;
  }, []);

  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <Tag ref={ref as any} data-motion="idle" className={className} {...rest}>
      {children}
    </Tag>
  );
}
