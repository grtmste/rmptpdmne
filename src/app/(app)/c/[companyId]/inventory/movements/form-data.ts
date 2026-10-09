import "server-only";
import type { CompanyContext } from "@/server/session";
import type { MovementFormData } from "./movement-form";

export async function loadMovementFormData(ctx: CompanyContext): Promise<MovementFormData> {
  const [warehouses, items, accounts] = await Promise.all([
    ctx.cdb.warehouse.findMany({ where: { active: true }, orderBy: [{ isDefault: "desc" }, { code: "asc" }], select: { id: true, name: true } }),
    ctx.cdb.item.findMany({ where: { trackStock: true, active: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, unit: true } }),
    ctx.cdb.glAccount.findMany({ where: { active: true, kind: "DETAIL" }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
  ]);
  return { warehouses, items, accounts };
}
