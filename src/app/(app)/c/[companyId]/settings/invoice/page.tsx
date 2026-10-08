import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { InvoiceSettingsForm } from "./invoice-settings-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.settings.invoice") };
}

export default async function InvoiceSettingsPage({ params }: PageProps<"/c/[companyId]/settings/invoice">) {
  const { companyId } = await params;
  const ctx = await requireCompany(companyId, "settings");
  const t = await getTranslations("invoiceSettings");
  const tn = await getTranslations("nav");
  const c = await ctx.cdb.company.findFirstOrThrow({
    select: { paymentTermDays: true, lateInterestPct: true, invoiceBankDetails: true, invoiceFooter: true, invoiceNote: true, invoiceAccent: true },
  });
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title={tn("items.settings.invoice")} description={t("subtitle")} />
      <Card>
        <CardHeader>
          <div className="space-y-1">
            <CardTitle>{t("cardTitle")}</CardTitle>
            <CardDescription>{t("cardBody")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <InvoiceSettingsForm
            companyId={companyId}
            readOnly={!can(ctx.membership, "settings", "edit")}
            initial={{
              paymentTermDays: String(c.paymentTermDays),
              lateInterestPct: c.lateInterestPct.toString(),
              invoiceBankDetails: c.invoiceBankDetails ?? "",
              invoiceFooter: c.invoiceFooter ?? "",
              invoiceNote: c.invoiceNote ?? "",
              invoiceAccent: c.invoiceAccent,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
