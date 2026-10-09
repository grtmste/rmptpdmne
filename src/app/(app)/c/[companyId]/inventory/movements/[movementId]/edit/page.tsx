import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { toISODate } from "@/lib/accounting/dates";
import { PageHeader } from "@/components/common/page-header";
import { MovementForm, type MovementType } from "../../movement-form";
import { newMovementLine } from "../../movement-line";
import { loadMovementFormData } from "../../form-data";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inventory");
  return { title: t("editMovementTitle") };
}

export default async function EditMovementPage({ params }: PageProps<"/c/[companyId]/inventory/movements/[movementId]/edit">) {
  const { companyId, movementId } = await params;
  const ctx = await requireCompany(companyId, "inventory", "edit");
  const t = await getTranslations("inventory");
  const m = await ctx.cdb.stockMovement.findFirst({ where: { id: movementId }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
  if (!m || m.type === "SALE" || m.type === "PURCHASE") notFound();
  if (m.status !== "DRAFT") redirect(`/c/${companyId}/inventory/movements?doc=${m.id}`);
  const data = await loadMovementFormData(ctx);
  const type = m.type as MovementType;
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t("editMovementTitle")} description={t(`types.${type}`)} />
      <MovementForm
        companyId={companyId}
        movementId={m.id}
        data={data}
        canConfirm={can(ctx.membership, "inventory", "confirm")}
        initial={{
          type,
          date: toISODate(m.date),
          warehouseId: m.warehouseId,
          toWarehouseId: m.toWarehouseId ?? "",
          counterAccountId: m.counterAccountId ?? "",
          description: m.description ?? "",
          lines: m.lines.map((l) =>
            newMovementLine({
              itemId: l.itemId,
              quantity: (type === "COUNT" ? (l.countedQuantity ?? l.quantity) : l.quantity).abs().toString(),
              unitCost: l.fixedCost ? l.unitCost.toString() : "",
            }),
          ),
        }}
      />
    </div>
  );
}
