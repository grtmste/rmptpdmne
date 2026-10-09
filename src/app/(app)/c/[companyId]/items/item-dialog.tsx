"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { FormError, FormField } from "@/components/common/form-field";
import { GroupsDialog, type GroupRow } from "@/components/common/groups-dialog";
import { useActionRunner } from "@/components/common/use-action";
import { deleteItem, deleteItemGroup, saveItem, saveItemGroup } from "@/server/actions/items";

export type ItemValues = {
  code: string;
  name: string;
  nameEn: string;
  type: "GOODS" | "SERVICE";
  unit: string;
  salePrice: string;
  purchasePrice: string;
  vatRateId: string;
  salesAccountId: string;
  purchaseAccountId: string;
  groupId: string;
  forSales: boolean;
  forPurchases: boolean;
  trackStock: boolean;
  inventoryAccountId: string;
  cogsAccountId: string;
  description: string;
  active: boolean;
};

export type ItemOptions = {
  groups: Array<{ id: string; name: string }>;
  vatRates: Array<{ id: string; name: string }>;
  salesAccounts: Array<{ id: string; label: string }>;
  purchaseAccounts: Array<{ id: string; label: string }>;
  inventoryAccounts: Array<{ id: string; label: string }>;
  cogsAccounts: Array<{ id: string; label: string }>;
};

const EMPTY: ItemValues = {
  code: "",
  name: "",
  nameEn: "",
  type: "SERVICE",
  unit: "",
  salePrice: "",
  purchasePrice: "",
  vatRateId: "",
  salesAccountId: "",
  purchaseAccountId: "",
  groupId: "",
  forSales: true,
  forPurchases: true,
  trackStock: false,
  inventoryAccountId: "",
  cogsAccountId: "",
  description: "",
  active: true,
};

export const UNIT_SUGGESTIONS = ["tk", "h", "päev", "kuu", "km", "kg", "l", "m", "m²", "m³", "komplekt"];

export function ItemDialog({
  companyId,
  itemId,
  initial,
  options,
  readOnly,
  onSaved,
  trigger,
}: {
  companyId: string;
  itemId?: string;
  initial?: ItemValues;
  options: ItemOptions;
  readOnly?: boolean;
  onSaved?: (id: string, values: ItemValues) => void;
  trigger?: React.ReactNode;
}) {
  const t = useTranslations("items");
  const tc = useTranslations("common");
  const { pending, run } = useActionRunner();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<ItemValues>(initial ?? EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const set = <K extends keyof ItemValues>(k: K, value: ItemValues[K]) => setV((p) => ({ ...p, [k]: value }));
  const input = (k: keyof ItemValues, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <FormField label={label} htmlFor={`i-${k}`} errors={fieldErrors[k]}>
      <Input id={`i-${k}`} value={String(v[k])} onChange={(e) => set(k, e.target.value as never)} {...props} />
    </FormField>
  );
  const select = (k: keyof ItemValues, label: string, list: Array<{ id: string; label: string }>, empty = "—") => (
    <FormField label={label} htmlFor={`i-${k}`} errors={fieldErrors[k]}>
      <NativeSelect id={`i-${k}`} value={String(v[k])} onChange={(e) => set(k, e.target.value as never)}>
        <option value="">{empty}</option>
        {list.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    </FormField>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setV(initial ?? EMPTY);
          setError(null);
          setFieldErrors({});
        }
      }}
    >
      {trigger ? (
        <span onClick={() => setOpen(true)}>{trigger}</span>
      ) : itemId ? (
        <Button variant="ghost" size="icon-sm" aria-label={t("editNamed", { name: initial?.name ?? "" })} onClick={() => setOpen(true)}>
          <Pencil />
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus /> {t("new")}
        </Button>
      )}
      <DialogContent closeLabel={tc("close")} className="max-w-2xl" aria-describedby={undefined}>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            setFieldErrors({});
            run(() => saveItem(companyId, { ...v, trackStock: v.type === "GOODS" && v.trackStock, id: itemId }), {
              success: tc("saved"),
              onSuccess: (d) => {
                setOpen(false);
                onSaved?.(d.id, v);
              },
              onError: (res, msg) => {
                setFieldErrors(res.fieldErrors ?? {});
                setError(res.error === "validation" ? t("fixErrors") : msg);
              },
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{itemId ? t("editTitle") : t("newTitle")}</DialogTitle>
          </DialogHeader>
          <DialogBody className="max-h-[65vh] space-y-4 overflow-y-auto">
            <FormError message={error} />
            <fieldset disabled={readOnly || pending} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
                {input("code", t("code"), { autoFocus: true })}
                {input("name", t("name"))}
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField label={t("type")} htmlFor="i-type">
                  <NativeSelect id="i-type" value={v.type} onChange={(e) => set("type", e.target.value as ItemValues["type"])}>
                    <option value="SERVICE">{t("types.SERVICE")}</option>
                    <option value="GOODS">{t("types.GOODS")}</option>
                  </NativeSelect>
                </FormField>
                <FormField label={t("unit")} htmlFor="i-unit" errors={fieldErrors.unit}>
                  <Input id="i-unit" list="unit-suggestions" value={v.unit} onChange={(e) => set("unit", e.target.value)} />
                </FormField>
                <datalist id="unit-suggestions">
                  {UNIT_SUGGESTIONS.map((u) => (
                    <option key={u} value={u} />
                  ))}
                </datalist>
                {select("groupId", t("group"), options.groups.map((g) => ({ id: g.id, label: g.name })))}
                {input("salePrice", t("salePrice"), { inputMode: "decimal" })}
                {input("purchasePrice", t("purchasePrice"), { inputMode: "decimal" })}
                {select("vatRateId", t("vat"), options.vatRates.map((r) => ({ id: r.id, label: r.name })))}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {select("salesAccountId", t("salesAccount"), options.salesAccounts, t("defaultAccount"))}
                {select("purchaseAccountId", t("purchaseAccount"), options.purchaseAccounts, t("defaultAccount"))}
              </div>
              {v.type === "GOODS" && (
                <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                  <Checkbox label={t("trackStock")} checked={v.trackStock} onChange={(e) => set("trackStock", e.target.checked)} />
                  <p className="text-xs text-muted-foreground">{t("trackStockHint")}</p>
                  {v.trackStock && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      {select("inventoryAccountId", t("inventoryAccount"), options.inventoryAccounts, t("defaultAccount"))}
                      {select("cogsAccountId", t("cogsAccount"), options.cogsAccounts, t("defaultAccount"))}
                    </div>
                  )}
                </div>
              )}
              {input("nameEn", t("nameEn"))}
              {input("description", t("description"))}
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <Checkbox label={t("forSales")} checked={v.forSales} onChange={(e) => set("forSales", e.target.checked)} />
                <Checkbox label={t("forPurchases")} checked={v.forPurchases} onChange={(e) => set("forPurchases", e.target.checked)} />
                <Checkbox label={t("active")} checked={v.active} onChange={(e) => set("active", e.target.checked)} />
              </div>
            </fieldset>
          </DialogBody>
          {!readOnly && (
            <DialogFooter className="justify-between">
              {itemId ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive"
                  disabled={pending}
                  onClick={() =>
                    confirm(t("deleteConfirm", { name: v.name })) &&
                    run(() => deleteItem(companyId, { id: itemId }), {
                      onSuccess: (d) => {
                        setOpen(false);
                        if (d.deactivated) toast.info(t("deactivated"));
                      },
                    })
                  }
                >
                  <Trash2 /> {t("delete")}
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  {tc("cancel")}
                </Button>
                <Button type="submit" disabled={pending}>
                  {tc("save")}
                </Button>
              </div>
            </DialogFooter>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ItemGroups({ companyId, groups, canEdit }: { companyId: string; groups: GroupRow[]; canEdit: boolean }) {
  const t = useTranslations("items");
  return (
    <GroupsDialog
      title={t("groups")}
      groups={groups}
      canEdit={canEdit}
      save={(input) => saveItemGroup(companyId, input)}
      remove={(input) => deleteItemGroup(companyId, input)}
    />
  );
}
