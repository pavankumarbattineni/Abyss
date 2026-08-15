"use client";

import { useCallback, useRef, useState } from "react";

interface UseResizablePanelOptions {
  initialWidth: number;
  minWidth: number;
  maxWidth: number;
}

interface UseResizablePanelResult {
  width: number;
  isDragging: boolean;
  handlePointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
}

export function useResizablePanel({
  initialWidth,
  minWidth,
  maxWidth,
}: UseResizablePanelOptions): UseResizablePanelResult {
  const [width, setWidth] = useState<number>(initialWidth);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const widthRef = useRef<number>(initialWidth);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = widthRef.current;
      setIsDragging(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const nextWidth = Math.min(
          maxWidth,
          Math.max(minWidth, startWidth + (moveEvent.clientX - startX)),
        );
        widthRef.current = nextWidth;
        setWidth(nextWidth);
      };

      const handlePointerUp = () => {
        setIsDragging(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [minWidth, maxWidth],
  );

  return { width, isDragging, handlePointerDown };
}
