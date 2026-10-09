"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Pencil, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useActionRunner } from "@/components/common/use-action";
import { deleteRecurring, runRecurringNow } from "@/server/actions/recurring";

export function RecurringActions({ companyId, id, name, canRun, canEdit }: { companyId: string; id: string; name: string; canRun: boolean; canEdit: boolean }) {
  const t = useTranslations("recurring");
  const router = useRouter();
  const { pending, run } = useActionRunner();
  return (
    <div className="flex flex-wrap gap-2">
      {canEdit && (
        <Button size="sm" variant="outline" asChild>
          <Link href={`/c/${companyId}/sales/recurring/${id}/edit`}>
            <Pencil /> {t("edit")}
          </Link>
        </Button>
      )}
      {canRun && (
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            confirm(t("runConfirm")) &&
            run(() => runRecurringNow(companyId, { id }), {
              success: t("ran"),
              onSuccess: (d) => {
                if (d.sent && d.sent !== "sent") alert(t(`sendResult.${d.sent}`));
                router.push(`/c/${companyId}/sales/invoices?doc=${d.invoiceId}`);
              },
            })
          }
        >
          <Play /> {t("runNow")}
        </Button>
      )}
      {canEdit && (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            confirm(t("deleteConfirm", { name })) &&
            run(() => deleteRecurring(companyId, { id }), { success: t("deleted"), onSuccess: () => router.push(`/c/${companyId}/sales/recurring`) })
          }
        >
          <Trash2 /> {t("delete")}
        </Button>
      )}
    </div>
  );
}
