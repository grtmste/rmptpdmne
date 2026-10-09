"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Layers, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { FormError, FormField } from "@/components/common/form-field";
import { useActionRunner } from "@/components/common/use-action";
import { deleteAssetGroup, saveAssetGroup } from "@/server/actions/assets";

export type AssetGroupRow = { id: string; name: string; assetAccountId: string; accumulatedAccountId: string; expenseAccountId: string; usefulLifeMonths: number | null; count: number };

type Values = { name: string; assetAccountId: string; accumulatedAccountId: string; expenseAccountId: string; usefulLifeMonths: string };

/** Põhivara gruppide haldus: nimi, kontod ja vaikimisi kasulik eluiga. */
export function AssetGroupsDialog({
  companyId,
  groups,
  accounts,
  canEdit,
}: {
  companyId: string;
  groups: AssetGroupRow[];
  accounts: Array<{ id: string; code: string; name: string; type: string }>;
  canEdit: boolean;
}) {
  const t = useTranslations("assets");
  const tc = useTranslations("common");
  const { pending, run } = useActionRunner();
  const [editing, setEditing] = useState<{ id?: string; v: Values } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const label = new Map(accounts.map((a) => [a.id, a.code]));
  const blank: Values = {
    name: "",
    assetAccountId: accounts.find((a) => a.code === "1720")?.id ?? "",
    accumulatedAccountId: accounts.find((a) => a.code === "1790")?.id ?? "",
    expenseAccountId: accounts.find((a) => a.code === "4300")?.id ?? "",
    usefulLifeMonths: "60",
  };
  const select = (k: "assetAccountId" | "accumulatedAccountId" | "expenseAccountId", text: string, type: string) => (
    <FormField label={text} htmlFor={`g-${k}`}>
      <NativeSelect id={`g-${k}`} value={editing!.v[k]} onChange={(e) => setEditing({ ...editing!, v: { ...editing!.v, [k]: e.target.value } })}>
        {accounts
          .filter((a) => a.type === type)
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} {a.name}
            </option>
          ))}
      </NativeSelect>
    </FormField>
  );

  return (
    <Dialog onOpenChange={() => setEditing(null)}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Layers /> {t("groups")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc("close")} className="max-w-2xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("groups")}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {editing ? (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                run(() => saveAssetGroup(companyId, { id: editing.id, ...editing.v }), { success: tc("saved"), onSuccess: () => setEditing(null), onError: (_, msg) => setError(msg) });
              }}
            >
              <FormError message={error} />
              <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
                <FormField label={t("groupName")} htmlFor="g-name">
                  <Input id="g-name" value={editing.v.name} onChange={(e) => setEditing({ ...editing, v: { ...editing.v, name: e.target.value } })} autoFocus />
                </FormField>
                <FormField label={t("usefulLife")} htmlFor="g-life">
                  <Input id="g-life" inputMode="numeric" value={editing.v.usefulLifeMonths} onChange={(e) => setEditing({ ...editing, v: { ...editing.v, usefulLifeMonths: e.target.value } })} />
                </FormField>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                {select("assetAccountId", t("assetAccount"), "ASSET")}
                {select("accumulatedAccountId", t("accumulatedAccount"), "ASSET")}
                {select("expenseAccountId", t("expenseAccount"), "EXPENSE")}
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                  {tc("cancel")}
                </Button>
                <Button type="submit" disabled={pending}>
                  {tc("save")}
                </Button>
              </div>
            </form>
          ) : (
            <>
              <ul className="divide-y rounded-md border">
                {groups.map((g) => (
                  <li key={g.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{g.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {label.get(g.assetAccountId)} / {label.get(g.accumulatedAccountId)} / {label.get(g.expenseAccountId)}
                        {g.usefulLifeMonths ? ` · ${t("monthsShort", { months: g.usefulLifeMonths })}` : ""} · {t("assetCount", { count: g.count })}
                      </div>
                    </div>
                    {canEdit && (
                      <>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t("editGroupNamed", { name: g.name })}
                          onClick={() =>
                            setEditing({
                              id: g.id,
                              v: { name: g.name, assetAccountId: g.assetAccountId, accumulatedAccountId: g.accumulatedAccountId, expenseAccountId: g.expenseAccountId, usefulLifeMonths: g.usefulLifeMonths ? String(g.usefulLifeMonths) : "" },
                            })
                          }
                        >
                          <Pencil />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          disabled={pending || g.count > 0}
                          aria-label={t("deleteGroupNamed", { name: g.name })}
                          onClick={() => confirm(t("deleteGroupConfirm", { name: g.name })) && run(() => deleteAssetGroup(companyId, { id: g.id }))}
                        >
                          <Trash2 />
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              {canEdit && (
                <Button variant="outline" onClick={() => setEditing({ v: blank })}>
                  <Plus /> {t("newGroup")}
                </Button>
              )}
            </>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
