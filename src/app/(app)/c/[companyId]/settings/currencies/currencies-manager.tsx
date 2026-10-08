"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Download, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { CURRENCIES } from "@/lib/currencies";
import { formatDate } from "@/lib/dates";
import { parseISODate } from "@/lib/accounting/dates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FormField } from "@/components/common/form-field";
import { useActionRunner } from "@/components/common/use-action";
import { addCurrency, fetchEcbRates, removeCurrency, saveExchangeRate } from "@/server/actions/settings/currencies";

export type CurrencyRow = { code: string; rate: string | null; date: string | null; source: string | null };
type Code = (typeof CURRENCIES)[number];

export function CurrenciesManager({
  companyId,
  currencies,
  newestEcb,
  canEdit,
}: {
  companyId: string;
  currencies: CurrencyRow[];
  newestEcb: string | null;
  canEdit: boolean;
}) {
  const t = useTranslations("currencies");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { pending, run } = useActionRunner();
  const names = useMemo(() => new Intl.DisplayNames([locale], { type: "currency" }), [locale]);
  const available = CURRENCIES.filter((c) => c !== "EUR" && !currencies.some((s) => s.code === c));
  const [toAdd, setToAdd] = useState<string>("");
  const [manual, setManual] = useState({ currency: "", date: "", rate: "" });
  const fmt = (iso: string) => formatDate(parseISODate(iso)!, locale);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="space-y-1">
            <CardTitle>{t("selectedTitle")}</CardTitle>
            <CardDescription>{t("selectedBody")}</CardDescription>
          </div>
          {canEdit && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() => fetchEcbRates(companyId, {}), {
                  onSuccess: (d) => toast.success(t("fetched", { count: d.inserted })),
                })
              }
            >
              <Download /> {t("fetchEcb")}
            </Button>
          )}
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <THead>
              <tr>
                <TH className="pl-5">{t("currency")}</TH>
                <TH className="text-right">{t("rate")}</TH>
                <TH>{t("date")}</TH>
                <TH className="w-16" />
              </tr>
            </THead>
            <TBody>
              <TR>
                <TD className="pl-5 font-medium">
                  EUR <span className="font-normal text-muted-foreground">· {names.of("EUR")}</span>
                </TD>
                <TD className="num">1.000000</TD>
                <TD>
                  <Badge variant="secondary">{t("base")}</Badge>
                </TD>
                <TD />
              </TR>
              {currencies.map((c) => (
                <TR key={c.code}>
                  <TD className="pl-5 font-medium">
                    {c.code} <span className="font-normal text-muted-foreground">· {names.of(c.code)}</span>
                  </TD>
                  <TD className="num">{c.rate ?? "—"}</TD>
                  <TD className="text-muted-foreground">
                    {c.date ? `${fmt(c.date)} · ${c.source === "ECB" ? t("ecb") : t("manual")}` : t("noRate")}
                  </TD>
                  <TD className="text-right">
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("remove", { code: c.code })}
                        disabled={pending}
                        onClick={() => run(() => removeCurrency(companyId, { code: c.code as Code }))}
                      >
                        <X />
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {canEdit && (
            <form
              className="flex flex-wrap items-end gap-2 border-t px-5 py-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (toAdd) run(() => addCurrency(companyId, { code: toAdd as Code }), { onSuccess: () => setToAdd("") });
              }}
            >
              <FormField label={t("add")} htmlFor="add-currency" className="w-72">
                <NativeSelect id="add-currency" value={toAdd} onChange={(e) => setToAdd(e.target.value)}>
                  <option value="">—</option>
                  {available.map((c) => (
                    <option key={c} value={c}>
                      {c} · {names.of(c)}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <Button type="submit" disabled={pending || !toAdd}>
                <Plus /> {t("addButton")}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        {newestEcb ? t("ecbLatest", { date: fmt(newestEcb) }) : t("ecbNone")} {t("ecbExplain")}
      </p>

      {canEdit && currencies.length > 0 && (
        <Card>
          <CardHeader>
            <div className="space-y-1">
              <CardTitle>{t("manualTitle")}</CardTitle>
              <CardDescription>{t("manualBody")}</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => saveExchangeRate(companyId, { ...manual, currency: manual.currency as Code }), {
                  success: tc("saved"),
                  onSuccess: () => setManual({ currency: "", date: "", rate: "" }),
                });
              }}
            >
              <FormField label={t("currency")} htmlFor="m-currency" className="w-32">
                <NativeSelect id="m-currency" value={manual.currency} onChange={(e) => setManual({ ...manual, currency: e.target.value })}>
                  <option value="">—</option>
                  {currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField label={t("date")} htmlFor="m-date" className="w-44">
                <Input id="m-date" type="date" value={manual.date} onChange={(e) => setManual({ ...manual, date: e.target.value })} />
              </FormField>
              <FormField label={t("rateLabel")} htmlFor="m-rate" className="w-40">
                <Input id="m-rate" inputMode="decimal" value={manual.rate} onChange={(e) => setManual({ ...manual, rate: e.target.value })} />
              </FormField>
              <Button type="submit" disabled={pending || !manual.currency || !manual.date || !manual.rate}>
                {tc("save")}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
