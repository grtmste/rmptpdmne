import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
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
  const editable = can(ctx.membership, "settings", "edit");

  return (
    <div className="mx-auto max-w-3xl">
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
              name: ctx.company.name,
              regCode: ctx.company.regCode ?? "",
              vatNumber: ctx.company.vatNumber ?? "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
