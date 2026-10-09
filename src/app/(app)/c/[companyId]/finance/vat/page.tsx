import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type Decimal from "decimal.js";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { requireCompany } from "@/server/session";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { vatReturn } from "@/server/reports/vat";
import { KMD_LINES, type KmdInfLine } from "@/lib/vat/kmd";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { VatControls } from "./vat-controls";
import { kmdKey, parseVatQuery } from "./vat-params";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.finance.vat") };
}

export default async function VatPage({ params, searchParams }: PageProps<"/c/[companyId]/finance/vat">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "finance");
  const t = await getTranslations("vatReturn");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const q = parseVatQuery(sp);
  const r = await vatReturn(db, companyId, q);
  const m = (v: Decimal) => formatMoney(v, locale);
  const visible = KMD_LINES.filter((l) => l.total || !r.kmd.lines.get(l.code)!.isZero() || ["1", "2", "3", "5"].includes(l.code));

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader
        title={tn("items.finance.vat")}
        description={t("subtitle", { from: formatDate(r.from, locale), to: formatDate(r.to, locale) })}
      />
      <VatControls
        companyId={companyId}
        initial={{ period: q.period, plus: q.adjustmentsPlus ?? "", minus: q.adjustmentsMinus ?? "" }}
        closed={Boolean(r.closing)}
        canEdit={can(ctx.membership, "finance", "edit")}
      />
      {r.closing && (
        <p className="text-sm text-muted-foreground">
          {t("closedInfo")}{" "}
          <Link className="font-mono text-primary hover:underline" href={`/c/${companyId}/finance/journal?entry=${r.closing.id}`}>
            {r.closing.number}
          </Link>
        </p>
      )}
      {r.kmd.unknownRates.length > 0 && (
        <p role="alert" className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-2 text-sm text-warning">
          {t("unknownRates", { rates: r.kmd.unknownRates.join(", ") })}
        </p>
      )}

      <Card className="overflow-hidden">
        <table className="w-full text-sm" data-testid="kmd-table">
          <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="w-16 px-4 py-2 text-left font-medium">{t("line")}</th>
              <th className="px-2 py-2 text-left font-medium">{t("description")}</th>
              <th className="w-40 px-4 py-2 text-right font-medium">{t("amount")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {visible.map((l) => (
              <tr key={l.code} data-line={l.code} className={cn(l.total && "bg-muted/20 font-semibold")}>
                <td className="px-4 py-1.5 font-mono text-xs">{l.code}</td>
                <td className="px-2 py-1.5">{t(`lines.${kmdKey(l.code)}`)}</td>
                <td className="num px-4 py-1.5">{m(r.kmd.lines.get(l.code)!)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-muted-foreground">{t("note")}</p>

      <InfTable title={t("partA")} empty={t("noInf")} rows={r.partA} part="A" />
      <InfTable title={t("partB")} empty={t("noInf")} rows={r.partB} part="B" />
    </div>
  );
}

async function InfTable({ title, rows, part, empty }: { title: string; rows: KmdInfLine[]; part: "A" | "B"; empty: string }) {
  const t = await getTranslations("vatReturn");
  const locale = await getLocale();
  const m = (v: Decimal) => formatMoney(v, locale);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">{empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-y bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">{t("partner")}</th>
                  <th className="px-2 py-2 text-left font-medium">{t("invoice")}</th>
                  <th className="px-2 py-2 text-right font-medium">{part === "A" ? t("invoiceNet") : t("invoiceGross")}</th>
                  {part === "A" && <th className="px-2 py-2 text-right font-medium">{t("rate")}</th>}
                  <th className="px-2 py-2 text-right font-medium">{part === "A" ? t("sumForRate") : t("vatInPeriod")}</th>
                  <th className="px-4 py-2 text-left font-medium">{t("code")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((l, i) => (
                  <tr key={`${l.invoiceNumber}-${i}`}>
                    <td className="px-4 py-1.5">
                      <div>{l.partnerName}</div>
                      <div className="text-xs text-muted-foreground">{l.partnerRegCode}</div>
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="font-mono text-xs">{l.invoiceNumber}</div>
                      <div className="text-xs text-muted-foreground">{formatDate(l.invoiceDate, locale)}</div>
                    </td>
                    <td className="num px-2 py-1.5">{m(l.invoiceSum)}</td>
                    {part === "A" && <td className="num px-2 py-1.5">{l.taxRate}%</td>}
                    <td className="num px-2 py-1.5">{m(part === "A" ? l.sumForRate : l.sumInPeriod)}</td>
                    <td className="px-4 py-1.5 font-mono text-xs">{l.comment ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
