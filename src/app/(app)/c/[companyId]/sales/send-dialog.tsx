"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Paperclip } from "lucide-react";
import type { ActionResult } from "@/lib/action";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormError, FormField } from "@/components/common/form-field";
import { useActionRunner } from "@/components/common/use-action";

export type EmailDraft = { to: string; cc: string; subject: string; body: string };

/** Dokumendi saatmine e-postiga: saaja, koopia, teema ja tekst on muudetavad, PDF on manuses. */
export function SendDocumentDialog({
  title,
  initial,
  attachment,
  pdfHref,
  onClose,
  send,
}: {
  title: string;
  initial: EmailDraft;
  attachment: string;
  pdfHref: string;
  onClose: () => void;
  send: (values: EmailDraft) => Promise<ActionResult<unknown>>;
}) {
  const t = useTranslations("invoices");
  const tc = useTranslations("common");
  const { pending, run } = useActionRunner();
  const [v, setV] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={tc("close")} className="max-w-xl" aria-describedby={undefined}>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            setFieldErrors({});
            run(() => send(v), {
              success: t("emailSentToast"),
              onSuccess: onClose,
              onError: (res, msg) => {
                setFieldErrors(res.fieldErrors ?? {});
                if (res.error !== "validation") setError(msg);
              },
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <FormError message={error} />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t("emailTo")} htmlFor="mail-to" errors={fieldErrors.to}>
                <Input id="mail-to" type="email" value={v.to} onChange={(e) => setV({ ...v, to: e.target.value })} autoFocus={!v.to} />
              </FormField>
              <FormField label={t("emailCc")} htmlFor="mail-cc" errors={fieldErrors.cc}>
                <Input id="mail-cc" value={v.cc} onChange={(e) => setV({ ...v, cc: e.target.value })} />
              </FormField>
            </div>
            <FormField label={t("emailSubject")} htmlFor="mail-subject" errors={fieldErrors.subject}>
              <Input id="mail-subject" value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} />
            </FormField>
            <FormField label={t("emailBody")} htmlFor="mail-body" errors={fieldErrors.body}>
              <Textarea id="mail-body" rows={8} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} />
            </FormField>
            <a href={pdfHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
              <Paperclip className="size-4" /> {attachment}
            </a>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={pending || !v.to.trim()}>
              {t("sendNow")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
