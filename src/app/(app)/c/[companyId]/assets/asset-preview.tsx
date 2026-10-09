"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRightLeft, BookOpen, Pencil, Trash2, TrendingUp, X, XCircle } from "lucide-react";
import { parseISODate } from "@/lib/accounting/dates";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { FormError, FormField } from "@/components/common/form-field";
import { useActionRunner } from "@/components/common/use-action";
import { deleteAssetAction, disposeAssetAction, reclassifyAssetAction, revalueAssetAction } from "@/server/actions/assets";

export type AssetPreviewData = {
  id: string;
  code: string;
  name: string;
  status: "ACTIVE" | "DISPOSED";
  group: string;
  groupId: string;
  location: string | null;
  responsible: string | null;
  serialNumber: string | null;
  acquisitionDate: string;
  depreciationStart: string;
  disposedAt: string | null;
  cost: string;
  residualValue: string;
  accumulated: string;
  bookValue: string;
  usefulLifeMonths: number;
  monthsDone: number;
  accounts: { asset: string; accumulated: string; expense: string };
  purchaseInvoice: { id: string; label: string } | null;
  notes: string | null;
  canDelete: boolean;
  history: Array<{ key: string; date: string; label: string; amount: string | null; journalId: string | null }>;
  schedule: Array<{ period: string; amount: string; bookValue: string }>;
};

type Kind = "revalue" | "reclassify" | "dispose";

export function AssetPreview({
  companyId,
  asset: a,
  closeHref,
  canEdit,
  canConfirm,
  canViewLedger,
  today,
  groups,
  accounts,
  lossAccountId,
}: {
  companyId: string;
  asset: AssetPreviewData;
  closeHref: string;
  canEdit: boolean;
  canConfirm: boolean;
  canViewLedger: boolean;
  today: string;
  groups: Array<{ id: string; name: string }>;
  accounts: Array<{ id: string; label: string }>;
  lossAccountId: string;
}) {
  const t = useTranslations("assets");
  const ti = useTranslations("invoices");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const { pending, run } = useActionRunner();
  const [dialog, setDialog] = useState<Kind | null>(null);
  const [form, setForm] = useState({ date: today, newCost: a.cost, life: String(a.usefulLifeMonths), counter: "", groupId: "", loss: lossAccountId, description: "" });
  const [error, setError] = useState<string | null>(null);
  const active = a.status === "ACTIVE";
  const money = (v: string) => formatMoney(v, locale);
  const open = (k: Kind) => {
    setForm({ date: today, newCost: a.cost, life: String(a.usefulLifeMonths), counter: "", groupId: groups.find((g) => g.id !== a.groupId)?.id ?? "", loss: lossAccountId, description: "" });
    setError(null);
    setDialog(k);
  };
  const done = { onSuccess: () => setDialog(null), onError: (_: unknown, msg: string) => setError(msg) };

  function submit() {
    setError(null);
    if (dialog === "revalue") {
      run(
        () => revalueAssetAction(companyId, { assetId: a.id, date: form.date, newCost: form.newCost, usefulLifeMonths: form.life === String(a.usefulLifeMonths) ? "" : form.life, counterAccountId: form.counter, description: form.description }),
        { success: t("revalued"), ...done },
      );
    } else if (dialog === "reclassify") {
      run(() => reclassifyAssetAction(companyId, { assetId: a.id, date: form.date, groupId: form.groupId, description: form.description }), { success: t("reclassified"), ...done });
    } else if (dialog === "dispose") {
      run(() => disposeAssetAction(companyId, { assetId: a.id, date: form.date, lossAccountId: form.loss, description: form.description }), { success: t("disposed"), ...done });
    }
  }

  const accountSelect = (value: string, onChange: (v: string) => void, id: string, label: string, hint?: string) => (
    <FormField label={label} htmlFor={id} hint={hint}>
      <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {accounts.map((x) => (
          <option key={x.id} value={x.id}>
            {x.label}
          </option>
        ))}
      </NativeSelect>
    </FormField>
  );

  return (
    <Card className="self-start lg:sticky lg:top-20">
      <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{a.name}</h2>
            <Badge variant={active ? "success" : "outline"}>{t(`statuses.${a.status}`)}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{a.code}</span> · {a.group}
            {a.location ? ` · ${a.location}` : ""}
            {a.responsible ? ` · ${a.responsible}` : ""}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" asChild>
          <Link href={closeHref} scroll={false} aria-label={ti("closePreview")}>
            <X />
          </Link>
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
        {canEdit && (
          <Button size="sm" variant="outline" asChild>
            <Link href={`/c/${companyId}/assets/${a.id}/edit`}>
              <Pencil /> {ti("edit")}
            </Link>
          </Button>
        )}
        {active && canConfirm && (
          <>
            <Button size="sm" variant="outline" onClick={() => open("revalue")}>
              <TrendingUp /> {t("revalue")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => open("reclassify")}>
              <ArrowRightLeft /> {t("reclassify")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => open("dispose")}>
              <XCircle /> {t("dispose")}
            </Button>
          </>
        )}
        {canEdit && a.canDelete && (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={pending}
            onClick={() =>
              confirm(t("deleteConfirm", { name: a.name })) &&
              run(() => deleteAssetAction(companyId, { id: a.id }), { success: t("deleted"), refresh: false, onSuccess: () => router.push(closeHref) })
            }
          >
            <Trash2 /> {tc("delete")}
          </Button>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-b px-5 py-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">{t("cost")}</dt>
          <dd className="font-medium tabular-nums">{money(a.cost)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("accumulated")}</dt>
          <dd className="tabular-nums">{money(a.accumulated)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("bookValue")}</dt>
          <dd className="font-semibold tabular-nums">{money(a.bookValue)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("acquisitionDate")}</dt>
          <dd>{formatDate(parseISODate(a.acquisitionDate)!, locale)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("usefulLife")}</dt>
          <dd>{t("lifeProgress", { done: a.monthsDone, total: a.usefulLifeMonths })}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("residualValue")}</dt>
          <dd className="tabular-nums">{money(a.residualValue)}</dd>
        </div>
        {a.disposedAt && (
          <div>
            <dt className="text-xs text-muted-foreground">{t("disposedAt")}</dt>
            <dd>{formatDate(parseISODate(a.disposedAt)!, locale)}</dd>
          </div>
        )}
        {a.serialNumber && (
          <div>
            <dt className="text-xs text-muted-foreground">{t("serialNumber")}</dt>
            <dd>{a.serialNumber}</dd>
          </div>
        )}
        {a.purchaseInvoice && (
          <div>
            <dt className="text-xs text-muted-foreground">{t("purchaseInvoice")}</dt>
            <dd>
              <Link className="text-primary hover:underline" href={`/c/${companyId}/purchases/invoices?doc=${a.purchaseInvoice.id}`}>
                {a.purchaseInvoice.label}
              </Link>
            </dd>
          </div>
        )}
        <div className="col-span-2 sm:col-span-3">
          <dt className="text-xs text-muted-foreground">{t("accounts")}</dt>
          <dd className="text-xs">
            {a.accounts.asset} · {a.accounts.accumulated} · {a.accounts.expense}
          </dd>
        </div>
        {a.notes && (
          <div className="col-span-2 sm:col-span-3">
            <dt className="text-xs text-muted-foreground">{t("notes")}</dt>
            <dd>{a.notes}</dd>
          </div>
        )}
      </dl>
      {a.history.length > 0 && (
        <div className="border-b px-5 py-3">
          <h3 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("history")}</h3>
          <table className="w-full text-sm" data-testid="asset-history">
            <tbody className="divide-y">
              {a.history.map((h) => (
                <tr key={h.key}>
                  <td className="py-1 pr-3 text-muted-foreground tabular-nums">{formatDate(parseISODate(h.date)!, locale)}</td>
                  <td className="py-1">{h.label}</td>
                  <td className="py-1 text-right tabular-nums">{h.amount ? money(h.amount) : ""}</td>
                  <td className="w-8 py-1 text-right">
                    {h.journalId && canViewLedger && (
                      <Link href={`/c/${companyId}/finance/journal?entry=${h.journalId}`} aria-label={t("openEntry")} className="text-primary">
                        <BookOpen className="inline size-3.5" />
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {active && a.schedule.length > 0 && (
        <div className="px-5 py-3">
          <h3 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("schedule")}</h3>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-1 text-left font-medium">{t("month")}</th>
                <th className="py-1 text-right font-medium">{t("depreciation")}</th>
                <th className="py-1 text-right font-medium">{t("bookValue")}</th>
              </tr>
            </thead>
            <tbody>
              {a.schedule.map((s) => (
                <tr key={s.period}>
                  <td className="py-0.5 tabular-nums">{s.period.slice(5, 7)}.{s.period.slice(0, 4)}</td>
                  <td className="py-0.5 text-right tabular-nums">{money(s.amount)}</td>
                  <td className="py-0.5 text-right tabular-nums">{money(s.bookValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog && (
        <Dialog open onOpenChange={(o) => !o && setDialog(null)}>
          <DialogContent closeLabel={tc("close")} aria-describedby={undefined}>
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <DialogHeader>
                <DialogTitle>{t(`${dialog}Title`)}</DialogTitle>
              </DialogHeader>
              <DialogBody className="space-y-4">
                <p className="text-sm text-muted-foreground">{t(`${dialog}Body`, { bookValue: money(a.bookValue) })}</p>
                <FormError message={error} />
                <FormField label={ti("date")} htmlFor="ev-date">
                  <Input id="ev-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                </FormField>
                {dialog === "revalue" && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <FormField label={t("newCost")} htmlFor="ev-cost">
                        <Input id="ev-cost" inputMode="decimal" className="text-right tabular-nums" value={form.newCost} onChange={(e) => setForm({ ...form, newCost: e.target.value })} />
                      </FormField>
                      <FormField label={t("newLife")} htmlFor="ev-life">
                        <Input id="ev-life" inputMode="numeric" className="text-right tabular-nums" value={form.life} onChange={(e) => setForm({ ...form, life: e.target.value })} />
                      </FormField>
                    </div>
                    {accountSelect(form.counter, (counter) => setForm({ ...form, counter }), "ev-counter", t("counterAccount"), t("counterHint"))}
                  </>
                )}
                {dialog === "reclassify" && (
                  <FormField label={t("targetGroup")} htmlFor="ev-group">
                    <NativeSelect id="ev-group" value={form.groupId} onChange={(e) => setForm({ ...form, groupId: e.target.value })}>
                      {groups
                        .filter((g) => g.id !== a.groupId)
                        .map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                    </NativeSelect>
                  </FormField>
                )}
                {dialog === "dispose" && accountSelect(form.loss, (loss) => setForm({ ...form, loss }), "ev-loss", t("lossAccount"), t("lossHint"))}
                <FormField label={t("description")} htmlFor="ev-desc">
                  <Input id="ev-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </FormField>
              </DialogBody>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialog(null)}>
                  {tc("cancel")}
                </Button>
                <Button type="submit" variant={dialog === "dispose" ? "destructive" : "default"} disabled={pending}>
                  {t(dialog)}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
