"use client";

import { GroupsDialog, type GroupRow } from "@/components/common/groups-dialog";
import type { ActionResult } from "@/lib/action";

/** Asukohtade haldus (sama dialoog nagu gruppidel). */
export function LocationsDialog(props: {
  title: string;
  groups: GroupRow[];
  canEdit: boolean;
  save: (input: { id?: string; name: string }) => Promise<ActionResult<unknown>>;
  remove: (input: { id: string }) => Promise<ActionResult<unknown>>;
}) {
  return <GroupsDialog {...props} />;
}
