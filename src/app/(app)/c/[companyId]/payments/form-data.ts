import "server-only";
import type { CompanyContext } from "@/server/session";
import type { PaymentFormData } from "./payment-form";

export async function loadPaymentFormData(ctx: CompanyContext): Promise<PaymentFormData> {
  const [bankAccounts, customers, suppliers, employees, accounts] = await Promise.all([
    ctx.cdb.bankAccount.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, kind: true, currency: true } }),
    ctx.cdb.customer.findMany({ where: { active: true }, orderBy: { name: "asc" }, take: 5000, select: { id: true, name: true } }),
    ctx.cdb.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" }, take: 5000, select: { id: true, name: true } }),
    ctx.cdb.employee.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ctx.cdb.glAccount.findMany({
      where: { active: true, kind: "DETAIL", OR: [{ role: null }, { role: { not: "CURRENT_YEAR_PROFIT" } }] },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
  ]);
  return { bankAccounts, customers, suppliers, employees, accounts };
}
