import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { toISODate } from "@/lib/accounting/dates";
import { todayLocal } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/page-header";
import { ExpenseEditor } from "../expense-editor";
import { loadPurchaseEditorData } from "../../editor-data";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("expenses");
  return { title: t("newTitle") };
}

export default async function NewExpenseReportPage({ params }: PageProps<"/c/[companyId]/purchases/expenses/new">) {
  const { companyId } = await params;
  const ctx = await requireCompany(companyId, "purchases", "edit");
  const t = await getTranslations("expenses");
  const [data, employees] = await Promise.all([
    loadPurchaseEditorData(ctx),
    ctx.cdb.employee.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={t("newTitle")}
        description={t("newSubtitle")}
        actions={
          employees.length === 0 && (
            <Button asChild variant="outline">
              <Link href={`/c/${companyId}/purchases/employees`}>{t("addEmployeeFirst")}</Link>
            </Button>
          )
        }
      />
      <ExpenseEditor
        companyId={companyId}
        employees={employees}
        data={data}
        canConfirm={can(ctx.membership, "purchases", "confirm")}
        initial={{ employeeId: employees.length === 1 ? employees[0]!.id : "", date: toISODate(todayLocal()), description: "", lines: [] }}
      />
    </div>
  );
}
