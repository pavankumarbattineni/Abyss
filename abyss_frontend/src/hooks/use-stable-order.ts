"use client";

import { useRef, useState } from "react";

/**
 * Keeps a list in the order it had while the user is pointing at it or
 * moving through it with the keyboard.
 *
 * The agent and thread lists are sorted by last use, so using an item moves
 * it to the top -- and every item above its old place one row down. Without
 * this, that re-sort happens under a pointer that is still resting where the
 * user clicked (it runs when a message is sent and again when the answer
 * finishes), so the next click at the same spot opens a different agent or
 * thread. While held, items keep their places; new items are shown first
 * (e.g. an agent just created) and removed ones disappear; the latest order
 * applies as soon as the pointer leaves and focus moves out of the list.
 *
 * Spread `bind` on the list's container.
 */
export function useStableOrder<T>(items: T[], idOf: (item: T) => string) {
  const [held, setHeld] = useState<string[] | null>(null);
  const inside = useRef({ pointer: false, focus: false });

  const hold = () => setHeld((current) => current ?? items.map(idOf));
  const releaseIfIdle = () => {
    if (!inside.current.pointer && !inside.current.focus) setHeld(null);
  };

  const bind = {
    onPointerEnter: () => {
      inside.current.pointer = true;
      hold();
    },
    onPointerLeave: () => {
      inside.current.pointer = false;
      releaseIfIdle();
    },
    // Keyboard focus only: a mouse click also focuses the link, and the
    // pointer rule above already covers mouse use.
    onFocus: (event: React.FocusEvent<HTMLElement>) => {
      if (!(event.target as Element).matches?.(":focus-visible")) return;
      inside.current.focus = true;
      hold();
    },
    onBlur: (event: React.FocusEvent<HTMLElement>) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return; // focus moved within the list
      inside.current.focus = false;
      releaseIfIdle();
    },
  };

  if (!held) return { items, bind };
  const place = new Map(held.map((id, index) => [id, index]));
  const fresh = items.filter((item) => !place.has(idOf(item)));
  const known = items
    .filter((item) => place.has(idOf(item)))
    .sort((a, b) => place.get(idOf(a))! - place.get(idOf(b))!);
  return { items: [...fresh, ...known], bind };
}
