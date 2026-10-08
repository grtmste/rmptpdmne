"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CompanyForm } from "@/components/common/company-form";
import { createCompany } from "@/server/actions/companies";

export function NewCompanyForm() {
  const t = useTranslations("companies");
  const router = useRouter();
  return (
    <CompanyForm
      submitLabel={t("create")}
      withStartDate
      onSubmit={(values) => createCompany(values)}
      onSuccess={(data) => router.push(`/c/${(data as { companyId: string }).companyId}`)}
    />
  );
}
