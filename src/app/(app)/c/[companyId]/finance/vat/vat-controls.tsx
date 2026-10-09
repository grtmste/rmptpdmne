"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Download, Lock, Printer, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useActionRunner } from "@/components/common/use-action";
import { closeVatAction, reopenVatAction } from "@/server/actions/vat";

export function VatControls({
  companyId,
  initial,
  closed,
  canEdit,
}: {
  companyId: string;
  initial: { period: string; plus: string; minus: string };
  closed: boolean;
  canEdit: boolean;
}) {
  const t = useTranslations("vatReturn");
  const tr = useTranslations("reports");
  const router = useRouter();
  const pathname = usePathname();
  const { pending, run } = useActionRunner();
  const [v, setV] = useState(initial);
  const [year, month] = initial.period.split("-").map(Number) as [number, number];

  const qs = (x = v) => {
    const sp = new URLSearchParams({ period: x.period });
    if (x.plus) sp.set("plus", x.plus);
    if (x.minus) sp.set("minus", x.minus);
    return sp.toString();
  };

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4 print:hidden"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(`${pathname}?${qs()}`);
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="vat-period">{t("period")}</Label>
        <Input id="vat-period" type="month" value={v.period} onChange={(e) => setV({ ...v, period: e.target.value })} className="w-44" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="vat-plus">{t("adjustmentsPlus")}</Label>
        <Input id="vat-plus" inputMode="decimal" value={v.plus} onChange={(e) => setV({ ...v, plus: e.target.value })} className="w-32 text-right" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="vat-minus">{t("adjustmentsMinus")}</Label>
        <Input id="vat-minus" inputMode="decimal" value={v.minus} onChange={(e) => setV({ ...v, minus: e.target.value })} className="w-32 text-right" />
      </div>
      <Button type="submit">{tr("show")}</Button>
      <div className="ml-auto flex flex-wrap gap-2">
        <Button type="button" variant="outline" asChild>
          <a href={`/c/${companyId}/finance/vat/xml?${qs(initial)}`} download>
            <Download /> {t("downloadXml")}
          </a>
        </Button>
        <Button type="button" variant="ghost" onClick={() => window.print()}>
          <Printer /> {tr("print")}
        </Button>
        {canEdit &&
          (closed ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => confirm(t("reopenConfirm")) && run(() => reopenVatAction(companyId, { year, month }), { success: t("reopened") })}
            >
              <Unlock /> {t("reopen")}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={pending}
              onClick={() => confirm(t("closeConfirm")) && run(() => closeVatAction(companyId, { year, month }), { success: t("closed") })}
            >
              <Lock /> {t("close")}
            </Button>
          ))}
      </div>
    </form>
  );
}
