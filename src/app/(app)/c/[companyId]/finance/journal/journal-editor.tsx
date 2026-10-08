"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { BookmarkPlus, ChevronDown, Columns3, FileStack, Plus, Scale, Trash2 } from "lucide-react";
import { BUILTIN_TEMPLATES } from "@/lib/accounting/builtin-templates";
import { dec, formatMoney, parseMoneyInput, sum } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/command";
import { FormError, FormField } from "@/components/common/form-field";
import { useActionRunner } from "@/components/common/use-action";
import { deleteJournalTemplate, postJournal, saveJournalDraft, saveJournalTemplate } from "@/server/actions/journal";

export type EditorAccount = {
  id: string;
  code: string;
  name: string;
  defaultVatRateId: string | null;
  requiresDepartment: boolean;
  requiredDimensionIds: string[];
};
export type EditorDimension = { id: string; name: string; values: Array<{ id: string; code: string; name: string }> };
export type EditorTemplate = {
  id: string;
  name: string;
  description: string | null;
  lines: Array<{ accountId: string; debit: string; credit: string; description: string }>;
};

export type EditorLine = {
  key: string;
  accountId: string;
  description: string;
  debit: string;
  credit: string;
  departmentId: string;
  vatRateId: string;
  vatAmount: string;
  dims: Record<string, string>;
};

let keySeq = 0;
const newKey = () => `l${Date.now().toString(36)}${(keySeq++).toString(36)}`;
export const emptyLine = (patch: Partial<EditorLine> = {}): EditorLine => ({
  key: newKey(),
  accountId: "",
  description: "",
  debit: "",
  credit: "",
  departmentId: "",
  vatRateId: "",
  vatAmount: "",
  dims: {},
  ...patch,
});

export function JournalEditor({
  companyId,
  entryId,
  initial,
  accounts,
  departments,
  dimensions,
  vatRates,
  templates,
  canPost,
}: {
  companyId: string;
  entryId?: string;
  initial: { date: string; description: string; lines: EditorLine[] };
  accounts: EditorAccount[];
  departments: Array<{ id: string; code: string; name: string }>;
  dimensions: EditorDimension[];
  vatRates: Array<{ id: string; code: string; name: string }>;
  templates: EditorTemplate[];
  canPost: boolean;
}) {
  const t = useTranslations("journal");
  const locale = useLocale();
  const router = useRouter();
  const { pending, run } = useActionRunner();
  const [date, setDate] = useState(initial.date);
  const [description, setDescription] = useState(initial.description);
  const [lines, setLines] = useState<EditorLine[]>(initial.lines.length ? initial.lines : [emptyLine(), emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [errorRow, setErrorRow] = useState<number | null>(null);
  const [showExtra, setShowExtra] = useState(
    () => initial.lines.some((l) => l.departmentId || l.vatRateId || Object.values(l.dims).some(Boolean)),
  );
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const accountOptions: ComboOption[] = useMemo(
    () => accounts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` })),
    [accounts],
  );
  const byCode = useMemo(() => new Map(accounts.map((a) => [a.code, a.id])), [accounts]);

  const parse = (s: string) => (s.trim() === "" ? dec(0) : parseMoneyInput(s));
  const totals = useMemo(() => {
    const debit = sum(lines.map((l) => parse(l.debit) ?? 0));
    const credit = sum(lines.map((l) => parse(l.credit) ?? 0));
    return { debit, credit, diff: debit.minus(credit) };
  }, [lines]);
  const balanced = totals.diff.isZero() && !totals.debit.isZero();
  const needsExtra = lines.some((l) => {
    const a = accountById.get(l.accountId);
    return a && (a.requiresDepartment || a.requiredDimensionIds.length > 0);
  });
  const extraVisible = showExtra || needsExtra;

  function update(key: string, patch: Partial<EditorLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  /** Uus rida, kuhu pakutakse tasakaalustav summa. */
  function addLine(focus = true) {
    const diff = totals.diff;
    const line = emptyLine(
      diff.isZero() ? {} : diff.isPositive() ? { credit: diff.toFixed(2) } : { debit: diff.negated().toFixed(2) },
    );
    setLines((prev) => [...prev, line]);
    if (focus) setTimeout(() => focusCell(line.key, "account"), 0);
  }

  function focusCell(key: string, col: string) {
    gridRef.current?.querySelector<HTMLInputElement>(`[data-row="${key}"][data-col="${col}"]`)?.focus();
  }

  function nextRow(key: string) {
    const idx = lines.findIndex((l) => l.key === key);
    const next = lines[idx + 1];
    if (next) focusCell(next.key, "account");
    else addLine();
  }

  function payload() {
    return {
      id: entryId,
      date,
      description,
      lines: lines.map((l) => ({
        accountId: l.accountId,
        debit: l.debit,
        credit: l.credit,
        description: l.description,
        departmentId: l.departmentId,
        vatRateId: l.vatRateId,
        vatAmount: l.vatAmount,
        dimensionValueIds: Object.values(l.dims).filter(Boolean),
      })),
    };
  }

  function onError(res: { errorParams?: Record<string, string | number> }, msg: string) {
    setError(msg);
    const row = res.errorParams?.row;
    setErrorRow(typeof row === "number" ? row - 1 : null);
  }

  function saveDraft() {
    setError(null);
    setErrorRow(null);
    run(() => saveJournalDraft(companyId, payload()), {
      success: t("draftSaved"),
      refresh: false,
      onSuccess: (d) => {
        if (!entryId) router.replace(`/c/${companyId}/finance/journal/${d.id}/edit`);
        else router.refresh();
      },
      onError,
    });
  }

  function post() {
    setError(null);
    setErrorRow(null);
    run(() => postJournal(companyId, payload()), {
      success: t("posted"),
      refresh: false,
      onSuccess: (d) => router.push(`/c/${companyId}/finance/journal?entry=${d.id}`),
      onError,
    });
  }

  function applyLines(next: EditorLine[]) {
    const hasContent = lines.some((l) => l.accountId || l.debit || l.credit);
    if (hasContent && !confirm(t("replaceLinesConfirm"))) return;
    setLines(next.length ? next : [emptyLine()]);
  }

  function applyBuiltin(id: string) {
    const tpl = BUILTIN_TEMPLATES.find((x) => x.id === id)!;
    const missing = tpl.lines.filter((l) => !byCode.get(l.account)).map((l) => l.account);
    applyLines(tpl.lines.map((l) => emptyLine({ accountId: byCode.get(l.account) ?? "" })));
    if (!description) setDescription(t(`builtin.${id}.name`));
    if (missing.length) toast.warning(t("templateMissingAccounts", { codes: missing.join(", ") }));
  }

  function applyCompanyTemplate(tpl: EditorTemplate) {
    applyLines(
      tpl.lines.map((l) =>
        emptyLine({ accountId: l.accountId, debit: l.debit, credit: l.credit, description: l.description }),
      ),
    );
    if (!description) setDescription(tpl.name);
  }

  return (
    <div
      className="space-y-4"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          saveDraft();
        } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canPost) {
          e.preventDefault();
          post();
        }
      }}
    >
      <Card>
        <CardContent className="grid gap-4 pt-5 sm:grid-cols-[180px_1fr_auto] sm:items-end">
          <FormField label={t("date")} htmlFor="entry-date">
            <Input id="entry-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </FormField>
          <FormField label={t("description")} htmlFor="entry-desc">
            <Input id="entry-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("descriptionPlaceholder")} />
          </FormField>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <FileStack /> {t("fromTemplate")} <ChevronDown className="opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-[60vh] w-80 overflow-y-auto">
              {templates.length > 0 && (
                <>
                  <DropdownMenuLabel>{t("companyTemplates")}</DropdownMenuLabel>
                  {templates.map((tpl) => (
                    <DropdownMenuItem key={tpl.id} onSelect={() => applyCompanyTemplate(tpl)} className="justify-between">
                      <span className="truncate">{tpl.name}</span>
                      <button
                        type="button"
                        className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                        aria-label={t("deleteTemplate", { name: tpl.name })}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (confirm(t("deleteTemplate", { name: tpl.name }) + "?")) {
                            run(() => deleteJournalTemplate(companyId, { id: tpl.id }), { success: t("templateDeleted") });
                          }
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuLabel>{t("builtinTemplates")}</DropdownMenuLabel>
              {BUILTIN_TEMPLATES.map((tpl) => (
                <DropdownMenuItem key={tpl.id} onSelect={() => applyBuiltin(tpl.id)} className="flex-col items-start gap-0">
                  <span>{t(`builtin.${tpl.id}.name`)}</span>
                  <span className="text-xs text-muted-foreground">{t(`builtin.${tpl.id}.hint`)}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </CardContent>
      </Card>

      <FormError message={error} />

      <Card>
        <div ref={gridRef} className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="w-8 px-2 py-2 text-right font-medium">#</th>
                <th className="min-w-64 px-2 py-2 text-left font-medium">{t("account")}</th>
                <th className="min-w-40 px-2 py-2 text-left font-medium">{t("lineDescription")}</th>
                <th className="w-32 px-2 py-2 text-right font-medium">{t("debit")}</th>
                <th className="w-32 px-2 py-2 text-right font-medium">{t("credit")}</th>
                {extraVisible && departments.length > 0 && <th className="w-36 px-2 py-2 text-left font-medium">{t("department")}</th>}
                {extraVisible &&
                  dimensions.map((d) => (
                    <th key={d.id} className="w-36 px-2 py-2 text-left font-medium">
                      {d.name}
                    </th>
                  ))}
                {extraVisible && <th className="w-36 px-2 py-2 text-left font-medium">{t("vat")}</th>}
                {extraVisible && <th className="w-28 px-2 py-2 text-right font-medium">{t("vatAmount")}</th>}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {lines.map((l, i) => {
                const account = accountById.get(l.accountId);
                const onAmountKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    nextRow(l.key);
                  }
                };
                return (
                  <tr key={l.key} className={cn("align-top", errorRow === i && "bg-destructive/5")}>
                    <td className="px-2 py-1.5 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</td>
                    <td className="px-2 py-1">
                      <Combobox
                        options={accountOptions}
                        value={l.accountId}
                        aria-label={`${t("account")} ${i + 1}`}
                        aria-invalid={errorRow === i || undefined}
                        placeholder={t("accountPlaceholder")}
                        noResults={t("noAccounts")}
                        onChange={(accountId) => {
                          const a = accountById.get(accountId);
                          update(l.key, {
                            accountId,
                            vatRateId: l.vatRateId || (a?.defaultVatRateId ?? ""),
                          });
                        }}
                        onCommit={() => focusCell(l.key, "description")}
                        ref={(el) => {
                          if (el) {
                            el.dataset.row = l.key;
                            el.dataset.col = "account";
                          }
                        }}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        data-row={l.key}
                        data-col="description"
                        className="h-8"
                        aria-label={`${t("lineDescription")} ${i + 1}`}
                        value={l.description}
                        onChange={(e) => update(l.key, { description: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            focusCell(l.key, l.credit ? "credit" : "debit");
                          }
                        }}
                      />
                    </td>
                    {(["debit", "credit"] as const).map((col) => (
                      <td key={col} className="px-2 py-1">
                        <Input
                          data-row={l.key}
                          data-col={col}
                          inputMode="decimal"
                          className={cn("h-8 text-right tabular-nums", l[col] && parse(l[col]) === null && "border-destructive")}
                          aria-label={`${t(col)} ${i + 1}`}
                          value={l[col]}
                          onChange={(e) =>
                            update(l.key, col === "debit" ? { debit: e.target.value, credit: e.target.value ? "" : l.credit } : { credit: e.target.value, debit: e.target.value ? "" : l.debit })
                          }
                          onKeyDown={onAmountKey}
                        />
                      </td>
                    ))}
                    {extraVisible && departments.length > 0 && (
                      <td className="px-2 py-1">
                        <select
                          aria-label={`${t("department")} ${i + 1}`}
                          className={cn(
                            "h-8 w-full rounded-md border border-input bg-card px-1.5 text-sm",
                            account?.requiresDepartment && !l.departmentId && "border-warning",
                          )}
                          value={l.departmentId}
                          onChange={(e) => update(l.key, { departmentId: e.target.value })}
                        >
                          <option value="">—</option>
                          {departments.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.code} {d.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    )}
                    {extraVisible &&
                      dimensions.map((d) => (
                        <td key={d.id} className="px-2 py-1">
                          <select
                            aria-label={`${d.name} ${i + 1}`}
                            className={cn(
                              "h-8 w-full rounded-md border border-input bg-card px-1.5 text-sm",
                              account?.requiredDimensionIds.includes(d.id) && !l.dims[d.id] && "border-warning",
                            )}
                            value={l.dims[d.id] ?? ""}
                            onChange={(e) => update(l.key, { dims: { ...l.dims, [d.id]: e.target.value } })}
                          >
                            <option value="">—</option>
                            {d.values.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.code} {v.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      ))}
                    {extraVisible && (
                      <td className="px-2 py-1">
                        <select
                          aria-label={`${t("vat")} ${i + 1}`}
                          className="h-8 w-full rounded-md border border-input bg-card px-1.5 text-sm"
                          value={l.vatRateId}
                          onChange={(e) => update(l.key, { vatRateId: e.target.value })}
                        >
                          <option value="">—</option>
                          {vatRates.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    )}
                    {extraVisible && (
                      <td className="px-2 py-1">
                        <Input
                          inputMode="decimal"
                          className="h-8 text-right tabular-nums"
                          aria-label={`${t("vatAmount")} ${i + 1}`}
                          disabled={!l.vatRateId}
                          value={l.vatAmount}
                          onChange={(e) => update(l.key, { vatAmount: e.target.value })}
                        />
                      </td>
                    )}
                    <td className="px-1 py-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("removeLine", { n: i + 1 })}
                        onClick={() => setLines((prev) => (prev.length > 1 ? prev.filter((x) => x.key !== l.key) : [emptyLine()]))}
                      >
                        <Trash2 />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => addLine()}>
            <Plus /> {t("addLine")}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowExtra((s) => !s)} disabled={needsExtra}>
            <Columns3 /> {extraVisible ? t("hideColumns") : t("showColumns")}
          </Button>
          <span className="ml-auto hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
            <Kbd>Enter</Kbd> {t("hintNextRow")} · <Kbd>Ctrl</Kbd>+<Kbd>S</Kbd> {t("hintSave")}
            {canPost && (
              <>
                {" "}
                · <Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd> {t("hintPost")}
              </>
            )}
          </span>
        </div>
      </Card>

      <div className="sticky bottom-16 z-10 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border bg-card/95 px-4 py-3 text-sm shadow-[0_-4px_12px_rgba(28,25,23,0.06)] backdrop-blur md:bottom-3">
        <span className="flex items-center gap-2 font-medium">
          <Scale className="size-4 text-muted-foreground" /> {t("totals")}
        </span>
        <span>
          {t("debit")}: <b className="tabular-nums">{formatMoney(totals.debit, locale)}</b>
        </span>
        <span>
          {t("credit")}: <b className="tabular-nums">{formatMoney(totals.credit, locale)}</b>
        </span>
        <span role="status" className={cn("font-medium", balanced ? "text-success" : "text-warning")}>
          {balanced ? t("balanced") : t("difference", { amount: formatMoney(totals.diff.abs(), locale) })}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button type="button" variant="ghost" onClick={() => setSaveTemplateOpen(true)} disabled={!lines.some((l) => l.accountId)}>
            <BookmarkPlus /> {t("saveAsTemplate")}
          </Button>
          <Button type="button" variant="outline" disabled={pending} onClick={saveDraft}>
            {t("saveDraft")}
          </Button>
          {canPost && (
            <Button type="button" disabled={pending || !balanced} onClick={post}>
              {t("post")}
            </Button>
          )}
        </div>
      </div>

      {saveTemplateOpen && (
        <SaveTemplateDialog
          defaultName={description}
          onClose={() => setSaveTemplateOpen(false)}
          onSave={(name, desc) =>
            run(
              () =>
                saveJournalTemplate(companyId, {
                  name,
                  description: desc,
                  lines: lines
                    .filter((l) => l.accountId)
                    .map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, description: l.description })),
                }),
              { success: t("templateSaved"), onSuccess: () => setSaveTemplateOpen(false) },
            )
          }
          pending={pending}
        />
      )}
    </div>
  );
}

function SaveTemplateDialog({
  defaultName,
  onClose,
  onSave,
  pending,
}: {
  defaultName: string;
  onClose: () => void;
  onSave: (name: string, description: string) => void;
  pending: boolean;
}) {
  const t = useTranslations("journal");
  const tc = useTranslations("common");
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={tc("close")} aria-describedby={undefined}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave(name, description);
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("saveAsTemplate")}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("templateHint")}</p>
            <FormField label={t("templateName")} htmlFor="tpl-name">
              <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
            </FormField>
            <FormField label={t("description")} htmlFor="tpl-desc">
              <Input id="tpl-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {tc("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
