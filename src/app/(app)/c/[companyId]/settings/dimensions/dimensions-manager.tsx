"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Building, Pencil, Plus, Tags } from "lucide-react";
import { formatDate } from "@/lib/dates";
import { parseISODate } from "@/lib/accounting/dates";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/lib/action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FormError, FormField } from "@/components/common/form-field";
import { useActionRunner } from "@/components/common/use-action";
import {
  deleteDepartment,
  deleteDimension,
  deleteDimensionValue,
  saveDepartment,
  saveDimension,
  saveDimensionValue,
} from "@/server/actions/settings/dimensions";

export type DepartmentRow = { id: string; code: string; name: string; active: boolean };
export type ValueRow = { id: string; code: string; name: string; endDate: string; active: boolean };
export type DimensionRow = {
  id: string;
  name: string;
  kind: "DETAIL" | "SUMMARY";
  parentId: string;
  debitPositive: boolean;
  active: boolean;
  values: ValueRow[];
};

type Editing =
  | { type: "department"; row: DepartmentRow | null }
  | { type: "dimension"; row: DimensionRow | null }
  | { type: "value"; dimension: DimensionRow; row: ValueRow | null };

export function DimensionsManager({
  companyId,
  departments,
  dimensions,
  canEdit,
}: {
  companyId: string;
  departments: DepartmentRow[];
  dimensions: DimensionRow[];
  canEdit: boolean;
}) {
  const t = useTranslations("dimensions");
  const locale = useLocale();
  const [editing, setEditing] = useState<Editing | null>(null);
  const close = () => setEditing(null);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Building className="size-4 text-muted-foreground" /> {t("departments")}
            </CardTitle>
            <CardDescription>{t("departmentsBody")}</CardDescription>
          </div>
          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => setEditing({ type: "department", row: null })}>
              <Plus /> {t("addDepartment")}
            </Button>
          )}
        </CardHeader>
        <CardContent className={departments.length ? "px-0 pb-0" : undefined}>
          {departments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noDepartments")}</p>
          ) : (
            <SimpleList
              rows={departments.map((d) => ({ ...d, extra: null }))}
              onEdit={canEdit ? (row) => setEditing({ type: "department", row: departments.find((d) => d.id === row.id)! }) : undefined}
            />
          )}
        </CardContent>
      </Card>

      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Tags className="size-4 text-muted-foreground" /> {t("dimensions")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("dimensionsBody")}</p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => setEditing({ type: "dimension", row: null })}>
            <Plus /> {t("addDimension")}
          </Button>
        )}
      </div>

      {dimensions.map((dim) => (
        <Card key={dim.id} className={cn(!dim.active && "opacity-60")}>
          <CardHeader>
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                {dim.name}
                <Badge variant="outline">{t(`kinds.${dim.kind}`)}</Badge>
                {!dim.active && <Badge variant="outline">{t("inactive")}</Badge>}
              </CardTitle>
              <CardDescription>
                {dim.kind === "SUMMARY"
                  ? t("summaryHint", { list: dimensions.filter((d) => d.parentId === dim.id).map((d) => d.name).join(", ") || "—" })
                  : dim.debitPositive
                    ? t("debitPositive")
                    : t("creditPositive")}
              </CardDescription>
            </div>
            {canEdit && (
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing({ type: "dimension", row: dim })}>
                  <Pencil /> {t("editDimension")}
                </Button>
                {dim.kind === "DETAIL" && (
                  <Button size="sm" variant="outline" onClick={() => setEditing({ type: "value", dimension: dim, row: null })}>
                    <Plus /> {t("addValue")}
                  </Button>
                )}
              </div>
            )}
          </CardHeader>
          {dim.kind === "DETAIL" && (
            <CardContent className={dim.values.length ? "px-0 pb-0" : undefined}>
              {dim.values.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noValues")}</p>
              ) : (
                <SimpleList
                  rows={dim.values.map((v) => ({
                    ...v,
                    extra: v.endDate ? t("ends", { date: formatDate(parseISODate(v.endDate)!, locale) }) : null,
                  }))}
                  onEdit={canEdit ? (row) => setEditing({ type: "value", dimension: dim, row: dim.values.find((v) => v.id === row.id)! }) : undefined}
                />
              )}
            </CardContent>
          )}
        </Card>
      ))}

      {editing?.type === "department" && (
        <CodeNameDialog
          title={editing.row ? t("editDepartment") : t("addDepartment")}
          initial={editing.row ? { ...editing.row, endDate: "" } : { code: "", name: "", active: true, endDate: "" }}
          onClose={close}
          onSave={(v) => saveDepartment(companyId, { id: editing.row?.id, code: v.code, name: v.name, active: v.active })}
          onDelete={editing.row ? () => deleteDepartment(companyId, { id: editing.row!.id }) : undefined}
        />
      )}
      {editing?.type === "value" && (
        <CodeNameDialog
          title={`${editing.dimension.name}: ${editing.row ? t("editValue") : t("addValue")}`}
          initial={editing.row ?? { code: "", name: "", active: true, endDate: "" }}
          withEndDate
          onClose={close}
          onSave={(v) =>
            saveDimensionValue(companyId, {
              id: editing.row?.id,
              dimensionId: editing.dimension.id,
              code: v.code,
              name: v.name,
              endDate: v.endDate,
              active: v.active,
            })
          }
          onDelete={editing.row ? () => deleteDimensionValue(companyId, { id: editing.row!.id }) : undefined}
        />
      )}
      {editing?.type === "dimension" && (
        <DimensionDialog companyId={companyId} dimension={editing.row} all={dimensions} onClose={close} />
      )}
    </div>
  );
}

function SimpleList({
  rows,
  onEdit,
}: {
  rows: Array<{ id: string; code: string; name: string; active: boolean; extra: string | null }>;
  onEdit?: (row: { id: string }) => void;
}) {
  const t = useTranslations("dimensions");
  return (
    <Table>
      <THead>
        <tr>
          <TH className="w-40 pl-5">{t("code")}</TH>
          <TH>{t("name")}</TH>
          <TH className="w-48" />
        </tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR
            key={r.id}
            className={cn(onEdit && "cursor-pointer", !r.active && "opacity-55")}
            onClick={() => onEdit?.(r)}
            tabIndex={onEdit ? 0 : undefined}
            onKeyDown={(e) => e.key === "Enter" && onEdit?.(r)}
          >
            <TD className="pl-5 font-mono text-[13px]">{r.code}</TD>
            <TD>{r.name}</TD>
            <TD className="text-right text-xs text-muted-foreground">
              {r.extra}
              {!r.active && (
                <Badge variant="outline" className="ml-2">
                  {t("inactive")}
                </Badge>
              )}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

type CodeName = { code: string; name: string; active: boolean; endDate: string };

function CodeNameDialog({
  title,
  initial,
  withEndDate,
  onClose,
  onSave,
  onDelete,
}: {
  title: string;
  initial: CodeName;
  withEndDate?: boolean;
  onClose: () => void;
  onSave: (v: CodeName) => Promise<ActionResult<unknown>>;
  onDelete?: () => Promise<ActionResult<unknown>>;
}) {
  const t = useTranslations("dimensions");
  const tc = useTranslations("common");
  const { pending, run } = useActionRunner();
  const [v, setV] = useState<CodeName>({ ...initial, endDate: initial.endDate ?? "" });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={tc("close")} aria-describedby={undefined}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            setFieldErrors({});
            run(() => onSave(v), {
              success: tc("saved"),
              onSuccess: onClose,
              onError: (res, msg) => {
                setFieldErrors(res.fieldErrors ?? {});
                if (res.error !== "validation") setError(msg);
              },
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <FormError message={error} />
            <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
              <FormField label={t("code")} htmlFor="code" errors={fieldErrors.code}>
                <Input id="code" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} autoFocus />
              </FormField>
              <FormField label={t("name")} htmlFor="name" errors={fieldErrors.name}>
                <Input id="name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
              </FormField>
            </div>
            {withEndDate && (
              <FormField label={t("endDate")} htmlFor="endDate" hint={t("endDateHint")} className="sm:w-56">
                <Input id="endDate" type="date" value={v.endDate} onChange={(e) => setV({ ...v, endDate: e.target.value })} />
              </FormField>
            )}
            <Checkbox label={t("active")} checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />
          </DialogBody>
          <DialogFooter className="justify-between">
            <div>
              {onDelete && (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive"
                  disabled={pending}
                  onClick={() => confirm(t("deleteConfirm")) && run(onDelete, { success: t("deleted"), onSuccess: onClose })}
                >
                  {tc("delete")}
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? tc("saving") : tc("save")}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DimensionDialog({
  companyId,
  dimension,
  all,
  onClose,
}: {
  companyId: string;
  dimension: DimensionRow | null;
  all: DimensionRow[];
  onClose: () => void;
}) {
  const t = useTranslations("dimensions");
  const tc = useTranslations("common");
  const { pending, run } = useActionRunner();
  const [v, setV] = useState({
    name: dimension?.name ?? "",
    kind: dimension?.kind ?? ("DETAIL" as const),
    parentId: dimension?.parentId ?? "",
    debitPositive: dimension?.debitPositive ?? false,
    active: dimension?.active ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const parents = all.filter((d) => d.kind === "SUMMARY" && d.id !== dimension?.id);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={tc("close")} aria-describedby={undefined}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            run(() => saveDimension(companyId, { id: dimension?.id, ...v }), {
              success: tc("saved"),
              onSuccess: onClose,
              onError: (_res, msg) => setError(msg),
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{dimension ? t("editDimension") : t("addDimension")}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <FormError message={error} />
            <FormField label={t("name")} htmlFor="dim-name">
              <Input id="dim-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoFocus />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t("kind")} htmlFor="dim-kind" hint={t(`kindHints.${v.kind}`)}>
                <NativeSelect
                  id="dim-kind"
                  value={v.kind}
                  onChange={(e) => setV({ ...v, kind: e.target.value as "DETAIL" | "SUMMARY", parentId: "" })}
                >
                  <option value="DETAIL">{t("kinds.DETAIL")}</option>
                  <option value="SUMMARY">{t("kinds.SUMMARY")}</option>
                </NativeSelect>
              </FormField>
              {v.kind === "DETAIL" && (
                <FormField label={t("parent")} htmlFor="dim-parent">
                  <NativeSelect id="dim-parent" value={v.parentId} onChange={(e) => setV({ ...v, parentId: e.target.value })}>
                    <option value="">—</option>
                    {parents.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
              )}
            </div>
            {v.kind === "DETAIL" && (
              <Checkbox
                label={t("debitPositiveLabel")}
                description={t("debitPositiveHint")}
                checked={v.debitPositive}
                onChange={(e) => setV({ ...v, debitPositive: e.target.checked })}
              />
            )}
            <Checkbox label={t("active")} checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />
          </DialogBody>
          <DialogFooter className="justify-between">
            <div>
              {dimension && (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive"
                  disabled={pending}
                  onClick={() =>
                    confirm(t("deleteDimensionConfirm", { name: dimension.name })) &&
                    run(() => deleteDimension(companyId, { id: dimension.id }), { success: t("deleted"), onSuccess: onClose })
                  }
                >
                  {tc("delete")}
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? tc("saving") : tc("save")}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
