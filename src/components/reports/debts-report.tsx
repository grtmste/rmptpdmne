import Link from "next/link";
import { Fragment } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import type Decimal from "decimal.js";
import { HandCoins } from "lucide-react";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { AGING_BUCKETS } from "@/lib/reports/aging";
import type { OpenDocument, PartyAging, PartyTurnover } from "@/server/reports/debts";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";

const DOC_PATHS: Record<OpenDocument["type"], string> = {
  SALES_INVOICE: "/sales/invoices",
  PURCHASE_INVOICE: "/purchases/invoices",
  EXPENSE_REPORT: "/purchases/expenses",
};

/** Võlgnevused seisuga: partnerid tähtaja ületamise vahemike kaupa, soovi korral dokumentidega. */
export async function AgingTable({
  companyId,
  rows,
  totals,
  asOf,
  detail,
}: {
  companyId: string;
  rows: PartyAging[];
  totals: { buckets: Record<string, Decimal>; prepayment: Decimal; total: Decimal };
  asOf: Date;
  detail: boolean;
}) {
  const t = await getTranslations("debts");
  const locale = await getLocale();
  const m = (v: Decimal) => (v.isZero() ? "" : formatMoney(v, locale));
  if (rows.length === 0) return <EmptyState icon={HandCoins} title={t("emptyTitle")} description={t("emptyBody")} />;
  const cols = AGING_BUCKETS.length + 3;
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm" data-testid="aging-table">
          <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">{t("party")}</th>
              {AGING_BUCKETS.map((b) => (
                <th key={b} className="w-28 px-2 py-2 text-right font-medium">
                  {t(`buckets.${b}`)}
                </th>
              ))}
              <th className="w-28 px-2 py-2 text-right font-medium">{t("prepayment")}</th>
              <th className="w-32 px-4 py-2 text-right font-medium">{t("total")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <Fragment key={r.partyKey}>
                <tr className={cn("hover:bg-muted/30", detail && "bg-muted/20 font-medium")}>
                  <td className="px-4 py-1.5">{r.partyName}</td>
                  {AGING_BUCKETS.map((b) => (
                    <td key={b} className={cn("num px-2 py-1.5", b !== "notDue" && !r.buckets[b].isZero() && "text-destructive")}>
                      {m(r.buckets[b])}
                    </td>
                  ))}
                  <td className="num px-2 py-1.5 text-muted-foreground">{m(r.prepayment)}</td>
                  <td className="num px-4 py-1.5 font-semibold">{formatMoney(r.total, locale)}</td>
                </tr>
                {detail &&
                  r.documents.map((d) => {
                    const overdue = Math.round((asOf.getTime() - d.dueDate.getTime()) / 86_400_000);
                    return (
                      <tr key={d.id} className="text-xs text-muted-foreground">
                        <td className="py-1 pr-2 pl-8" colSpan={2}>
                          <Link href={`/c/${companyId}${DOC_PATHS[d.type]}?doc=${d.id}`} className="font-mono text-primary hover:underline">
                            {d.number}
                          </Link>{" "}
                          · {formatDate(d.date, locale)} · {t("due", { date: formatDate(d.dueDate, locale) })}
                          {overdue > 0 && <span className="ml-1 text-destructive">({t("overdueDays", { days: overdue })})</span>}
                        </td>
                        <td colSpan={cols - 4} className="num px-2 py-1">
                          {d.currency !== "EUR" ? `${formatMoney(d.open, locale)} ${d.currency}` : ""}
                        </td>
                        <td className="num px-4 py-1" colSpan={2}>
                          {formatMoney(d.openBase, locale)}
                        </td>
                      </tr>
                    );
                  })}
              </Fragment>
            ))}
          </tbody>
          <tfoot className="border-t-2 font-semibold">
            <tr>
              <td className="px-4 py-2">{t("totalRow")}</td>
              {AGING_BUCKETS.map((b) => (
                <td key={b} className="num px-2 py-2">
                  {m(totals.buckets[b]!)}
                </td>
              ))}
              <td className="num px-2 py-2">{m(totals.prepayment)}</td>
              <td className="num px-4 py-2" data-testid="debts-total">
                {formatMoney(totals.total, locale)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

/** Partnerite käibeandmik. */
export async function TurnoverTable({
  rows,
  totals,
  side,
}: {
  rows: PartyTurnover[];
  totals: { opening: Decimal; invoiced: Decimal; paid: Decimal; closing: Decimal };
  side: "receivables" | "payables";
}) {
  const t = await getTranslations("debts");
  const locale = await getLocale();
  const m = (v: Decimal) => formatMoney(v, locale);
  if (rows.length === 0) return <EmptyState icon={HandCoins} title={t("emptyTitle")} description={t("emptyBody")} />;
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm" data-testid="turnover-table">
          <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">{t("party")}</th>
              <th className="w-32 px-2 py-2 text-right font-medium">{t("opening")}</th>
              <th className="w-32 px-2 py-2 text-right font-medium">{side === "receivables" ? t("invoicedSales") : t("invoicedPurchases")}</th>
              <th className="w-32 px-2 py-2 text-right font-medium">{t("paid")}</th>
              <th className="w-32 px-4 py-2 text-right font-medium">{t("closing")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.partyKey} className="hover:bg-muted/30">
                <td className="px-4 py-1.5">{r.partyName}</td>
                <td className="num px-2 py-1.5">{m(r.opening)}</td>
                <td className="num px-2 py-1.5">{m(r.invoiced)}</td>
                <td className="num px-2 py-1.5">{m(r.paid)}</td>
                <td className="num px-4 py-1.5 font-semibold">{m(r.closing)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 font-semibold">
            <tr>
              <td className="px-4 py-2">{t("totalRow")}</td>
              <td className="num px-2 py-2">{m(totals.opening)}</td>
              <td className="num px-2 py-2">{m(totals.invoiced)}</td>
              <td className="num px-2 py-2">{m(totals.paid)}</td>
              <td className="num px-4 py-2">{m(totals.closing)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}
