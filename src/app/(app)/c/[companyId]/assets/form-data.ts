import "server-only";
import { db } from "@/lib/db";
import { ensureDefaultAssetGroups } from "@/server/services/assets";
import type { CompanyContext } from "@/server/session";
import type { AssetFormData } from "./asset-form";

export async function loadAssetFormData(ctx: CompanyContext): Promise<AssetFormData> {
  await db.$transaction((tx) => ensureDefaultAssetGroups(tx, ctx.company.id, ctx.user.id));
  const [groups, locations, employees, departments, accounts] = await Promise.all([
    ctx.cdb.fixedAssetGroup.findMany({ orderBy: { name: "asc" } }),
    ctx.cdb.fixedAssetLocation.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ctx.cdb.employee.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ctx.cdb.department.findMany({ where: { active: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    ctx.cdb.glAccount.findMany({ where: { active: true, kind: "DETAIL", type: { in: ["ASSET", "EXPENSE"] } }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, type: true } }),
  ]);
  return {
    groups: groups.map((g) => ({ id: g.id, name: g.name, assetAccountId: g.assetAccountId, accumulatedAccountId: g.accumulatedAccountId, expenseAccountId: g.expenseAccountId, usefulLifeMonths: g.usefulLifeMonths })),
    locations,
    employees,
    departments,
    accounts,
  };
}
