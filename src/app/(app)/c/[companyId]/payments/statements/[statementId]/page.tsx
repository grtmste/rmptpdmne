import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { toISODate } from "@/lib/accounting/dates";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/common/page-header";
import { loadPaymentFormData } from "../../form-data";
import { StatementLines, type LineView } from "./statement-lines";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("statements");
  return { title: t("detailTitle") };
}

export default async function StatementPage({ params }: PageProps<"/c/[companyId]/payments/statements/[statementId]">) {
  const { companyId, statementId } = await params;
  const ctx = await requireCompany(companyId, "payments");
  const t = await getTranslations("statements");
  const locale = await getLocale();
  const statement = await ctx.cdb.bankStatement.findFirst({
    where: { id: statementId },
    include: { bankAccount: { select: { name: true } }, lines: { orderBy: { sortOrder: "asc" } } },
  });
  if (!statement) notFound();
  const paymentIds = statement.lines.map((l) => l.paymentId).filter((x): x is string => Boolean(x));
  const [payments, formData] = await Promise.all([
    ctx.cdb.payment.findMany({ where: { id: { in: paymentIds } }, select: { id: true, number: true } }),
    loadPaymentFormData(ctx),
  ]);
  const paymentNo = new Map(payments.map((p) => [p.id, p.number]));
  const lines: LineView[] = statement.lines.map((l) => ({
    id: l.id,
    date: toISODate(l.date),
    amount: l.amount.toFixed(2),
    partyName: l.partyName,
    partyIban: l.partyIban,
    referenceNumber: l.referenceNumber,
    description: l.description,
    status: l.status,
    suggestion: (l.suggestion as LineView["suggestion"]) ?? null,
    payment: l.paymentId ? { id: l.paymentId, number: paymentNo.get(l.paymentId) ?? null } : null,
  }));
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={`${t("detailTitle")} – ${statement.bankAccount.name}`}
        description={[
          statement.fromDate && statement.toDate ? `${formatDate(statement.fromDate, locale)} – ${formatDate(statement.toDate, locale)}` : null,
          statement.openingBalance ? t("opening", { amount: formatMoney(statement.openingBalance, locale) }) : null,
          statement.closingBalance ? t("closing", { amount: formatMoney(statement.closingBalance, locale) }) : null,
          statement.fileName,
        ]
          .filter(Boolean)
          .join(" · ")}
      />
      <StatementLines
        companyId={companyId}
        statementId={statement.id}
        lines={lines}
        canConfirm={can(ctx.membership, "payments", "confirm")}
        canEdit={can(ctx.membership, "payments", "edit")}
        data={formData}
      />
    </div>
  );
}
