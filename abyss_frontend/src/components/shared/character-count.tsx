import { cn } from "@/lib/utils";

const format = (n: number) => n.toLocaleString("en-US");

/**
 * A live character count under a text field: "used / max", turning amber near
 * the limit and red past it. With `min`, it shows "used / min minimum" until
 * the minimum is reached. Give the field `aria-describedby={id}` so screen
 * readers hear the count with the field (no live announcement per keystroke).
 */
export function CharacterCount({
  id,
  value,
  max,
  min,
}: {
  id: string;
  value?: string;
  max: number;
  min?: number;
}) {
  const used = value?.length ?? 0;
  const short = min !== undefined && used < min;
  const over = used > max;
  const near = !over && used >= max * 0.9;
  return (
    <p
      id={id}
      className={cn(
        "self-end text-xs tabular-nums text-muted-foreground",
        near && "text-warning",
        over && "font-medium text-destructive",
      )}
    >
      {short ? (
        <>
          {format(used)} / {format(min)} minimum
          <span className="sr-only"> characters</span>
        </>
      ) : (
        <>
          {format(used)} / {format(max)}
          {over && <span className="sr-only"> characters: over the limit</span>}
          {!over && <span className="sr-only"> characters</span>}
        </>
      )}
    </p>
  );
}
