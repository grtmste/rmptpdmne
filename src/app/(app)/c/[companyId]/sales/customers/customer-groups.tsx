"use client";

import { useTranslations } from "next-intl";
import { GroupsDialog, type GroupRow } from "@/components/common/groups-dialog";
import { deleteCustomerGroup, saveCustomerGroup } from "@/server/actions/customers";

export function CustomerGroups({ companyId, groups, canEdit }: { companyId: string; groups: GroupRow[]; canEdit: boolean }) {
  const t = useTranslations("customers");
  return (
    <GroupsDialog
      title={t("groups")}
      groups={groups}
      canEdit={canEdit}
      save={(input) => saveCustomerGroup(companyId, input)}
      remove={(input) => deleteCustomerGroup(companyId, input)}
    />
  );
}
