"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Download, FileText, ImageIcon, Paperclip, Trash2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { deleteAttachment, uploadAttachment } from "@/server/actions/purchases";
import { useActionRunner } from "./use-action";

export type AttachmentInfo = { id: string; fileName: string; contentType: string; size: number };

export const ATTACHMENT_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif,application/xml,text/xml";
const MAX_BYTES = 4 * 1024 * 1024;

const sizeText = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} kB`);

/**
 * Dokumendi manused: nimekiri, esimese faili eelvaade (PDF või pilt), üleslaadimine
 * (mobiilis ka kaamerast) ja kustutamine.
 */
export function AttachmentsPanel({
  companyId,
  documentType,
  documentId,
  attachments,
  canEdit,
  locked,
  preview = true,
  className,
}: {
  companyId: string;
  documentType: "PurchaseInvoice" | "ExpenseReport" | "PurchaseOrder" | "SalesInvoice";
  documentId: string;
  attachments: AttachmentInfo[];
  canEdit: boolean;
  /** Kinnitatud dokumendil manuseid ei kustutata */
  locked?: boolean;
  preview?: boolean;
  className?: string;
}) {
  const t = useTranslations("attachments");
  const { pending, run } = useActionRunner();
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState(attachments[0]?.id ?? null);
  const current = attachments.find((a) => a.id === selected) ?? attachments[0];
  const href = (id: string) => `/c/${companyId}/attachments/${id}`;

  function upload(files: FileList | null) {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      if (file.size > MAX_BYTES) {
        toast.error(t("tooLarge", { name: file.name }));
        continue;
      }
      run(() => uploadAttachment(companyId, { documentType, documentId, file }), { success: t("uploaded") });
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Paperclip className="size-4 text-muted-foreground" /> {t("title")}
          {attachments.length > 0 && <span className="text-muted-foreground">({attachments.length})</span>}
        </h3>
        {canEdit && (
          <>
            <input ref={inputRef} type="file" className="sr-only" accept={ATTACHMENT_ACCEPT} multiple onChange={(e) => upload(e.target.files)} aria-label={t("add")} />
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => inputRef.current?.click()}>
              <Upload /> {t("add")}
            </Button>
          </>
        )}
      </div>
      {attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {attachments.map((a) => (
            <li key={a.id} className={cn("flex items-center gap-2 px-3 py-1.5", current?.id === a.id && preview && "bg-accent/40")}>
              {a.contentType.startsWith("image/") ? <ImageIcon className="size-4 shrink-0 text-muted-foreground" /> : <FileText className="size-4 shrink-0 text-muted-foreground" />}
              <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => setSelected(a.id)}>
                {a.fileName}
              </button>
              <span className="shrink-0 text-xs text-muted-foreground">{sizeText(a.size)}</span>
              <Button variant="ghost" size="icon-sm" asChild>
                <a href={`${href(a.id)}?download=1`} aria-label={t("download", { name: a.fileName })}>
                  <Download />
                </a>
              </Button>
              {canEdit && !locked && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("delete", { name: a.fileName })}
                  disabled={pending}
                  onClick={() => confirm(t("deleteConfirm", { name: a.fileName })) && run(() => deleteAttachment(companyId, { id: a.id }), { success: t("deleted") })}
                >
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {preview && current && (
        <div className="overflow-hidden rounded-lg border bg-muted/30">
          {current.contentType === "application/pdf" ? (
            <iframe title={current.fileName} src={href(current.id)} className="h-[70vh] w-full" />
          ) : current.contentType.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={href(current.id)} alt={current.fileName} className="max-h-[70vh] w-full object-contain" />
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("noPreview")}</p>
          )}
        </div>
      )}
    </div>
  );
}
