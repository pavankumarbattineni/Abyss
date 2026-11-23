"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ImageData, WikimediaImage } from "@/lib/visuals/schemas";

function Credited({ image, title, compact }: { image: WikimediaImage; title?: string; compact: boolean }) {
  const [failed, setFailed] = useState(false);
  const credit = [image.author, image.license].filter(Boolean).join(" · ");
  return (
    <figure className="flex min-w-0 flex-col items-center gap-2">
      {failed ? (
        <div className="flex h-40 w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-border text-xs text-muted-foreground">
          <ImageOff className="size-5" />
          The image couldn&apos;t be loaded from Wikimedia.
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- a remote, credited image shown as is
        <img
          src={image.src}
          alt={image.alt ?? image.caption ?? title ?? "Image"}
          loading="lazy"
          referrerPolicy="no-referrer"
          crossOrigin="anonymous"
          onError={() => setFailed(true)}
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
                  {credit}, via Wikimedia Commons
                </a>
              ) : (
                `${credit}, via Wikimedia Commons`
              )}
            </span>
          )}
        </figcaption>
      )}
    </figure>
  );
}

/**
 * Real images from Wikimedia Commons (found with the agent's search_images
 * tool; the schema only accepts Wikimedia's image hosts): one image, or a
 * gallery of up to four side by side. Each carries the credit its open
 * licence requires -- author and licence, linked to the file's page -- and
 * loads straight from Wikimedia; a failed load says so.
 */
export function ImageVisual({ data }: { data: ImageData }) {
  const gallery = data.images.length > 1;
  return (
    <div className={cn("font-sans", gallery && "grid grid-cols-1 gap-4 sm:grid-cols-2")}>
      {data.images.map((image, i) => (
        <Credited key={`${image.src}-${i}`} image={image} title={data.title} compact={gallery} />
      ))}
    </div>
  );
}
