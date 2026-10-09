"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FormError, FormField } from "@/components/common/form-field";
import { useActionRunner } from "@/components/common/use-action";
import { deleteWarehouse, saveWarehouse } from "@/server/actions/inventory";

export type WarehouseValues = { code: string; name: string; address: string; isDefault: boolean; active: boolean };

const EMPTY: WarehouseValues = { code: "", name: "", address: "", isDefault: false, active: true };

export function WarehouseDialog({ companyId, warehouseId, initial }: { companyId: string; warehouseId?: string; initial?: WarehouseValues }) {
  const t = useTranslations("inventory");
  const tc = useTranslations("common");
  const { pending, run } = useActionRunner();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<WarehouseValues>(initial ?? EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const set = <K extends keyof WarehouseValues>(k: K, value: WarehouseValues[K]) => setV((p) => ({ ...p, [k]: value }));

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
      {warehouseId ? (
        <Button variant="ghost" size="icon-sm" aria-label={t("editWarehouseNamed", { name: initial?.name ?? "" })} onClick={() => setOpen(true)}>
          <Pencil />
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus /> {t("newWarehouse")}
        </Button>
      )}
      <DialogContent closeLabel={tc("close")} aria-describedby={undefined}>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            setFieldErrors({});
            run(() => saveWarehouse(companyId, { ...v, id: warehouseId }), {
              success: tc("saved"),
              onSuccess: () => setOpen(false),
              onError: (res, msg) => {
                setFieldErrors(res.fieldErrors ?? {});
                setError(msg);
              },
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{warehouseId ? t("editWarehouse") : t("newWarehouse")}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <FormError message={error} />
            <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
              <FormField label={t("warehouseCode")} htmlFor="w-code" errors={fieldErrors.code}>
                <Input id="w-code" value={v.code} onChange={(e) => set("code", e.target.value)} autoFocus />
              </FormField>
              <FormField label={t("warehouseName")} htmlFor="w-name" errors={fieldErrors.name}>
                <Input id="w-name" value={v.name} onChange={(e) => set("name", e.target.value)} />
              </FormField>
            </div>
            <FormField label={t("warehouseAddress")} htmlFor="w-address" errors={fieldErrors.address}>
              <Input id="w-address" value={v.address} onChange={(e) => set("address", e.target.value)} />
            </FormField>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Checkbox label={t("isDefault")} checked={v.isDefault} onChange={(e) => set("isDefault", e.target.checked)} />
              <Checkbox label={t("active")} checked={v.active} onChange={(e) => set("active", e.target.checked)} />
            </div>
          </DialogBody>
          <DialogFooter className="justify-between">
            {warehouseId ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                disabled={pending}
                onClick={() =>
                  confirm(t("deleteWarehouseConfirm", { name: v.name })) &&
                  run(() => deleteWarehouse(companyId, { id: warehouseId }), {
                    onSuccess: (d) => {
                      setOpen(false);
                      if (d.deactivated) toast.info(t("warehouseDeactivated"));
                    },
                  })
                }
              >
                <Trash2 /> {tc("delete")}
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
        </form>
      </DialogContent>
    </Dialog>
  );
}
