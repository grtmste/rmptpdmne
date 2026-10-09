import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { FileSpreadsheet } from "lucide-react";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { StatementUpload } from "./statement-upload";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.payments.statements") };
}

export default async function StatementsPage({ params, searchParams }: PageProps<"/c/[companyId]/payments/statements">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "payments");
  const t = await getTranslations("statements");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const account = typeof sp.account === "string" ? sp.account : "";
  const [banks, statements] = await Promise.all([
    ctx.cdb.bankAccount.findMany({ where: { kind: "BANK", active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, iban: true } }),
    ctx.cdb.bankStatement.findMany({
      where: account ? { bankAccountId: account } : {},
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { bankAccount: { select: { name: true } }, _count: { select: { lines: true } } },
    }),
  ]);
  const open = await ctx.cdb.bankStatementLine.groupBy({
    by: ["statementId"],
    where: { statementId: { in: statements.map((s) => s.id) }, status: { in: ["NEW", "SUGGESTED"] } },
    _count: { _all: true },
  });
  const openBy = new Map(open.map((o) => [o.statementId, o._count._all]));
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader title={tn("items.payments.statements")} description={t("subtitle")} />
      {can(ctx.membership, "payments", "edit") && <StatementUpload companyId={companyId} banks={banks.map((b) => ({ id: b.id, name: b.name }))} defaultBank={account || banks[0]?.id || ""} />}
      <Card className="overflow-hidden">
        {statements.length === 0 ? (
          <EmptyState icon={FileSpreadsheet} title={t("emptyTitle")} description={t("emptyBody")} />
        ) : (
          <ul className="divide-y" aria-label={t("listLabel")}>
            {statements.map((s) => {
              const pending = openBy.get(s.id) ?? 0;
              return (
                <li key={s.id}>
                  <Link href={`/c/${companyId}/payments/statements/${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{s.bankAccount.name}</span>
                        <Badge variant="outline">{s.format === "CAMT053" ? "camt.053" : "CSV"}</Badge>
                        {pending > 0 ? <Badge variant="warning">{t("pendingCount", { count: pending })}</Badge> : <Badge variant="success">{t("done")}</Badge>}
                      </div>
                      <div className="truncate text-sm text-muted-foreground">
                        {s.fromDate && s.toDate ? `${formatDate(s.fromDate, locale)} – ${formatDate(s.toDate, locale)} · ` : ""}
                        {s.fileName}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-sm">
                      <div className="tabular-nums">{t("lineCount", { count: s._count.lines })}</div>
                      <div className="text-xs text-muted-foreground">{formatDate(s.createdAt, locale)}</div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
