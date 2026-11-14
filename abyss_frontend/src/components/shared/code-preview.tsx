"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AppWindow, CodeXml, Download, Maximize2, Minimize2, Play, RotateCw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui";
import {
  buildHtmlPreview,
  buildReactPreview,
  compileReactComponent,
  downloadableHtml,
  type PreviewKind,
} from "@/lib/code-preview";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./code-block";
import { CopyButton } from "./copy-button";

/** Asks the chat composer to prefill a message (handled in chat-panel.tsx). */
export const COMPOSE_EVENT = "abyss:compose";

const MIN_HEIGHT = 160;
const COLLAPSED_MAX_HEIGHT = 640;
const READY_TIMEOUT_MS = 10_000;
const MAX_ERRORS = 3;

interface CodePreviewProps {
  kind: PreviewKind;
  language: string;
  code: string;
}

interface FrameState {
  key: string;
  ready: boolean;
  timedOut: boolean;
  height: number;
  errors: string[];
}

const freshFrame = (key: string): FrameState => ({ key, ready: false, timedOut: false, height: MIN_HEIGHT, errors: [] });

/**
 * A live preview of frontend code an agent wrote, run in a sandboxed iframe
 * (see lib/code-preview.ts for the isolation rules). Preview shows only the
 * running page, Code only its source -- the same pattern as InteractiveBlock.
 */
export function CodePreview({ kind, language, code }: CodePreviewProps) {
  const [mode, setMode] = useState<"preview" | "code">("preview");
  const [expanded, setExpanded] = useState<boolean>(false);
  const [reloadKey, setReloadKey] = useState<number>(0);
  const frameRef = useRef<HTMLIFrameElement>(null);
  // One channel per run (code + reload): messages from other frames or older
  // runs are ignored, and all run state below is keyed by it.
  const channel = useMemo(() => `preview-${crypto.randomUUID()}`, [code, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const runtimeBase = typeof window === "undefined" ? "" : `${window.location.origin}/preview-runtime`;

  const htmlDoc = useMemo(
    () => (kind === "html" && runtimeBase ? buildHtmlPreview(code, channel, runtimeBase) : null),
    [kind, code, channel, runtimeBase],
  );
  const [compiled, setCompiled] = useState<{ key: string; doc?: string; error?: string } | null>(null);
  useEffect(() => {
    if (kind !== "react" || !runtimeBase) return;
    let cancelled = false;
    compileReactComponent(code).then((result) => {
      if (cancelled) return;
      setCompiled({
        key: channel,
        doc: result.code ? buildReactPreview(result.code, channel, runtimeBase) : undefined,
        error: result.code ? undefined : (result.error ?? "The component couldn't be compiled."),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [kind, code, channel, runtimeBase]);
  const reactResult = compiled?.key === channel ? compiled : null;
  const doc = kind === "html" ? htmlDoc : (reactResult?.doc ?? null);

  const [frameState, setFrameState] = useState<FrameState>(() => freshFrame(channel));
  const frame = frameState.key === channel ? frameState : freshFrame(channel);
  const updateFrame = (change: (current: FrameState) => Partial<FrameState>) =>
    setFrameState((prev) => {
      const current = prev.key === channel ? prev : freshFrame(channel);
      return { ...current, ...change(current) };
    });

  // Messages from this preview's frame only: height, ready, errors.
  useEffect(() => {
    if (!doc) return;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as { channel?: unknown; type?: unknown; data?: unknown } | null;
      if (!data || data.channel !== channel) return;
      if (data.type === "height" && typeof data.data === "number" && Number.isFinite(data.data)) {
        const height = Math.max(MIN_HEIGHT, Math.min(Math.round(data.data), 20_000));
        updateFrame(() => ({ height }));
      } else if (data.type === "ready") {
        updateFrame(() => ({ ready: true }));
      } else if (data.type === "error") {
        const message = String((data.data as { message?: unknown } | null)?.message ?? "Error").slice(0, 500);
        updateFrame((c) => ({
          errors: c.errors.includes(message) || c.errors.length >= MAX_ERRORS ? c.errors : [...c.errors, message],
        }));
      }
    };
    window.addEventListener("message", onMessage);
    const timer = window.setTimeout(() => updateFrame(() => ({ timedOut: true })), READY_TIMEOUT_MS);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
    };
  }, [doc, channel]); // eslint-disable-line react-hooks/exhaustive-deps

  const building = kind === "react" && !reactResult;
  const errors = [...(reactResult?.error ? [reactResult.error] : []), ...frame.errors];
  const failed = Boolean(reactResult?.error) || (frame.timedOut && !frame.ready);
  const height = frame.height;

  const download = () => {
    const url = URL.createObjectURL(downloadableHtml(code));
    const link = document.createElement("a");
    link.href = url;
    link.download = "preview.html";
    link.click();
    URL.revokeObjectURL(url);
  };

  const askToFix = () => {
    const text = `The live preview shows ${errors.length === 1 ? "this error" : "these errors"}:\n${errors
      .map((e) => `- ${e}`)
      .join("\n")}\nPlease fix the code.`;
    window.dispatchEvent(new CustomEvent(COMPOSE_EVENT, { detail: text }));
  };

  const label = kind === "react" ? "React" : "HTML";
  const frameHeight = expanded ? height : Math.min(height, COLLAPSED_MAX_HEIGHT);

  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-border font-sans text-sm leading-normal last:mb-0">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted px-3 py-1">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <AppWindow className="size-3.5 shrink-0" />
          <span className="truncate">Live preview · {label}</span>
        </span>
        <div className="flex items-center gap-0.5">
          {([
            { value: "preview", title: "Preview", Icon: Play },
            { value: "code", title: "Code", Icon: CodeXml },
          ] as const).map(({ value, title, Icon }) => (
            <Button
              key={value}
              variant="ghost"
              size="icon-xs"
              aria-label={title}
              aria-pressed={mode === value}
              title={title}
              onClick={() => setMode(value)}
              className={cn("text-muted-foreground hover:text-foreground", mode === value && "bg-background text-foreground")}
            >
              <Icon className="size-3.5" />
            </Button>
          ))}
          {mode === "preview" && (
            <>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Reload preview"
                title="Reload preview"
                onClick={() => setReloadKey((k) => k + 1)}
                className="text-muted-foreground hover:text-foreground"
              >
                <RotateCw className="size-3.5" />
              </Button>
              {height > COLLAPSED_MAX_HEIGHT && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={expanded ? "Collapse preview" : "Expand preview"}
                  title={expanded ? "Collapse preview" : "Expand preview"}
                  onClick={() => setExpanded((v) => !v)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                </Button>
              )}
            </>
          )}
          {kind === "html" && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Download HTML"
              title="Download HTML"
              onClick={download}
              className="text-muted-foreground hover:text-foreground"
            >
              <Download className="size-3.5" />
            </Button>
          )}
          <CopyButton label="Copy code" text={code} />
        </div>
      </div>

      {mode === "code" ? (
        <div className="bg-card p-3">
          <CodeBlock language={language} code={code} />
        </div>
      ) : (
        <div className="bg-card">
          {doc && (
            <iframe
              key={reloadKey}
              ref={frameRef}
              title={`Live preview (${label})`}
              srcDoc={doc}
              // Scripts run, but in an opaque origin: no access to the app, its
              // cookies or storage, no popups and no navigation.
              sandbox="allow-scripts allow-forms"
              referrerPolicy="no-referrer"
              className="block w-full border-0 bg-white"
              style={{ height: frameHeight }}
            />
          )}
          {building && (
            <div className="flex h-40 animate-pulse items-center justify-center gap-2 text-xs text-muted-foreground">
              <AppWindow className="size-4" /> Preparing preview…
            </div>
          )}
          {(errors.length > 0 || failed) && (
            <div role="alert" className="flex flex-col gap-2 border-t border-border bg-destructive/5 px-3 py-2 text-xs">
              <p className="flex items-center gap-1.5 font-medium text-destructive">
                <TriangleAlert className="size-3.5 shrink-0" />
                {errors.length ? "The preview reported a problem" : "The preview didn't finish loading"}
              </p>
              {errors.map((e) => (
                <p key={e} className="font-mono break-words text-muted-foreground">
                  {e}
                </p>
              ))}
              {errors.length > 0 && (
                <Button variant="outline" size="xs" className="self-start" onClick={askToFix}>
                  Ask the agent to fix it
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
