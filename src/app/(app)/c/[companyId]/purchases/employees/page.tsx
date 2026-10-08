import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { UserRound } from "lucide-react";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { formatIban } from "@/lib/iban";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { EmployeeDialog } from "./employee-dialog";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.purchases.employees") };
}

export default async function EmployeesPage({ params }: PageProps<"/c/[companyId]/purchases/employees">) {
  const { companyId } = await params;
  const ctx = await requireCompany(companyId, "purchases");
  const t = await getTranslations("employees");
  const tn = await getTranslations("nav");
  const employees = await ctx.cdb.employee.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }], include: { _count: { select: { reports: true } } } });
  const canEdit = can(ctx.membership, "purchases", "edit");
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={tn("items.purchases.employees")} description={t("subtitle")} actions={canEdit && <EmployeeDialog companyId={companyId} />} />
      <Card className="overflow-hidden">
        {employees.length === 0 ? (
          <EmptyState icon={UserRound} title={t("emptyTitle")} description={t("emptyBody")} action={canEdit && <EmployeeDialog companyId={companyId} />} />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">{t("name")}</th>
                <th className="hidden px-3 py-2 text-left font-medium sm:table-cell">{t("bankAccount")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("reports")}</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {employees.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-2">
                    <span className="font-medium">{e.name}</span> {!e.active && <Badge variant="outline">{t("inactive")}</Badge>}
                    {e.email && <div className="text-xs text-muted-foreground">{e.email}</div>}
                  </td>
                  <td className="hidden px-3 py-2 font-mono text-xs sm:table-cell">{e.bankAccount ? formatIban(e.bankAccount) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{e._count.reports}</td>
                  <td className="px-2 py-1 text-right">
                    {canEdit && (
                      <EmployeeDialog
                        companyId={companyId}
                        employeeId={e.id}
                        initial={{
                          name: e.name,
                          personalCode: e.personalCode ?? "",
                          email: e.email ?? "",
                          bankAccount: e.bankAccount ? formatIban(e.bankAccount) : "",
                          active: e.active,
                        }}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
