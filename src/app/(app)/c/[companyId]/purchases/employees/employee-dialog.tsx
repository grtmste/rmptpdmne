"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FormError, FormField } from "@/components/common/form-field";
import { useActionRunner } from "@/components/common/use-action";
import { deleteEmployee, saveEmployee } from "@/server/actions/suppliers";

type Values = { name: string; personalCode: string; email: string; bankAccount: string; active: boolean };
const EMPTY: Values = { name: "", personalCode: "", email: "", bankAccount: "", active: true };

export function EmployeeDialog({ companyId, employeeId, initial }: { companyId: string; employeeId?: string; initial?: Values }) {
  const t = useTranslations("employees");
  const tc = useTranslations("common");
  const { pending, run } = useActionRunner();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<Values>(initial ?? EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const field = (k: Exclude<keyof Values, "active">, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <FormField label={label} htmlFor={`e-${k}`} errors={fieldErrors[k]}>
      <Input id={`e-${k}`} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} {...props} />
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
      {employeeId ? (
        <Button variant="ghost" size="icon-sm" aria-label={t("editNamed", { name: initial?.name ?? "" })} onClick={() => setOpen(true)}>
          <Pencil />
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus /> {t("new")}
        </Button>
      )}
      <DialogContent closeLabel={tc("close")} aria-describedby={undefined}>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            setFieldErrors({});
            run(() => saveEmployee(companyId, { ...v, id: employeeId }), {
              success: tc("saved"),
              onSuccess: () => setOpen(false),
              onError: (res, msg) => {
                setFieldErrors(res.fieldErrors ?? {});
                if (res.error !== "validation") setError(msg);
              },
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{employeeId ? t("editTitle") : t("newTitle")}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <FormError message={error} />
            {field("name", t("name"), { autoFocus: true })}
            <div className="grid gap-4 sm:grid-cols-2">
              {field("personalCode", t("personalCode"))}
              {field("email", t("email"), { type: "email" })}
            </div>
            {field("bankAccount", t("bankAccount"), { placeholder: "EE00 0000 0000 0000 0000" })}
            <Checkbox label={t("active")} checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />
          </DialogBody>
          <DialogFooter className="justify-between">
            {employeeId ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                disabled={pending}
                onClick={() => confirm(t("deleteConfirm", { name: v.name })) && run(() => deleteEmployee(companyId, { id: employeeId }), { onSuccess: () => setOpen(false) })}
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
              <Button type="submit" disabled={pending || !v.name.trim()}>
                {tc("save")}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
