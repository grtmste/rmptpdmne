import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/session";
import { canCreateCompany } from "@/server/queries/companies";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { NewCompanyForm } from "./new-company-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("companies");
  return { title: t("newTitle") };
}

export default async function NewCompanyPage() {
  const user = await requireUser();
  if (!(await canCreateCompany(user.id))) redirect("/companies");
  const t = await getTranslations("companies");
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t("newTitle")} description={t("newSubtitle")} />
      <Card>
        <CardContent className="pt-5">
          <NewCompanyForm />
        </CardContent>
      </Card>
    </div>
  );
}
