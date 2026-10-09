"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { useActionRunner } from "@/components/common/use-action";
import { recalculateStock, setCostMethod } from "@/server/actions/inventory";

/** Omahinna meetod ja ümberarvestus (meetodi muutmine arvutab avatud perioodi liikumised ümber). */
export function CostSettings({ companyId, method, canConfirm }: { companyId: string; method: "FIFO" | "AVERAGE"; canConfirm: boolean }) {
  const t = useTranslations("inventory");
  const { pending, run } = useActionRunner();
  const [value, setValue] = useState(method);
  const done = (d: { changed: number }) => toast.success(t("recalculated", { count: d.changed }));
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="cost-method">{t("costMethod")}</Label>
        <NativeSelect id="cost-method" value={value} disabled={!canConfirm || pending} onChange={(e) => setValue(e.target.value as "FIFO" | "AVERAGE")} className="w-64">
          <option value="FIFO">{t("costMethods.FIFO")}</option>
          <option value="AVERAGE">{t("costMethods.AVERAGE")}</option>
        </NativeSelect>
      </div>
      {canConfirm && value !== method && (
        <Button disabled={pending} onClick={() => confirm(t("costMethodConfirm")) && run(() => setCostMethod(companyId, { method: value }), { onSuccess: done })}>
          {t("saveCostMethod")}
        </Button>
      )}
      {canConfirm && (
        <Button variant="outline" disabled={pending} onClick={() => run(() => recalculateStock(companyId, {}), { onSuccess: done })}>
          <RefreshCw /> {t("recalculate")}
        </Button>
      )}
    </div>
  );
}
