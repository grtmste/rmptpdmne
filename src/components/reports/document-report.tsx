import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type Decimal from "decimal.js";
import { formatMoney } from "@/lib/money";
import type { DocReportRow } from "@/server/reports/documents";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { BarChart3 } from "lucide-react";

/** Müügi- või ostuaruande tabel. */
export async function DocumentReportTable({
  rows,
  totals,
  showQuantity,
  docHref,
  groupLabel,
}: {
  rows: DocReportRow[];
  totals: { net: Decimal; vat: Decimal; total: Decimal };
  showQuantity: boolean;
  docHref?: (id: string) => string;
  groupLabel: string;
}) {
  const t = await getTranslations("docReports");
  const locale = await getLocale();
  const m = (v: Decimal) => formatMoney(v, locale);
  if (rows.length === 0) return <EmptyState icon={BarChart3} title={t("emptyTitle")} description={t("emptyBody")} />;
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm" data-testid="doc-report">
          <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">{groupLabel}</th>
              <th className="w-20 px-2 py-2 text-right font-medium">{t("count")}</th>
              {showQuantity && <th className="w-28 px-2 py-2 text-right font-medium">{t("quantity")}</th>}
              <th className="w-32 px-2 py-2 text-right font-medium">{t("net")}</th>
              <th className="w-28 px-2 py-2 text-right font-medium">{t("vat")}</th>
              <th className="w-32 px-4 py-2 text-right font-medium">{t("total")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.key} className="hover:bg-muted/30">
                <td className="px-4 py-1.5">
                  {r.documentId && docHref ? (
                    <Link href={docHref(r.documentId)} className="font-mono text-primary hover:underline">
                      {r.label}
                    </Link>
                  ) : (
                    <span className="font-medium">{r.label}</span>
                  )}
                  {r.sub && <span className="ml-2 text-xs text-muted-foreground">{r.sub}</span>}
                </td>
                <td className="num px-2 py-1.5">{r.count}</td>
                {showQuantity && <td className="num px-2 py-1.5">{r.quantity ? r.quantity.toDecimalPlaces(4).toString() : ""}</td>}
                <td className="num px-2 py-1.5">{m(r.net)}</td>
                <td className="num px-2 py-1.5">{m(r.vat)}</td>
                <td className="num px-4 py-1.5 font-medium">{m(r.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 font-semibold">
            <tr>
              <td className="px-4 py-2">{t("totalRow")}</td>
              <td />
              {showQuantity && <td />}
              <td className="num px-2 py-2">{m(totals.net)}</td>
              <td className="num px-2 py-2">{m(totals.vat)}</td>
              <td className="num px-4 py-2" data-testid="report-total">
                {m(totals.total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}
