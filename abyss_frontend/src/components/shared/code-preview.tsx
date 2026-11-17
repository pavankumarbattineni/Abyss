"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AppWindow, CodeXml, Download, Maximize2, Minimize2, Play, RotateCw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui";
import {
  buildHtmlPreview,
  buildReactPreview,
  compileReactComponent,
  downloadableHtml,
  PREVIEW_SIZES,
  previewFrameLayout,
  type PreviewKind,
} from "@/lib/code-preview";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./code-block";
import { CopyButton } from "./copy-button";
import { FULLSCREEN_CLASS, useFullscreen } from "./use-fullscreen";

/** Asks the chat composer to prefill a message (handled in chat-panel.tsx). */
export const COMPOSE_EVENT = "abyss:compose";

const MIN_HEIGHT = PREVIEW_SIZES.minHeight;
const READY_TIMEOUT_MS = 10_000;
/** After an extra frame load, how long our page has to report "ready" before it counts as having left. */
const NAVIGATION_CHECK_MS = 2_500;
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
  /** The page fills whatever height it's given (100vh / h-screen layouts). */
  fill: boolean;
  /** Width of content wider than the frame (fixed pixel widths); 0 when it fits. */
  contentWidth: number;
  /** Sites the page tried to load files from, which the preview blocks. */
  blocked: string[];
  errors: string[];
}

const noSubscribe = () => () => {};
const clientRuntimeBase = () => `${window.location.origin}/preview-runtime`;
const serverRuntimeBase = () => "";

const freshFrame = (key: string): FrameState => ({ key, ready: false, timedOut: false, height: MIN_HEIGHT, fill: false, contentWidth: 0, blocked: [], errors: [] });

/**
 * A live preview of frontend code an agent wrote, run in a sandboxed iframe
 * (see lib/code-preview.ts for the isolation rules). Preview shows only the
 * running page, Code only its source -- the same pattern as InteractiveBlock.
 */
export function CodePreview({ kind, language, code }: CodePreviewProps) {
  const [mode, setMode] = useState<"preview" | "code">("preview");
  // Full screen: the card itself becomes a fixed full-viewport layer. The
  // iframe is never moved or re-created, so the running page keeps its state.
  const [fullscreen, setFullscreen] = useFullscreen();
  const [reloadKey, setReloadKey] = useState<number>(0);
  const frameRef = useRef<HTMLIFrameElement>(null);
  // Safety net for navigation the frame can't stop by itself (lib/code-preview.ts
  // turns "#..." links and location changes into in-page hash changes). Every
  // load of our own page reports "ready" on this run's channel, which another
  // document can't do. So a further load is fine when it is our page again
  // (location.reload()), but if no "ready" follows, the frame left the page:
  // reload the preview and say why.
  const loads = useRef<{ key: number; count: number }>({ key: -1, count: 0 });
  const readies = useRef<{ channel: string; count: number }>({ channel: "", count: 0 });
  const leaveCheck = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(leaveCheck.current), []);
  const [navigatedAway, setNavigatedAway] = useState(false);
  // The width available to the preview, to fit wide or full-screen pages into it.
  // A callback ref: the stage only exists once the page is built (React previews compile first).
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [columnWidth, setColumnWidth] = useState(0);
  const [stageHeight, setStageHeight] = useState(0);
  useEffect(() => {
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => {
      setColumnWidth(Math.round(entry.contentRect.width));
      setStageHeight(Math.round(entry.contentRect.height));
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stage]);

  // One channel per run (code + reload): messages from other frames or older
  // runs are ignored, and all run state below is keyed by it.
  const channel = useMemo(() => `preview-${crypto.randomUUID()}`, [code, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // "" during server render and hydration, the real origin right after: no hydration mismatch.
  const runtimeBase = useSyncExternalStore(noSubscribe, clientRuntimeBase, serverRuntimeBase);

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
        updateFrame(() => ({ height, fill: false }));
      } else if (data.type === "fill") {
        updateFrame(() => ({ fill: true }));
      } else if (data.type === "width" && typeof data.data === "number" && Number.isFinite(data.data)) {
        // Keep the widest seen: once the frame is widened to fit, it no longer overflows.
        const contentWidth = Math.round(data.data);
        updateFrame((c) => ({ contentWidth: Math.max(c.contentWidth, contentWidth) }));
      } else if (data.type === "blocked") {
        const host = String((data.data as { host?: unknown } | null)?.host ?? "").slice(0, 120);
        if (host) updateFrame((c) => ({ blocked: c.blocked.includes(host) || c.blocked.length >= 8 ? c.blocked : [...c.blocked, host] }));
      } else if (data.type === "ready") {
        const seen = readies.current.channel === channel ? readies.current.count + 1 : 1;
        readies.current = { channel, count: seen };
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
  // Blocked files usually explain a page that looks unstyled or does nothing:
  // say so plainly, as one problem the agent can fix.
  const blockedProblem = frame.blocked.length
    ? `The page tries to load files from the internet (${frame.blocked.join(", ")}), which the preview blocks for security. Rebuild it as one self-contained file: no external scripts, stylesheets, fonts, icon libraries or images.`
    : null;
  const errors = [
    ...(reactResult?.error ? [reactResult.error] : []),
    ...(blockedProblem ? [blockedProblem] : []),
    ...(navigatedAway
      ? [
          "The page tried to leave the preview (for example location.href set to a full web address), so the preview was reloaded. Switch pages in place instead: hash links like #/menu, location.hash, or updating the page with JavaScript.",
        ]
      : []),
    ...frame.errors,
  ];
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
  const layout = previewFrameLayout({
    columnWidth,
    height,
    fill: frame.fill,
    contentWidth: frame.contentWidth,
    fullscreenHeight: fullscreen ? stageHeight : undefined,
  });

  return (
    <div
      role={fullscreen ? "dialog" : undefined}
      aria-modal={fullscreen || undefined}
      aria-label={fullscreen ? `Live preview (${label}), full screen` : undefined}
      className={cn(
        "overflow-hidden font-sans text-sm leading-normal",
        fullscreen
          ? FULLSCREEN_CLASS
          : "mb-3 rounded-lg border border-border last:mb-0",
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-muted px-3 py-1">
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
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={fullscreen ? "Exit full screen" : "Open full screen"}
                title={fullscreen ? "Exit full screen (Esc)" : "Open full screen"}
                onClick={() => setFullscreen((v) => !v)}
                className="text-muted-foreground hover:text-foreground"
              >
                {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
              </Button>
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
        <div className={cn("bg-card p-3", fullscreen && "min-h-0 flex-1 overflow-auto")}>
          <CodeBlock language={language} code={code} />
        </div>
      ) : (
        <div className={cn("bg-card", fullscreen && "flex min-h-0 flex-1 flex-col")}>
          {doc && (
            // A wide or full-screen page is laid out at its own (desktop) size
            // and scaled down to the column, so it shows whole, never clipped.
            <div
              ref={setStage}
              className={cn("overflow-hidden bg-white", fullscreen && "min-h-0 flex-1")}
              style={fullscreen ? undefined : { height: layout.displayHeight }}
            >
              <iframe
                key={reloadKey}
                ref={frameRef}
                title={`Live preview (${label})`}
                srcDoc={doc}
                // Scripts run, but in an opaque origin: no access to the app, its
                // cookies or storage, no popups and no navigation.
                sandbox="allow-scripts allow-forms"
                referrerPolicy="no-referrer"
                onLoad={() => {
                  const seen = loads.current.key === reloadKey ? loads.current.count + 1 : 1;
                  loads.current = { key: reloadKey, count: seen };
                  if (seen < 2) return;
                  const run = channel;
                  window.clearTimeout(leaveCheck.current);
                  leaveCheck.current = window.setTimeout(() => {
                    const ours = readies.current.channel === run ? readies.current.count : 0;
                    if (ours >= seen) return; // our page loaded again (e.g. location.reload())
                    setNavigatedAway(true);
                    setReloadKey((k) => k + 1);
                  }, NAVIGATION_CHECK_MS);
                }}
                className="block border-0 bg-white"
                style={{
                  width: layout.frameWidth ?? "100%",
                  height: layout.frameHeight,
                  transform: layout.scale !== 1 ? `scale(${layout.scale})` : undefined,
                  transformOrigin: "0 0",
                }}
              />
            </div>
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
