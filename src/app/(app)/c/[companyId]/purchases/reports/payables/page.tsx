import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireCompany } from "@/server/session";
import { DebtsPage } from "@/components/reports/debts-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.purchases.reportPayables") };
}

export default async function PayablesPage({ params, searchParams }: PageProps<"/c/[companyId]/purchases/reports/payables">) {
  const { companyId } = await params;
  await requireCompany(companyId, "reports");
  const tn = await getTranslations("nav");
  return <DebtsPage companyId={companyId} side="payables" sp={await searchParams} title={tn("items.purchases.reportPayables")} />;
}
