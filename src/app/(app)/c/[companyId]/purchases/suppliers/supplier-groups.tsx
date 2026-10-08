"use client";

import { useTranslations } from "next-intl";
import { GroupsDialog, type GroupRow } from "@/components/common/groups-dialog";
import { deleteSupplierGroup, saveSupplierGroup } from "@/server/actions/suppliers";

export function SupplierGroups({ companyId, groups, canEdit }: { companyId: string; groups: GroupRow[]; canEdit: boolean }) {
  const t = useTranslations("suppliers");
  return (
    <GroupsDialog
      title={t("groups")}
      groups={groups}
      canEdit={canEdit}
      save={(input) => saveSupplierGroup(companyId, input)}
      remove={(input) => deleteSupplierGroup(companyId, input)}
    />
  );
}
