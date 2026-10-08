"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Camera, UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ATTACHMENT_ACCEPT } from "@/components/common/attachments-panel";
import { useActionRunner } from "@/components/common/use-action";
import { uploadPurchaseFiles } from "@/server/actions/purchases";

const MAX_BYTES = 4 * 1024 * 1024;

/** Ostuarvete üleslaadimine: lohista failid, vali arvutist või pildista telefoniga. */
export function UploadZone({ companyId }: { companyId: string }) {
  const t = useTranslations("purchases");
  const { pending, run } = useActionRunner();
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  function send(list: FileList | null) {
    const files = Array.from(list ?? []).filter((f) => {
      if (f.size > MAX_BYTES) toast.error(t("fileTooLarge", { name: f.name }));
      return f.size <= MAX_BYTES;
    });
    if (files.length === 0) return;
    run(() => uploadPurchaseFiles(companyId, { files: files.slice(0, 10) }), {
      success: t("filesUploaded", { count: Math.min(files.length, 10) }),
    });
    if (fileRef.current) fileRef.current.value = "";
    if (cameraRef.current) cameraRef.current.value = "";
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        send(e.dataTransfer.files);
      }}
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors",
        over ? "border-primary bg-accent/50" : "border-border bg-card",
      )}
    >
      <UploadCloud className="size-8 text-primary" aria-hidden />
      <div>
        <p className="font-medium">{t("dropTitle")}</p>
        <p className="text-sm text-muted-foreground">{t("dropBody")}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <input ref={fileRef} type="file" className="sr-only" accept={ATTACHMENT_ACCEPT} multiple onChange={(e) => send(e.target.files)} aria-label={t("chooseFiles")} />
        <input ref={cameraRef} type="file" className="sr-only" accept="image/*" capture="environment" onChange={(e) => send(e.target.files)} aria-label={t("takePhoto")} />
        <Button type="button" disabled={pending} onClick={() => fileRef.current?.click()}>
          <UploadCloud /> {t("chooseFiles")}
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => cameraRef.current?.click()} className="md:hidden">
          <Camera /> {t("takePhoto")}
        </Button>
      </div>
    </div>
  );
}
