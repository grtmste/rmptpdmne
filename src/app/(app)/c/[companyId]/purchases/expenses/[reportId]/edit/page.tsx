import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { toISODate } from "@/lib/accounting/dates";
import { Card, CardContent } from "@/components/ui/card";
import { AttachmentsPanel } from "@/components/common/attachments-panel";
import { PageHeader } from "@/components/common/page-header";
import { ExpenseEditor } from "../../expense-editor";
import { loadPurchaseEditorData } from "../../../editor-data";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("expenses");
  return { title: t("editTitle") };
}

export default async function EditExpenseReportPage({ params }: PageProps<"/c/[companyId]/purchases/expenses/[reportId]/edit">) {
  const { companyId, reportId } = await params;
  const ctx = await requireCompany(companyId, "purchases", "edit");
  const t = await getTranslations("expenses");
  const report = await ctx.cdb.expenseReport.findFirst({ where: { id: reportId }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
  if (!report) notFound();
  if (report.status !== "DRAFT") redirect(`/c/${companyId}/purchases/expenses?doc=${report.id}`);
  const [data, employees, attachments] = await Promise.all([
    loadPurchaseEditorData(ctx),
    ctx.cdb.employee.findMany({ where: { OR: [{ active: true }, { id: report.employeeId }] }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ctx.cdb.attachment.findMany({ where: { documentType: "ExpenseReport", documentId: report.id }, orderBy: { createdAt: "asc" }, select: { id: true, fileName: true, contentType: true, size: true } }),
  ]);
  return (
    <div className="mx-auto max-w-[96rem]">
      <PageHeader title={t("editTitle")} description={t("draftSubtitle")} />
      <ExpenseEditor
        companyId={companyId}
        reportId={report.id}
        employees={employees}
        data={data}
        canConfirm={can(ctx.membership, "purchases", "confirm")}
        initial={{
          employeeId: report.employeeId,
          date: toISODate(report.date),
          description: report.description ?? "",
          lines: report.lines.map((l) => ({
            key: l.id,
            date: toISODate(l.date),
            vendor: l.vendor ?? "",
            documentNumber: l.documentNumber ?? "",
            description: l.description,
            accountId: l.accountId,
            vatRateId: l.vatRateId ?? "",
            grossAmount: l.grossAmount.toFixed(2),
          })),
        }}
        side={
          <Card>
            <CardContent className="pt-5">
              <AttachmentsPanel companyId={companyId} documentType="ExpenseReport" documentId={report.id} attachments={attachments} canEdit />
            </CardContent>
          </Card>
        }
      />
    </div>
  );
}
