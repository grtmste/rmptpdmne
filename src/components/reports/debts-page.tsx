import { getLocale, getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { debtsAsOf, partyTurnover, type DebtSide } from "@/server/reports/debts";
import { PageHeader } from "@/components/common/page-header";
import { ReportBar } from "./report-bar";
import { AgingTable, TurnoverTable } from "./debts-report";
import { parseDocReportQuery } from "./params";

type Params = Record<string, string | string[] | undefined>;

/** Klientide või tarnijate võlgnevuste leht: seisuga (vanuseline) või käibeandmik. */
export async function DebtsPage({ companyId, side, sp, title }: { companyId: string; side: DebtSide; sp: Params; title: string }) {
  const t = await getTranslations("debts");
  const tr = await getTranslations("reports");
  const locale = await getLocale();
  const q = await parseDocReportQuery(companyId, sp, ["none"] as const, "none");
  const mode = q.mode === "turnover" ? "turnover" : "asOf";
  const qs = new URLSearchParams({ mode, from: q.fromIso, to: q.toIso, ...(q.search ? { q: q.search } : {}) });
  const exportHref = `/c/${companyId}/report-export/${side}?${qs}`;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title={title}
        description={
          mode === "asOf"
            ? t("asOfLabel", { date: formatDate(q.to, locale) })
            : tr("periodLabel", { from: formatDate(q.from, locale), to: formatDate(q.to, locale) })
        }
      />
      <ReportBar
        fields={[
          {
            key: "mode",
            label: t("mode"),
            type: "select",
            options: [
              { value: "asOf", label: t("modeAsOf") },
              { value: "turnover", label: t("modeTurnover") },
            ],
          },
          { key: "from", label: tr("from"), type: "date" },
          { key: "to", label: t("dateOrEnd"), type: "date" },
          { key: "q", label: t("searchParty"), type: "search" },
          { key: "detail", label: t("showDocuments"), type: "check" },
        ]}
        visibleWhen={{ from: { key: "mode", values: ["turnover"] }, detail: { key: "mode", values: ["asOf"] } }}
        initial={{ mode, from: q.fromIso, to: q.toIso, q: q.search, detail: q.detail ? "1" : "" }}
        exportHref={exportHref}
      />
      {mode === "asOf" ? (
        <AgingTable companyId={companyId} asOf={q.to} detail={q.detail} {...await debtsAsOf(db, companyId, side, q.to, q.search)} />
      ) : (
        <TurnoverTable side={side} {...await partyTurnover(db, companyId, side, q.from, q.to, q.search)} />
      )}
      <p className="text-xs text-muted-foreground">{t("note")}</p>
    </div>
  );
}
