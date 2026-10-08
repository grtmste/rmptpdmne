import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { isLocale } from "@/i18n/config";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { CompanySettingsForm } from "./company-settings-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.settings.company") };
}

export default async function CompanySettingsPage({ params }: PageProps<"/c/[companyId]/settings/company">) {
  const { companyId } = await params;
  const ctx = await requireCompany(companyId, "settings");
  const t = await getTranslations("companies");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const editable = can(ctx.membership, "settings", "edit");
  const c = await ctx.cdb.company.findFirstOrThrow();

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title={tn("items.settings.company")} description={t("settingsSubtitle")} />
      <Card>
        <CardHeader>
          <div className="space-y-1">
            <CardTitle>{t("basicData")}</CardTitle>
            <CardDescription>{editable ? t("basicDataBody") : t("readOnly")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <CompanySettingsForm
            companyId={companyId}
            readOnly={!editable}
            defaultValues={{
              name: c.name,
              regCode: c.regCode ?? "",
              vatNumber: c.vatNumber ?? "",
              addressStreet: c.addressStreet ?? "",
              addressCity: c.addressCity ?? "",
              addressCounty: c.addressCounty ?? "",
              addressPostalCode: c.addressPostalCode ?? "",
              phone: c.phone ?? "",
              email: c.email ?? "",
              website: c.website ?? "",
              documentLocale: isLocale(c.documentLocale) ? c.documentLocale : "et",
            }}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="space-y-1">
            <CardTitle>{t("accountingSetup")}</CardTitle>
            <CardDescription>{t("accountingSetupBody")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{t("type")}</dt>
              <dd className="font-medium">{t(`types.${c.type}`)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("incomeStatementScheme")}</dt>
              <dd className="font-medium">{t("scheme", { n: c.incomeStatementScheme })}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("accountingStart")}</dt>
              <dd className="font-medium">{c.accountingStartDate ? formatDate(c.accountingStartDate, locale) : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("baseCurrency")}</dt>
              <dd className="font-medium">{c.baseCurrency}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
