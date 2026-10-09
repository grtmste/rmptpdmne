import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { BellRing } from "lucide-react";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { toISODate } from "@/lib/accounting/dates";
import { formatDate } from "@/lib/dates";
import { statementCandidates } from "@/server/sales/statements";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ReportBar } from "@/components/reports/report-bar";
import { ReminderSender } from "./reminder-sender";
import { OVERDUE_STEPS, parseReminderQuery } from "./params";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.sales.reportReminders") };
}

export default async function RemindersPage({ params, searchParams }: PageProps<"/c/[companyId]/sales/reminders">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "sales");
  const t = await getTranslations("reminders");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const q = parseReminderQuery(sp);
  const rows = await statementCandidates(companyId, q.kind, q.asOf, q.days);
  const log = await ctx.cdb.emailLog.findMany({
    where: { documentType: { in: ["Reminder", "Statement"] } },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const names = new Map(
    (await ctx.cdb.customer.findMany({ where: { id: { in: [...new Set(log.map((l) => l.documentId))] } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]),
  );

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title={tn("items.sales.reportReminders")} description={t("subtitle")} />
      <ReportBar
        fields={[
          {
            key: "kind",
            label: t("kind"),
            type: "select",
            options: [
              { value: "REMINDER", label: t("kinds.REMINDER") },
              { value: "STATEMENT", label: t("kinds.STATEMENT") },
            ],
          },
          { key: "to", label: t("asOf"), type: "date" },
          { key: "days", label: t("minDays"), type: "select", options: OVERDUE_STEPS.map((d) => ({ value: d, label: t("days", { days: Number(d) }) })) },
        ]}
        visibleWhen={{ days: { key: "kind", values: ["REMINDER"] } }}
        initial={{ kind: q.kind, to: toISODate(q.asOf), days: String(q.days) }}
      />
      {rows.length === 0 ? (
        <EmptyState icon={BellRing} title={t(q.kind === "REMINDER" ? "emptyReminders" : "emptyStatements")} description={t("emptyBody")} />
      ) : (
        <ReminderSender
          companyId={companyId}
          kind={q.kind}
          asOf={toISODate(q.asOf)}
          days={q.days}
          canSend={can(ctx.membership, "sales", "edit")}
          rows={rows.map((r) => ({
            customerId: r.customerId,
            customerName: r.customerName,
            email: r.email,
            documents: r.documents.length,
            total: r.total.toFixed(2),
            maxOverdueDays: r.maxOverdueDays,
            lastSentAt: r.lastSentAt ? formatDate(r.lastSentAt, locale) : null,
          }))}
        />
      )}
      <p className="text-xs text-muted-foreground">{t("textHint")}</p>
      <Card>
        <CardHeader>
          <CardTitle>{t("logTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {log.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted-foreground">{t("logEmpty")}</p>
          ) : (
            <ul className="divide-y text-sm" data-testid="reminder-log">
              {log.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2">
                  <Badge variant={l.documentType === "Reminder" ? "warning" : "secondary"}>{t(l.documentType === "Reminder" ? "kinds.REMINDER" : "kinds.STATEMENT")}</Badge>
                  <span className="font-medium">{names.get(l.documentId) ?? "—"}</span>
                  <span className="text-muted-foreground">{l.to}</span>
                  {l.status === "FAILED" && <Badge variant="destructive">{t("failed")}</Badge>}
                  <time className="ml-auto text-xs text-muted-foreground" dateTime={l.createdAt.toISOString()}>
                    {formatDate(l.createdAt, locale)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
