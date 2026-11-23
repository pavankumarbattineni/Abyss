"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";

import type { ImageData } from "@/lib/visuals/schemas";

/**
 * A real image from Wikimedia Commons (found with the agent's search_images
 * tool; the schema only accepts Wikimedia's image hosts), with its caption and
 * the credit its open licence requires: author and licence, linked to the
 * file's page. Loaded straight from Wikimedia; a failed load says so.
 */
export function ImageVisual({ data }: { data: ImageData }) {
  const [failed, setFailed] = useState(false);
  const credit = [data.author, data.license].filter(Boolean).join(" · ");
  return (
    <figure className="flex flex-col items-center gap-2 font-sans">
      {failed ? (
        <div className="flex h-40 w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-border text-xs text-muted-foreground">
          <ImageOff className="size-5" />
          The image couldn&apos;t be loaded from Wikimedia.
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- a remote, credited image shown as is
        <img
          src={data.src}
          alt={data.alt ?? data.caption ?? data.title ?? "Image"}
          loading="lazy"
          referrerPolicy="no-referrer"
          crossOrigin="anonymous"
          onError={() => setFailed(true)}
          className="max-h-[480px] w-auto max-w-full rounded-lg bg-white object-contain"
        />
      )}
      {(data.caption || credit) && (
        <figcaption className="max-w-prose text-center text-[13px] leading-snug">
          {data.caption && <span className="block text-foreground">{data.caption}</span>}
          {credit && (
            <span className="block text-xs text-muted-foreground">
              {data.page ? (
                <a href={data.page} target="_blank" rel="noopener noreferrer" className="underline decoration-border underline-offset-2 hover:text-foreground">
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
