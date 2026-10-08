import "server-only";
import type { CompanyContext } from "@/server/session";
import type { EditorAccount, EditorDimension, EditorTemplate } from "./journal-editor";

/** Kande vormi valikud: aktiivsed detailkontod, osakonnad, dimensioonid, käibemaksud, mallid. */
export async function loadEditorData(ctx: CompanyContext) {
  const today = new Date();
  const [accounts, departments, dimensions, vatRates, templates] = await Promise.all([
    ctx.cdb.glAccount.findMany({
      where: { active: true, kind: "DETAIL", OR: [{ role: null }, { role: { not: "CURRENT_YEAR_PROFIT" } }] },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, defaultVatRateId: true, requiresDepartment: true, requiredDimensionIds: true },
    }),
    ctx.cdb.department.findMany({ where: { active: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    ctx.cdb.dimension.findMany({
      where: { active: true, kind: "DETAIL" },
      orderBy: { sortOrder: "asc" },
      include: {
        values: {
          where: { active: true, OR: [{ endDate: null }, { endDate: { gte: today } }] },
          orderBy: { code: "asc" },
          select: { id: true, code: true, name: true },
        },
      },
    }),
    ctx.cdb.vatRate.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, code: true, name: true } }),
    ctx.cdb.journalTemplate.findMany({
      orderBy: { name: "asc" },
      include: { lines: { orderBy: { sortOrder: "asc" } } },
    }),
  ]);
  return {
    accounts: accounts as EditorAccount[],
    departments,
    dimensions: dimensions.map((d) => ({ id: d.id, name: d.name, values: d.values })) as EditorDimension[],
    vatRates,
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      lines: t.lines.map((l) => ({
        accountId: l.accountId,
        debit: l.debit?.toFixed(2) ?? "",
        credit: l.credit?.toFixed(2) ?? "",
        description: l.description ?? "",
      })),
    })) as EditorTemplate[],
  };
}
