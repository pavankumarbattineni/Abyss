"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { PROXIED_IMAGE, type ImageData, type WikimediaImage } from "@/lib/visuals/schemas";

/** Where the browser loads an image: Wikimedia directly, a web image through our proxy. */
function imageAddress(src: string): string {
  return PROXIED_IMAGE.test(src) ? `${process.env.NEXT_PUBLIC_API_URL}/api/v1/images/proxy?t=${encodeURIComponent(src)}` : src;
}

/** The site an image is credited to: Wikimedia Commons for its own files; for a web
 *  image, its site as the search gave it -- or, when the model left that out, its page's. */
function sourceOf(image: WikimediaImage): string {
  if (!PROXIED_IMAGE.test(image.src)) return "Wikimedia Commons";
  if (image.source) return image.source;
  try {
    return new URL(image.page ?? "").hostname.replace(/^www\./, "") || "the web";
  } catch {
    return "the web";
  }
}

// Wikimedia's image servers throttle a burst of downloads (HTTP 429): a
// failed image is loaded again after these pauses before it counts as failed.
const RETRY_DELAYS_MS = [2000, 5000, 10000];

function Credited({ image, title, compact }: { image: WikimediaImage; title?: string; compact: boolean }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const source = sourceOf(image);
  // A web image is always credited to its owner, even if the model dropped the licence.
  const license = image.license || (PROXIED_IMAGE.test(image.src) ? "© its owner" : undefined);
  const credit = [image.author, license].filter(Boolean).join(" · ");
  const retryTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(retryTimer.current), []);
  const onError = () => {
    if (attempt >= RETRY_DELAYS_MS.length) {
      setFailed(true);
      return;
    }
    retryTimer.current = window.setTimeout(() => setAttempt((a) => a + 1), RETRY_DELAYS_MS[attempt]);
  };
  return (
    <figure className="flex min-w-0 flex-col items-center gap-2">
      {failed ? (
        <div className="flex h-40 w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-border text-xs text-muted-foreground">
          <ImageOff className="size-5" />
          The image couldn&apos;t be loaded from {source}.
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- a remote, credited image shown as is
        <img
          // A new element per attempt, so the browser requests the image again.
          key={attempt}
          src={imageAddress(image.src)}
          alt={image.alt ?? image.caption ?? title ?? "Image"}
          loading="lazy"
          referrerPolicy="no-referrer"
          crossOrigin="anonymous"
          onError={onError}
          className={cn(
            "max-w-full rounded-lg bg-white",
            compact ? "aspect-[4/3] w-full object-cover" : "max-h-[480px] w-auto object-contain",
          )}
        />
      )}
      {(image.caption || credit) && (
        <figcaption className="max-w-prose text-center text-[13px] leading-snug">
          {image.caption && <span className="block text-foreground">{image.caption}</span>}
          {credit && (
            <span className="block text-xs text-muted-foreground">
              {image.page ? (
                <a href={image.page} target="_blank" rel="noopener noreferrer" className="underline decoration-border underline-offset-2 hover:text-foreground">
                  {credit}, via {source}
                </a>
              ) : (
                `${credit}, via ${source}`
              )}
            </span>
          )}
        </figcaption>
      )}
    </figure>
  );
}

/**
 * Real images found with the agent's search_images tool (the schema accepts
 * only Wikimedia's image hosts and web image tokens the server signed): one
 * image, or a horizontal carousel of up to eight. Wikimedia images carry the
 * credit their open licence requires and load straight from Wikimedia; web
 * images are credited to their site and load through the image proxy. Each
 * credit links to the image's page; a failed load says so.
 */
export function ImageVisual({ data }: { data: ImageData }) {
  if (data.images.length > 1) return <Carousel images={data.images} title={data.title} />;
  return (
    <div className="font-sans">
      <Credited image={data.images[0]} title={data.title} compact={false} />
    </div>
  );
}

/**
 * Several images: a row that scrolls sideways, left to right and back (swipe,
 * trackpad, the arrow buttons, or ← → when focused), snapping to each image,
 * with a position counter. Every image keeps its credit.
 */
/** Images in view at once in a carousel. */
const VISIBLE = 2;

function Carousel({ images, title }: { images: WikimediaImage[]; title?: string }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  // The last position still shows two images: it starts at the second-to-last.
  const lastStart = Math.max(0, images.length - VISIBLE);
  const go = (to: number) => {
    const row = rowRef.current;
    const target = row?.children[Math.max(0, Math.min(lastStart, to))] as HTMLElement | undefined;
    if (row && target) row.scrollTo({ left: target.offsetLeft - row.offsetLeft, behavior: "smooth" });
  };
  const onScroll = () => {
    const row = rowRef.current;
    if (!row) return;
    const items = Array.from(row.children) as HTMLElement[];
    const left = row.scrollLeft;
    const nearest = items.reduce((best, el, i) => (Math.abs(el.offsetLeft - row.offsetLeft - left) < Math.abs(items[best].offsetLeft - row.offsetLeft - left) ? i : best), 0);
    setIndex(Math.min(nearest, Math.max(0, images.length - VISIBLE)));
  };
  return (
    <div className="font-sans" role="group" aria-roledescription="carousel" aria-label={title ?? "Images"}>
      <div
        ref={rowRef}
        onScroll={onScroll}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") go(index + 1);
          else if (e.key === "ArrowLeft") go(index - 1);
          else return;
          e.preventDefault();
        }}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain pb-2 outline-none [scrollbar-width:thin] focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/* Two images in view at every width; the third and later scroll in. */}
        {images.map((image, i) => (
          <div key={`${image.src}-${i}`} className="w-[calc(50%-0.5rem)] shrink-0 snap-start" aria-label={`${i + 1} of ${images.length}`}>
            <Credited image={image} title={title} compact />
          </div>
        ))}
      </div>
      {images.length > VISIBLE && (
        <div className="mt-1 flex items-center justify-center gap-3 text-xs text-muted-foreground" data-export-skip="">
          <button type="button" aria-label="Previous images" onClick={() => go(index - 1)} disabled={index === 0} className="grid size-7 place-items-center rounded-full border border-border hover:bg-muted disabled:opacity-40">
            <ChevronLeft className="size-4" />
          </button>
          <span className="tabular-nums" aria-live="polite">
            {index + 1}–{Math.min(images.length, index + VISIBLE)} of {images.length}
          </span>
          <button type="button" aria-label="Next images" onClick={() => go(index + 1)} disabled={index >= lastStart} className="grid size-7 place-items-center rounded-full border border-border hover:bg-muted disabled:opacity-40">
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
