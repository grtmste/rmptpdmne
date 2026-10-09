"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Calculator, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useActionRunner } from "@/components/common/use-action";
import { cancelDepreciationAction, runDepreciationAction } from "@/server/actions/assets";

export function PeriodPicker({ period }: { period: string }) {
  const t = useTranslations("assets");
  const router = useRouter();
  return (
    <div className="space-y-1.5">
      <Label htmlFor="dep-period">{t("month")}</Label>
      <Input id="dep-period" type="month" className="w-44" value={period} onChange={(e) => e.target.value && router.push(`?period=${e.target.value}`)} />
    </div>
  );
}

export function RunButton({ companyId, period, disabled }: { companyId: string; period: string; disabled?: boolean }) {
  const t = useTranslations("assets");
  const router = useRouter();
  const { pending, run } = useActionRunner();
  return (
    <Button
      disabled={disabled || pending}
      onClick={() =>
        run(() => runDepreciationAction(companyId, { period }), {
          refresh: false,
          onSuccess: (d) => {
            toast.success(t("runDone", { count: d.count }));
            // Jääme arvestatud kuule, et tulemus oleks näha
            router.push(`?period=${period}&run=${d.id}`);
          },
        })
      }
    >
      <Calculator /> {t("runDepreciation")}
    </Button>
  );
}

export function CancelRunButton({ companyId, id }: { companyId: string; id: string }) {
  const t = useTranslations("assets");
  const { pending, run } = useActionRunner();
  return (
    <Button size="sm" variant="ghost" className="text-destructive" disabled={pending} onClick={() => confirm(t("cancelRunConfirm")) && run(() => cancelDepreciationAction(companyId, { id }), { success: t("runCancelled") })}>
      <Undo2 /> {t("cancelRun")}
    </Button>
  );
}
