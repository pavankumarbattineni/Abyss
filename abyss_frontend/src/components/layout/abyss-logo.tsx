import { cn } from "@/lib/utils";

/**
 * Abyss's mark, "the descent": a ring with a solid disc sitting low inside
 * it and a Tomato point at the deepest spot -- looking down into a well that
 * recedes into depth, with the spark of intelligence brought up from the
 * bottom. Built like Trench's mark (an ink symbol on a brand-colour tile) so
 * the two apps read as siblings, but its own symbol.
 *
 * Colours come from the theme tokens, so the tile follows light/dark mode.
 * Keep in sync with src/app/icon.svg (the favicon, which needs fixed colours).
 */
export function AbyssMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <circle cx="20" cy="18.5" r="11.5" fill="none" stroke="currentColor" strokeWidth="3.6" />
      <circle cx="20" cy="22" r="6.4" fill="currentColor" />
      <circle cx="20" cy="24.2" r="2.3" fill="var(--highlight)" />
    </svg>
  );
}

interface AbyssLogoProps {
  size?: number;
  className?: string;
}

/** The mark on its Sage tile. */
export function AbyssLogo({ size = 40, className }: AbyssLogoProps) {
  return (
    <span
      role="img"
      aria-label="Abyss"
      style={{ width: size, height: size, borderRadius: size * 0.27 }}
      className={cn(
        "flex shrink-0 items-center justify-center bg-primary text-primary-foreground",
        className,
      )}
    >
      <AbyssMark className="size-[88%]" />
    </span>
  );
}

export function AbyssWordmark({ className }: { className?: string }) {
  return <span className={cn("font-bold tracking-tight text-foreground", className)}>Abyss</span>;
}
