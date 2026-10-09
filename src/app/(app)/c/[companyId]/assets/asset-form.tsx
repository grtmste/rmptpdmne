"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { parseISODate } from "@/lib/accounting/dates";
import { depreciationSchedule } from "@/lib/assets/depreciation";
import { formatDate } from "@/lib/dates";
import { dec, formatMoney, parseMoneyInput } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { FormError, FormField } from "@/components/common/form-field";
import { useActionRunner } from "@/components/common/use-action";
import { saveAssetAction } from "@/server/actions/assets";

export type AssetFormData = {
  groups: Array<{ id: string; name: string; assetAccountId: string; accumulatedAccountId: string; expenseAccountId: string; usefulLifeMonths: number | null }>;
  locations: Array<{ id: string; name: string }>;
  employees: Array<{ id: string; name: string }>;
  departments: Array<{ id: string; code: string; name: string }>;
  accounts: Array<{ id: string; code: string; name: string; type: string }>;
};

export type AssetValues = {
  code: string;
  name: string;
  groupId: string;
  locationId: string;
  responsibleId: string;
  serialNumber: string;
  acquisitionDate: string;
  depreciationStart: string;
  cost: string;
  residualValue: string;
  usefulLifeMonths: string;
  openingDepreciation: string;
  openingMonths: string;
  assetAccountId: string;
  accumulatedAccountId: string;
  expenseAccountId: string;
  departmentId: string;
  purchaseInvoiceId: string;
  notes: string;
};

export function AssetForm({
  companyId,
  assetId,
  initial,
  data,
  locked,
  purchaseInvoiceLabel,
}: {
  companyId: string;
  assetId?: string;
  initial: AssetValues;
  data: AssetFormData;
  /** Kulumi või muutustega vara: rahalisi andmeid muuta ei saa */
  locked?: boolean;
  purchaseInvoiceLabel?: string | null;
}) {
  const t = useTranslations("assets");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const { pending, run } = useActionRunner();
  const [v, setV] = useState<AssetValues>(initial);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [showAccounts, setShowAccounts] = useState(Boolean(initial.openingMonths && initial.openingMonths !== "0"));
  const set = <K extends keyof AssetValues>(k: K, value: AssetValues[K]) => setV((p) => ({ ...p, [k]: value }));

  function changeGroup(groupId: string) {
    const g = data.groups.find((x) => x.id === groupId);
    setV((p) => ({
      ...p,
      groupId,
      assetAccountId: g?.assetAccountId ?? "",
      accumulatedAccountId: g?.accumulatedAccountId ?? "",
      expenseAccountId: g?.expenseAccountId ?? "",
      usefulLifeMonths: p.usefulLifeMonths || (g?.usefulLifeMonths ? String(g.usefulLifeMonths) : ""),
    }));
  }

  const accountSelect = (k: "assetAccountId" | "accumulatedAccountId" | "expenseAccountId", label: string, types: string[]) => (
    <FormField label={label} htmlFor={`a-${k}`} errors={fieldErrors[k]}>
      <NativeSelect id={`a-${k}`} value={v[k]} disabled={locked} onChange={(e) => set(k, e.target.value)}>
        {data.accounts
          .filter((a) => types.includes(a.type) || a.id === v[k])
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} {a.name}
            </option>
          ))}
      </NativeSelect>
    </FormField>
  );

  // Kulumiplaani eelvaade (esimesed kuud)
  const cost = parseMoneyInput(v.cost);
  const life = Number(v.usefulLifeMonths);
  const start = parseISODate(v.depreciationStart);
  const plan =
    cost && cost.greaterThan(0) && life > 0 && start
      ? depreciationSchedule(
          {
            cost,
            residualValue: parseMoneyInput(v.residualValue) ?? 0,
            accumulated: parseMoneyInput(v.openingDepreciation) ?? 0,
            usefulLifeMonths: life,
            monthsDone: Number(v.openingMonths) || 0,
            depreciationStart: start,
          },
          start,
        )
      : [];
  const monthly = plan.find((r) => !r.amount.isZero())?.amount ?? dec(0);

  function submit() {
    setError(null);
    setFieldErrors({});
    run(() => saveAssetAction(companyId, { ...v, id: assetId }), {
      success: tc("saved"),
      refresh: false,
      onSuccess: (d) => router.push(`/c/${companyId}/assets?doc=${d.id}`),
      onError: (res, msg) => {
        setFieldErrors(res.fieldErrors ?? {});
        setError(res.error === "validation" ? t("fixErrors") : msg);
      },
    });
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <FormError message={error} />
      {locked && <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{t("lockedHint")}</p>}
      <Card>
        <CardContent className="grid gap-4 pt-5 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label={t("code")} htmlFor="a-code" errors={fieldErrors.code}>
            <Input id="a-code" value={v.code} onChange={(e) => set("code", e.target.value)} autoFocus={!assetId} />
          </FormField>
          <div className="sm:col-span-1 lg:col-span-3">
            <FormField label={t("name")} htmlFor="a-name" errors={fieldErrors.name}>
              <Input id="a-name" value={v.name} onChange={(e) => set("name", e.target.value)} />
            </FormField>
          </div>
          <FormField label={t("group")} htmlFor="a-group" errors={fieldErrors.groupId}>
            <NativeSelect id="a-group" value={v.groupId} disabled={locked} onChange={(e) => changeGroup(e.target.value)}>
              {data.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label={t("location")} htmlFor="a-location">
            <NativeSelect id="a-location" value={v.locationId} onChange={(e) => set("locationId", e.target.value)}>
              <option value="">—</option>
              {data.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label={t("responsible")} htmlFor="a-responsible">
            <NativeSelect id="a-responsible" value={v.responsibleId} onChange={(e) => set("responsibleId", e.target.value)}>
              <option value="">—</option>
              {data.employees.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label={t("serialNumber")} htmlFor="a-serial">
            <Input id="a-serial" value={v.serialNumber} onChange={(e) => set("serialNumber", e.target.value)} />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("valueAndDepreciation")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label={t("acquisitionDate")} htmlFor="a-acq" errors={fieldErrors.acquisitionDate}>
            <Input
              id="a-acq"
              type="date"
              value={v.acquisitionDate}
              disabled={locked}
              onChange={(e) => {
                const acq = e.target.value;
                // Vaikimisi algab kulum soetamise kuust
                setV((p) => ({ ...p, acquisitionDate: acq, depreciationStart: p.depreciationStart && p.depreciationStart >= acq.slice(0, 8) + "01" ? p.depreciationStart : acq ? `${acq.slice(0, 8)}01` : "" }));
              }}
            />
          </FormField>
          <FormField label={t("depreciationStart")} htmlFor="a-start" hint={t("depreciationStartHint")} errors={fieldErrors.depreciationStart}>
            <Input id="a-start" type="date" value={v.depreciationStart} disabled={locked} onChange={(e) => set("depreciationStart", e.target.value)} />
          </FormField>
          <FormField label={t("cost")} htmlFor="a-cost" errors={fieldErrors.cost}>
            <Input id="a-cost" inputMode="decimal" className="text-right tabular-nums" value={v.cost} disabled={locked} onChange={(e) => set("cost", e.target.value)} />
          </FormField>
          <FormField label={t("residualValue")} htmlFor="a-residual" errors={fieldErrors.residualValue}>
            <Input id="a-residual" inputMode="decimal" className="text-right tabular-nums" value={v.residualValue} disabled={locked} onChange={(e) => set("residualValue", e.target.value)} />
          </FormField>
          <FormField label={t("usefulLife")} htmlFor="a-life" hint={life > 0 ? t("lifeYears", { years: (life / 12).toFixed(life % 12 ? 1 : 0) }) : undefined} errors={fieldErrors.usefulLifeMonths}>
            <Input id="a-life" inputMode="numeric" className="text-right tabular-nums" value={v.usefulLifeMonths} disabled={locked} onChange={(e) => set("usefulLifeMonths", e.target.value)} />
          </FormField>
          <div className="space-y-1.5 sm:col-span-1 lg:col-span-3">
            <div className="text-sm font-medium">{t("monthlyDepreciation")}</div>
            <div className="flex h-9 items-center text-lg font-semibold tabular-nums">
              {plan.length ? formatMoney(monthly, locale) : "—"}
              {plan.length > 0 && (
                <span className="ml-3 text-xs font-normal text-muted-foreground">
                  {t("planUntil", { date: formatDate(plan.at(-1)!.period, locale), months: plan.length })}
                </span>
              )}
            </div>
          </div>
          {purchaseInvoiceLabel && (
            <p className="text-sm text-muted-foreground sm:col-span-2 lg:col-span-4">{t("fromPurchase", { invoice: purchaseInvoiceLabel })}</p>
          )}
          <div className="sm:col-span-2 lg:col-span-4">
            <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={() => setShowAccounts((s) => !s)}>
              {showAccounts ? t("hideAccounts") : t("showAccounts")}
            </Button>
          </div>
          {showAccounts && (
            <>
              {accountSelect("assetAccountId", t("assetAccount"), ["ASSET"])}
              {accountSelect("accumulatedAccountId", t("accumulatedAccount"), ["ASSET"])}
              {accountSelect("expenseAccountId", t("expenseAccount"), ["EXPENSE"])}
              <FormField label={t("department")} htmlFor="a-dept">
                <NativeSelect id="a-dept" value={v.departmentId} onChange={(e) => set("departmentId", e.target.value)}>
                  <option value="">—</option>
                  {data.departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.code} {d.name}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField label={t("openingDepreciation")} htmlFor="a-opening" hint={t("openingHint")} errors={fieldErrors.openingDepreciation}>
                <Input id="a-opening" inputMode="decimal" className="text-right tabular-nums" value={v.openingDepreciation} disabled={locked} onChange={(e) => set("openingDepreciation", e.target.value)} />
              </FormField>
              <FormField label={t("openingMonths")} htmlFor="a-opening-months" errors={fieldErrors.openingMonths}>
                <Input id="a-opening-months" inputMode="numeric" className="text-right tabular-nums" value={v.openingMonths} disabled={locked} onChange={(e) => set("openingMonths", e.target.value)} />
              </FormField>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          <FormField label={t("notes")} htmlFor="a-notes">
            <Textarea id="a-notes" rows={2} value={v.notes} onChange={(e) => set("notes", e.target.value)} />
          </FormField>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          {tc("cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {tc("save")}
        </Button>
      </div>
    </form>
  );
}
