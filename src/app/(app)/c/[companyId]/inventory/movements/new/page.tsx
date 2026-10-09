import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { toISODate } from "@/lib/accounting/dates";
import { todayLocal } from "@/lib/dates";
import { defaultWarehouseId } from "@/server/services/inventory";
import { PageHeader } from "@/components/common/page-header";
import { MovementForm, type MovementType } from "../movement-form";
import { newMovementLine } from "../movement-line";
import { loadMovementFormData } from "../form-data";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inventory");
  return { title: t("newMovementTitle") };
}

const TYPES: MovementType[] = ["RECEIPT", "ISSUE", "TRANSFER", "COUNT"];

export default async function NewMovementPage({ params, searchParams }: PageProps<"/c/[companyId]/inventory/movements/new">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "inventory", "edit");
  const t = await getTranslations("inventory");
  // Esimesel kasutamisel tekib vaikimisi ladu
  const defaultWh = await db.$transaction((tx) => defaultWarehouseId(tx, companyId, ctx.user.id));
  const data = await loadMovementFormData(ctx);
  const type = TYPES.includes(sp.type as MovementType) ? (sp.type as MovementType) : "RECEIPT";
  const cogs = type === "ISSUE" || type === "COUNT" ? await ctx.cdb.glAccount.findFirst({ where: { role: "COST_OF_GOODS_SOLD" }, select: { id: true } }) : null;
  const item = typeof sp.item === "string" && data.items.some((i) => i.id === sp.item) ? sp.item : "";
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t(`new.${type}`)} description={t(`newSubtitle.${type}`)} />
      <MovementForm
        companyId={companyId}
        data={data}
        canConfirm={can(ctx.membership, "inventory", "confirm")}
        initial={{
          type,
          date: toISODate(todayLocal()),
          warehouseId: defaultWh,
          toWarehouseId: data.warehouses.find((w) => w.id !== defaultWh)?.id ?? "",
          counterAccountId: cogs?.id ?? "",
          description: "",
          lines: [newMovementLine({ itemId: item })],
        }}
      />
    </div>
  );
}
