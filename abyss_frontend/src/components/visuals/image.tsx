"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { galleryFrame } from "@/lib/visuals/gallery-frame";
import { PROXIED_IMAGE, type ImageData, type WikimediaImage } from "@/lib/visuals/schemas";

/** Where the browser loads an image: Wikimedia directly, a web image through our proxy. */
function imageAddress(src: string): string {
  return PROXIED_IMAGE.test(src) ? `${process.env.NEXT_PUBLIC_API_URL}/api/v1/images/proxy?t=${encodeURIComponent(src)}` : src;
}

/** The site an image is credited to: the one the search named (a Wikipedia poster,
 *  a web image's site); otherwise Wikimedia Commons for its own files, or -- when the
 *  model left the site out -- the page's. */
function sourceOf(image: WikimediaImage): string {
  if (image.source) return image.source;
  if (!PROXIED_IMAGE.test(image.src)) return "Wikimedia Commons";
  try {
    return new URL(image.page ?? "").hostname.replace(/^www\./, "") || "the web";
  } catch {
    return "the web";
  }
}

// Wikimedia's image servers throttle a burst of downloads (HTTP 429): a
// failed image is loaded again after these pauses before it counts as failed.
const RETRY_DELAYS_MS = [2000, 5000, 10000];

function Credited({
  image,
  title,
  compact,
  frame,
  onShape,
}: {
  image: WikimediaImage;
  title?: string;
  compact: boolean;
  /** In a gallery: the card shape all its images share (lib/visuals/gallery-frame.ts). */
  frame?: number;
  /** Reports the image's own shape (width / height) once it has loaded. */
  onShape?: (ratio: number) => void;
}) {
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
        // The whole image, never cropped: it is scaled to fit (keeping its aspect
        // ratio), never filled. In a gallery every card shares one shape, taken
        // from the gallery's own images -- so posters get tall cards and
        // landscapes wide ones -- and an image of another shape is letterboxed
        // inside it. The white backing (for transparent diagrams) sits behind the
        // image only, not the empty part of the frame.
        <div
          className={cn("relative w-full overflow-hidden rounded-lg", compact && "bg-muted/40")}
          style={compact ? { aspectRatio: frame ?? 4 / 3 } : undefined}
        >
          {/* Absolutely filling the frame gives the image a definite box to fit in
              (a percentage max-height doesn't resolve against an aspect-ratio height). */}
          <div className={cn("flex items-center justify-center", compact && "absolute inset-0")}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a remote, credited image shown as is */}
            <img
              // A new element per attempt, so the browser requests the image again.
              key={attempt}
              src={imageAddress(image.src)}
              alt={image.alt ?? image.caption ?? title ?? "Image"}
              loading="lazy"
              referrerPolicy="no-referrer"
              crossOrigin="anonymous"
              onError={onError}
              onLoad={(e) => {
                const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
                if (w > 0 && h > 0) onShape?.(w / h);
              }}
              className={cn(
                "block h-auto w-auto max-w-full rounded-lg bg-white object-contain",
                compact ? "max-h-full" : "max-h-[480px]",
              )}
            />
          </div>
        </div>
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
  // Each image's own shape once loaded; the cards share the gallery's shape.
  const [shapes, setShapes] = useState<Record<number, number>>({});
  const frame = galleryFrame(Object.values(shapes));
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
            <Credited
              image={image}
              title={title}
              compact
              frame={frame}
              onShape={(ratio) => setShapes((prev) => (prev[i] === ratio ? prev : { ...prev, [i]: ratio }))}
            />
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
