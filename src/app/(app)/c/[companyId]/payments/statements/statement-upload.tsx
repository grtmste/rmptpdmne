"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { FormField } from "@/components/common/form-field";
import { useActionRunner } from "@/components/common/use-action";
import { importStatementAction } from "@/server/actions/payments";

/** Väljavõtte üleslaadimine: camt.053 (XML) või panga CSV. */
export function StatementUpload({ companyId, banks, defaultBank }: { companyId: string; banks: Array<{ id: string; name: string }>; defaultBank: string }) {
  const t = useTranslations("statements");
  const router = useRouter();
  const { pending, run } = useActionRunner();
  const [bankId, setBankId] = useState(defaultBank);
  const fileRef = useRef<HTMLInputElement>(null);
  if (banks.length === 0) return <p className="text-sm text-muted-foreground">{t("noBanks")}</p>;
  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-3 pt-5">
        <FormField label={t("bankAccount")} htmlFor="st-bank" className="min-w-56 flex-1">
          <NativeSelect id="st-bank" value={bankId} onChange={(e) => setBankId(e.target.value)}>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <input
          ref={fileRef}
          type="file"
          className="sr-only"
          accept=".xml,.csv,.txt,application/xml,text/xml,text/csv"
          aria-label={t("chooseFile")}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            run(() => importStatementAction(companyId, { bankAccountId: bankId, file }), {
              refresh: false,
              onSuccess: (d) => {
                toast.success(t("imported", { imported: d.imported, skipped: d.skipped }));
                router.push(`/c/${companyId}/payments/statements/${d.id}`);
              },
            });
            e.target.value = "";
          }}
        />
        <Button type="button" disabled={pending || !bankId} onClick={() => fileRef.current?.click()}>
          <Upload /> {t("chooseFile")}
        </Button>
        <p className="w-full text-xs text-muted-foreground">{t("formats")}</p>
      </CardContent>
    </Card>
  );
}
