"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, ExternalLink, Maximize, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Dokumendi (PDF või pilt) eelvaade suumimise ja liigutamisega:
 *   hiireratas – suumib kursori kohalt, lohistamine – liigutab, topeltklõps – suum sisse/välja,
 *   klahvid + / − / 0. PDF-i lehed joonistatakse pdf.js-iga; pärast suumimist joonistatakse
 *   lehed uuesti suurema eraldusvõimega, et tekst jääks teravaks.
 */

const MIN = 0.4;
const MAX = 8;
const clamp = (v: number) => Math.min(MAX, Math.max(MIN, v));

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage>; destroy: () => Promise<void> };
type PdfPage = {
  getViewport: (o: { scale: number; rotation?: number }) => { width: number; height: number };
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
};

export function DocumentViewer({
  src,
  contentType,
  fileName,
  className,
  local,
}: {
  src: string;
  contentType: string;
  fileName: string;
  className?: string;
  /** Kohalik fail (blob:), avamise ja allalaadimise nuppe ei näidata */
  local?: boolean;
}) {
  const t = useTranslations("viewer");
  const frameRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [failed, setFailed] = useState(false);
  const [renderScale, setRenderScale] = useState(1);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const isPdf = contentType === "application/pdf";
  const isImage = contentType.startsWith("image/");

  // Suumi punkti (frame'i koordinaatides) ümber
  const zoomAt = useCallback((factor: number, px?: number, py?: number) => {
    setView((v) => {
      const frame = frameRef.current;
      const cx = px ?? (frame ? frame.clientWidth / 2 : 0);
      const cy = py ?? (frame ? frame.clientHeight / 2 : 0);
      const scale = clamp(v.scale * factor);
      const k = scale / v.scale;
      return { scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  }, []);
  const reset = useCallback(() => setView({ scale: 1, x: 0, y: 0 }), []);

  // Hiireratas: passive: false, et leht ise ei keriks
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = frame.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
    };
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // Pärast suumimise lõppu suurem eraldusvõime (kuni 4×)
  useEffect(() => {
    const id = setTimeout(() => setRenderScale(Math.min(4, Math.max(1, Math.ceil(view.scale)))), 250);
    return () => clearTimeout(id);
  }, [view.scale]);

  // PDF-i lehtede joonistamine
  useEffect(() => {
    if (!isPdf) return;
    let cancelled = false;
    let doc: PdfDoc | null = null;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        doc = (await pdfjs.getDocument({ url: src, withCredentials: true }).promise) as unknown as PdfDoc;
        if (cancelled) return;
        setPageCount(doc.numPages);
        const host = pagesRef.current;
        const width = frameRef.current?.clientWidth ?? 600;
        if (!host) return;
        const canvases: HTMLCanvasElement[] = [];
        for (let n = 1; n <= Math.min(doc.numPages, 30); n++) {
          const page = await doc.getPage(n);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1, rotation });
          const cssScale = (width - 16) / base.width;
          const ratio = (window.devicePixelRatio || 1) * renderScale;
          const viewport = page.getViewport({ scale: cssScale * ratio, rotation });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
          canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
          canvas.className = "mx-auto mb-2 block bg-white shadow-sm";
          await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
          canvases.push(canvas);
        }
        if (!cancelled) host.replaceChildren(...canvases);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      void doc?.destroy();
    };
  }, [isPdf, src, rotation, renderScale]);

  return (
    <div className={cn("flex flex-col overflow-hidden rounded-lg border bg-muted/40", className)}>
      <div className="flex items-center gap-1 border-b bg-card px-2 py-1">
        <Button type="button" size="icon-sm" variant="ghost" aria-label={t("zoomOut")} title={t("zoomOut")} onClick={() => zoomAt(1 / 1.25)}>
          <ZoomOut />
        </Button>
        <span className="w-12 text-center text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {Math.round(view.scale * 100)}%
        </span>
        <Button type="button" size="icon-sm" variant="ghost" aria-label={t("zoomIn")} title={t("zoomIn")} onClick={() => zoomAt(1.25)}>
          <ZoomIn />
        </Button>
        <Button type="button" size="icon-sm" variant="ghost" aria-label={t("fit")} title={t("fit")} onClick={reset}>
          <Maximize />
        </Button>
        <Button type="button" size="icon-sm" variant="ghost" aria-label={t("rotate")} title={t("rotate")} onClick={() => setRotation((r) => (r + 90) % 360)}>
          <RotateCw />
        </Button>
        <span className="ml-2 min-w-0 flex-1 truncate text-xs text-muted-foreground" title={fileName}>
          {fileName}
          {pageCount > 1 ? ` · ${t("pages", { count: pageCount })}` : ""}
        </span>
        {!local && (
          <>
            <Button type="button" size="icon-sm" variant="ghost" asChild>
              <a href={src} target="_blank" rel="noreferrer" aria-label={t("open")} title={t("open")}>
                <ExternalLink />
              </a>
            </Button>
            <Button type="button" size="icon-sm" variant="ghost" asChild>
              <a href={`${src}?download=1`} aria-label={t("download")} title={t("download")}>
                <Download />
              </a>
            </Button>
          </>
        )}
      </div>
      <div
        ref={frameRef}
        tabIndex={0}
        role="img"
        aria-label={t("label", { name: fileName })}
        className="relative h-[72vh] cursor-grab touch-none overflow-hidden outline-none select-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onDoubleClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          if (view.scale > 1.2) reset();
          else zoomAt(2.5 / view.scale, e.clientX - rect.left, e.clientY - rect.top);
        }}
        onKeyDown={(e) => {
          if (e.key === "+" || e.key === "=") zoomAt(1.25);
          else if (e.key === "-") zoomAt(1 / 1.25);
          else if (e.key === "0") reset();
          else return;
          e.preventDefault();
        }}
      >
        <div className="absolute top-0 left-0 w-full origin-top-left p-2" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
          {isPdf && !failed && <div ref={pagesRef} />}
          {isImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={fileName}
              draggable={false}
              className="mx-auto block max-w-full bg-white shadow-sm"
              style={{ transform: `rotate(${rotation}deg)` }}
            />
          )}
          {(failed || (!isPdf && !isImage)) && <p className="p-4 text-sm text-muted-foreground">{t("noPreview")}</p>}
        </div>
        {isPdf && pageCount === 0 && !failed && <p className="absolute inset-x-0 top-1/3 text-center text-sm text-muted-foreground">{t("loading")}</p>}
        <p className="pointer-events-none absolute right-2 bottom-2 rounded bg-card/80 px-2 py-0.5 text-[11px] text-muted-foreground">{t("hint")}</p>
      </div>
    </div>
  );
}
