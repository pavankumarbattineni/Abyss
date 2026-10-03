"use client";

import { useId } from "react";

import { cn } from "@/lib/utils";

interface AbyssLogoProps {
  size?: number;
  className?: string;
}

export function AbyssLogo({ size = 40, className }: AbyssLogoProps) {
  const gradientId = useId();

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Abyss-AI"
      className={cn("shrink-0", className)}
    >
      <path
        d="M51,4 L94,96 L8,96 Z M51,21 L66,66 L36,70 Z"
        fillRule="evenodd"
        fill={`url(#${gradientId})`}
      />
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6FC3CF" />
          <stop offset="50%" stopColor="#3A7CA5" />
          <stop offset="100%" stopColor="#2B3A67" />
        </linearGradient>
      </defs>
    </svg>
  );
}
