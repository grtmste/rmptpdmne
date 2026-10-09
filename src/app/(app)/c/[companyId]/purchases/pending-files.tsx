"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Camera, FileText, ImageIcon, Paperclip, Trash2, UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ATTACHMENT_ACCEPT } from "@/components/common/attachments-panel";
import { DocumentViewer } from "@/components/common/document-viewer";

const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Uue ostuarve failid enne salvestamist: lohistamine, failivalik või kaamera, eelvaade kohe
 * kõrval. Failid laaditakse üles koos arve salvestamisega.
 */
export function PendingFiles({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const t = useTranslations("attachments");
  const tp = useTranslations("purchases");
  const [over, setOver] = useState(false);
  const [selected, setSelected] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  const current = Math.min(selected, files.length - 1);

  function add(list: FileList | null) {
    const next = Array.from(list ?? []).filter((f) => {
      if (f.size > MAX_BYTES) toast.error(t("tooLarge", { name: f.name }));
      return f.size <= MAX_BYTES;
    });
    if (next.length) {
      onChange([...files, ...next].slice(0, 10));
      if (files.length === 0) setSelected(0);
    }
    if (fileRef.current) fileRef.current.value = "";
    if (cameraRef.current) cameraRef.current.value = "";
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Paperclip className="size-4 text-muted-foreground" /> {t("title")}
          {files.length > 0 && <span className="text-muted-foreground">({files.length})</span>}
        </h3>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            add(e.dataTransfer.files);
          }}
          className={cn(
            "flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 text-center transition-colors",
            files.length ? "py-3" : "py-10",
            over ? "border-primary bg-accent/50" : "border-border",
          )}
        >
          {files.length === 0 && <UploadCloud className="size-7 text-primary" aria-hidden />}
          <p className="text-sm text-muted-foreground">{tp("dropInvoice")}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <input ref={fileRef} type="file" className="sr-only" accept={ATTACHMENT_ACCEPT} multiple onChange={(e) => add(e.target.files)} aria-label={t("add")} />
            <input ref={cameraRef} type="file" className="sr-only" accept="image/*" capture="environment" onChange={(e) => add(e.target.files)} aria-label={tp("takePhoto")} />
            <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              <UploadCloud /> {t("add")}
            </Button>
            <Button type="button" size="sm" variant="ghost" className="md:hidden" onClick={() => cameraRef.current?.click()}>
              <Camera /> {tp("takePhoto")}
            </Button>
          </div>
        </div>
        {files.length > 0 && (
          <>
            <ul className="divide-y rounded-lg border text-sm">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className={cn("flex items-center gap-2 px-3 py-1.5", i === current && "bg-accent/40")}>
                  {f.type.startsWith("image/") ? <ImageIcon className="size-4 text-muted-foreground" /> : <FileText className="size-4 text-muted-foreground" />}
                  <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => setSelected(i)}>
                    {f.name}
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("delete", { name: f.name })}
                    onClick={() => onChange(files.filter((_, j) => j !== i))}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
            <DocumentViewer key={urls[current]} src={urls[current]!} contentType={files[current]!.type || "application/octet-stream"} fileName={files[current]!.name} local />
            <p className="text-xs text-muted-foreground">{tp("pendingHint")}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
