"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarRange, Lock, LockOpen, Plus } from "lucide-react";
import { formatDate } from "@/lib/dates";
import { parseISODate } from "@/lib/accounting/dates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FormError, FormField } from "@/components/common/form-field";
import { useActionRunner } from "@/components/common/use-action";
import { deleteFiscalYear, saveFiscalYear, setFiscalYearClosed, setLockDate } from "@/server/actions/settings/fiscal";

export type YearRow = { id: string; startDate: string; endDate: string; closed: boolean; entries: number };

export function FiscalYearsManager({
  companyId,
  years,
  lockedUntil,
  suggestion,
  canEdit,
}: {
  companyId: string;
  years: YearRow[];
  lockedUntil: string;
  suggestion: { startDate: string; endDate: string } | null;
  canEdit: boolean;
}) {
  const t = useTranslations("fiscal");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { pending, run } = useActionRunner();
  const [editing, setEditing] = useState<YearRow | "new" | null>(null);
  const [lock, setLock] = useState(lockedUntil);
  const fmt = (iso: string) => formatDate(parseISODate(iso)!, locale);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="space-y-1">
            <CardTitle>{t("yearsTitle")}</CardTitle>
            <CardDescription>{t("yearsBody")}</CardDescription>
          </div>
          {canEdit && (
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus /> {t("add")}
            </Button>
          )}
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <THead>
              <tr>
                <TH className="pl-5">{t("period")}</TH>
                <TH className="text-right">{t("entries")}</TH>
                <TH>{t("status")}</TH>
                <TH className="w-48" />
              </tr>
            </THead>
            <TBody>
              {years.map((y) => (
                <TR key={y.id}>
                  <TD className="pl-5 font-medium">
                    <span className="flex items-center gap-2">
                      <CalendarRange className="size-4 text-muted-foreground" />
                      {fmt(y.startDate)} – {fmt(y.endDate)}
                    </span>
                  </TD>
                  <TD className="num">{y.entries}</TD>
                  <TD>{y.closed ? <Badge variant="secondary">{t("closed")}</Badge> : <Badge variant="success">{t("open")}</Badge>}</TD>
                  <TD>
                    {canEdit && (
                      <div className="flex justify-end gap-1">
                        {!y.closed && (
                          <Button variant="ghost" size="sm" onClick={() => setEditing(y)}>
                            {tc("edit")}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() => {
                            if (confirm(y.closed ? t("reopenConfirm") : t("closeConfirm"))) {
                              run(() => setFiscalYearClosed(companyId, { id: y.id, closed: !y.closed }), {
                                success: y.closed ? t("reopened") : t("closedDone"),
                              });
                            }
                          }}
                        >
                          {y.closed ? <LockOpen /> : <Lock />} {y.closed ? t("reopen") : t("close")}
                        </Button>
                      </div>
                    )}
                  </TD>
                </TR>
              ))}
              {years.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                    {t("none")}
                  </td>
                </tr>
              )}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="space-y-1">
            <CardTitle>{t("lockTitle")}</CardTitle>
            <CardDescription>{t("lockBody")}</CardDescription>
          </div>
          <Lock className="size-5 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => setLockDate(companyId, { lockedUntil: lock }), { success: tc("saved") });
            }}
          >
            <FormField label={t("lockedUntil")} htmlFor="lockedUntil" className="w-56">
              <Input id="lockedUntil" type="date" value={lock} disabled={!canEdit} onChange={(e) => setLock(e.target.value)} />
            </FormField>
            {canEdit && (
              <>
                <Button type="submit" disabled={pending}>
                  {tc("save")}
                </Button>
                {lock && (
                  <Button type="button" variant="ghost" disabled={pending} onClick={() => setLock("")}>
                    {t("unlock")}
                  </Button>
                )}
              </>
            )}
          </form>
          <p className="mt-3 text-xs text-muted-foreground">{lockedUntil ? t("lockedNow", { date: fmt(lockedUntil) }) : t("notLocked")}</p>
        </CardContent>
      </Card>

      {editing && (
        <YearDialog
          companyId={companyId}
          year={editing === "new" ? null : editing}
          suggestion={suggestion}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function YearDialog({
  companyId,
  year,
  suggestion,
  onClose,
}: {
  companyId: string;
  year: YearRow | null;
  suggestion: { startDate: string; endDate: string } | null;
  onClose: () => void;
}) {
  const t = useTranslations("fiscal");
  const tc = useTranslations("common");
  const { pending, run } = useActionRunner();
  const [startDate, setStart] = useState(year?.startDate ?? suggestion?.startDate ?? "");
  const [endDate, setEnd] = useState(year?.endDate ?? suggestion?.endDate ?? "");
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={tc("close")} aria-describedby={undefined}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            run(() => saveFiscalYear(companyId, { id: year?.id, startDate, endDate }), {
              success: tc("saved"),
              onSuccess: onClose,
              onError: (_res, msg) => setError(msg),
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{year ? t("editTitle") : t("newTitle")}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <FormError message={error} />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t("startDate")} htmlFor="startDate">
                <Input id="startDate" type="date" value={startDate} onChange={(e) => setStart(e.target.value)} required />
              </FormField>
              <FormField label={t("endDate")} htmlFor="endDate">
                <Input id="endDate" type="date" value={endDate} onChange={(e) => setEnd(e.target.value)} required />
              </FormField>
            </div>
            <p className="text-xs text-muted-foreground">{t("lengthHint")}</p>
          </DialogBody>
          <DialogFooter className="justify-between">
            <div>
              {year && year.entries === 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive"
                  disabled={pending}
                  onClick={() => {
                    if (confirm(t("deleteConfirm"))) {
                      run(() => deleteFiscalYear(companyId, { id: year.id }), { success: t("deleted"), onSuccess: onClose });
                    }
                  }}
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
