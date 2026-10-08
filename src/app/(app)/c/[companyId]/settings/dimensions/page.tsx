import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { toISODate } from "@/lib/accounting/dates";
import { PageHeader } from "@/components/common/page-header";
import { DimensionsManager, type DepartmentRow, type DimensionRow } from "./dimensions-manager";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.settings.dimensions") };
}

export default async function DimensionsPage({ params }: PageProps<"/c/[companyId]/settings/dimensions">) {
  const { companyId } = await params;
  const ctx = await requireCompany(companyId, "settings");
  const t = await getTranslations("dimensions");
  const tn = await getTranslations("nav");
  const canEdit = can(ctx.membership, "settings", "edit");

  const [departments, dimensions] = await Promise.all([
    ctx.cdb.department.findMany({ orderBy: { code: "asc" } }),
    ctx.cdb.dimension.findMany({ orderBy: { sortOrder: "asc" }, include: { values: { orderBy: { code: "asc" } } } }),
  ]);

  const depRows: DepartmentRow[] = departments.map((d) => ({ id: d.id, code: d.code, name: d.name, active: d.active }));
  const dimRows: DimensionRow[] = dimensions.map((d) => ({
    id: d.id,
    name: d.name,
    kind: d.kind,
    parentId: d.parentId ?? "",
    debitPositive: d.debitPositive,
    active: d.active,
    values: d.values.map((v) => ({
      id: v.id,
      code: v.code,
      name: v.name,
      endDate: v.endDate ? toISODate(v.endDate) : "",
      active: v.active,
    })),
  }));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={tn("items.settings.dimensions")} description={t("subtitle")} />
      <DimensionsManager companyId={companyId} departments={depRows} dimensions={dimRows} canEdit={canEdit} />
    </div>
  );
}
