"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CompanyForm, type CompanyFormValues } from "@/components/common/company-form";
import { updateCompany } from "@/server/actions/companies";

export function CompanySettingsForm({
  companyId,
  defaultValues,
  readOnly,
}: {
  companyId: string;
  defaultValues: CompanyFormValues;
  readOnly: boolean;
}) {
  const tc = useTranslations("common");
  const router = useRouter();
  return (
    <CompanyForm
      defaultValues={defaultValues}
      readOnly={readOnly}
      submitLabel={tc("save")}
      onSubmit={(values) => updateCompany(companyId, values)}
      onSuccess={() => router.refresh()}
    />
  );
}
