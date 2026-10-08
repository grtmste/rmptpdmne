"use client";

import { useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2, FileUp, Lock, Scale } from "lucide-react";
import { addDays, parseISODate } from "@/lib/accounting/dates";
import { formatDate } from "@/lib/dates";
import { dec, formatMoney, parseMoneyInput, sum } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/common/form-field";
import { useActionRunner } from "@/components/common/use-action";
import { saveOpeningBalances } from "@/server/actions/settings/opening";
import { parseOpeningCsv } from "./parse-csv";

const TYPES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const;

export type OpeningAccount = {
  id: string;
  code: string;
  name: string;
  type: (typeof TYPES)[number];
  debit: string;
  credit: string;
};

export function OpeningBalancesEditor({
  companyId,
  accounts,
  accountingStartDate,
  saved,
  canEdit,
  locked,
}: {
  companyId: string;
  accounts: OpeningAccount[];
  accountingStartDate: string;
  saved: boolean;
  canEdit: boolean;
  locked: boolean;
}) {
  const t = useTranslations("opening");
  const ta = useTranslations("accounts");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { pending, run } = useActionRunner();
  const [startDate, setStartDate] = useState(accountingStartDate);
  const [values, setValues] = useState(() => new Map(accounts.map((a) => [a.id, { debit: a.debit, credit: a.credit }])));
  const [onlyFilled, setOnlyFilled] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const parse = (s: string) => (s.trim() === "" ? dec(0) : (parseMoneyInput(s) ?? null));
  const invalid = useMemo(() => {
    const bad = new Set<string>();
    for (const [id, v] of values) if (parse(v.debit) === null || parse(v.credit) === null) bad.add(id);
    return bad;
  }, [values]);
  const totals = useMemo(() => {
    const all = [...values.values()];
    const debit = sum(all.map((v) => parse(v.debit) ?? 0));
    const credit = sum(all.map((v) => parse(v.credit) ?? 0));
    return { debit, credit, diff: debit.minus(credit) };
  }, [values]);
  const balanced = totals.diff.isZero() && invalid.size === 0;
  const openingDate = parseISODate(startDate) ? formatDate(addDays(parseISODate(startDate)!, -1), locale) : "—";

  const visible = accounts.filter((a) => {
    if (!onlyFilled) return true;
    const v = values.get(a.id);
    return Boolean(v?.debit.trim() || v?.credit.trim());
  });

  function update(id: string, side: "debit" | "credit", value: string) {
    setValues((prev) => {
      const next = new Map(prev);
      next.set(id, { ...next.get(id)!, [side]: value });
      return next;
    });
  }

  /** Enter liigub samas veerus järgmisele reale (nagu tabelarvutuses). */
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const inputs = [...(tableRef.current?.querySelectorAll<HTMLInputElement>(`input[data-col="${e.currentTarget.dataset.col}"]`) ?? [])];
    const idx = inputs.indexOf(e.currentTarget);
    inputs[e.shiftKey ? idx - 1 : idx + 1]?.focus();
  }

  async function importFile(file: File) {
    const text = await file.text();
    const result = parseOpeningCsv(text);
    if (!result.ok) {
      toast.error(t(`csv.${result.error}`));
      return;
    }
    const byCode = new Map(accounts.map((a) => [a.code, a.id]));
    const unknown: string[] = [];
    const next = new Map([...values].map(([id]) => [id, { debit: "", credit: "" }]));
    for (const row of result.rows) {
      const id = byCode.get(row.code);
      if (!id) {
        unknown.push(row.code);
        continue;
      }
      const cur = next.get(id)!;
      next.set(id, {
        debit: row.debit ? dec(parse(cur.debit) ?? 0).plus(row.debit).toFixed(2) : cur.debit,
        credit: row.credit ? dec(parse(cur.credit) ?? 0).plus(row.credit).toFixed(2) : cur.credit,
      });
    }
    setValues(next);
    if (unknown.length) toast.warning(t("csv.unknownAccounts", { codes: unknown.slice(0, 10).join(", ") }));
    else toast.success(t("csv.imported", { count: result.rows.length }));
  }

  function save() {
    run(
      () =>
        saveOpeningBalances(companyId, {
          accountingStartDate: startDate,
          lines: [...values].map(([accountId, v]) => ({ accountId, debit: v.debit, credit: v.credit })),
        }),
      { success: t("saved") },
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-5">
          <FormField label={t("startDate")} htmlFor="startDate" hint={t("openingDate", { date: openingDate })} className="w-56">
            <Input id="startDate" type="date" value={startDate} disabled={!canEdit} onChange={(e) => setStartDate(e.target.value)} />
          </FormField>
          <p className="max-w-md flex-1 text-xs text-muted-foreground">{t("explain")}</p>
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-success">
              <CheckCircle2 className="size-4" /> {t("savedBadge")}
            </span>
          )}
          {locked && (
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Lock className="size-4" /> {t("locked")}
            </span>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Checkbox label={t("onlyFilled")} checked={onlyFilled} onChange={(e) => setOnlyFilled(e.target.checked)} />
        {canEdit && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importFile(f);
                e.target.value = "";
              }}
            />
            <Button variant="outline" size="sm" className="ml-auto" onClick={() => fileRef.current?.click()}>
              <FileUp /> {t("importCsv")}
            </Button>
          </>
        )}
      </div>
      {canEdit && <p className="text-xs text-muted-foreground">{t("csvHint")}</p>}

      {/* Card ilma overflow-hidden'ita, et päis ja summarida saaksid lehe kerimisel kleepuda */}
      <Card>
        <div ref={tableRef}>
          <table className="w-full text-sm">
            <thead className="sticky top-14 z-10 border-b bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="w-24 px-3 py-2 text-left font-medium">{ta("code")}</th>
                <th className="px-3 py-2 text-left font-medium">{ta("name")}</th>
                <th className="w-40 px-3 py-2 text-right font-medium">{t("debit")}</th>
                <th className="w-40 px-3 py-2 text-right font-medium">{t("credit")}</th>
              </tr>
            </thead>
            {TYPES.map((type) => {
              const rows = visible.filter((a) => a.type === type);
              if (rows.length === 0) return null;
              return (
                <tbody key={type} className="divide-y">
                  <tr className="bg-muted/40">
                    <td colSpan={4} className="px-3 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      {ta(`types.${type}`)}
                    </td>
                  </tr>
                  {rows.map((a) => {
                    const v = values.get(a.id)!;
                    const bad = invalid.has(a.id);
                    return (
                      <tr key={a.id} className={cn("hover:bg-muted/30", bad && "bg-destructive/5")}>
                        <td className="px-3 py-1 font-mono text-[13px]">{a.code}</td>
                        <td className="px-3 py-1">{a.name}</td>
                        {(["debit", "credit"] as const).map((side) => (
                          <td key={side} className="px-2 py-1">
                            <Input
                              data-col={side}
                              aria-label={`${a.code} ${t(side)}`}
                              inputMode="decimal"
                              className="h-8 text-right tabular-nums"
                              value={v[side]}
                              disabled={!canEdit}
                              aria-invalid={bad || undefined}
                              onKeyDown={onKeyDown}
                              onChange={(e) => update(a.id, side, e.target.value)}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}
          </table>
        </div>
        <div className="sticky bottom-16 z-10 flex flex-wrap items-center gap-x-8 gap-y-2 rounded-b-xl border-t bg-card/95 px-4 py-3 text-sm shadow-[0_-4px_12px_rgba(28,25,23,0.06)] backdrop-blur md:bottom-0">
          <span className="flex items-center gap-2 font-medium">
            <Scale className="size-4 text-muted-foreground" /> {t("totals")}
          </span>
          <span>
            {t("debit")}: <b className="tabular-nums">{formatMoney(totals.debit, locale)}</b>
          </span>
          <span>
            {t("credit")}: <b className="tabular-nums">{formatMoney(totals.credit, locale)}</b>
          </span>
          <span className={cn("font-medium", balanced ? "text-success" : "text-destructive")} role="status">
            {balanced ? t("balanced") : t("difference", { amount: formatMoney(totals.diff.abs(), locale) })}
          </span>
          {canEdit && (
            <Button className="ml-auto" disabled={pending || !balanced} onClick={save}>
              {pending ? tc("saving") : tc("save")}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
