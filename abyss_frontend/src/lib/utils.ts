import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { AxiosError } from "axios"

import type { ApiError } from "@/lib/axios"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof AxiosError)) return fallback

  const data = error.response?.data as ApiError | undefined
  if (data?.message) return data.message

  if (typeof data?.detail === "string") return data.detail
  if (Array.isArray(data?.detail) && data.detail.length > 0) {
    return data.detail.map((item) => item.msg).join(", ")
  }

  return fallback
}
