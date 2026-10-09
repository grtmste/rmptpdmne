"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ListPlus, Plus, Trash2 } from "lucide-react";
import { dec, formatMoney, formatQuantity, parseMoneyInput } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { FormError, FormField } from "@/components/common/form-field";
import { useActionRunner } from "@/components/common/use-action";
import { confirmMovementAction, loadBookQuantities, saveMovementAction } from "@/server/actions/inventory";
import { newMovementLine, type MovementLine } from "./movement-line";

export type MovementType = "RECEIPT" | "ISSUE" | "TRANSFER" | "COUNT";

export type MovementFormData = {
  warehouses: Array<{ id: string; name: string }>;
  items: Array<{ id: string; code: string; name: string; unit: string | null }>;
  accounts: Array<{ id: string; code: string; name: string }>;
};

export type MovementValues = {
  type: MovementType;
  date: string;
  warehouseId: string;
  toWarehouseId: string;
  counterAccountId: string;
  description: string;
  lines: MovementLine[];
};

export function MovementForm({
  companyId,
  movementId,
  initial,
  data,
  canConfirm,
}: {
  companyId: string;
  movementId?: string;
  initial: MovementValues;
  data: MovementFormData;
  canConfirm: boolean;
}) {
  const t = useTranslations("inventory");
  const ti = useTranslations("invoices");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const { pending, run } = useActionRunner();
  const [v, setV] = useState<MovementValues>(initial);
  const [book, setBook] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorRow, setErrorRow] = useState<number | null>(null);
  const gridRef = useRef<HTMLTableElement>(null);
  const itemById = new Map(data.items.map((i) => [i.id, i]));
  const itemOptions = data.items.map((i) => ({ value: i.id, label: `${i.code} ${i.name}`, keywords: i.code }));
  const set = <K extends keyof MovementValues>(k: K, value: MovementValues[K]) => setV((p) => ({ ...p, [k]: value }));
  const update = (key: string, patch: Partial<MovementValues["lines"][number]>) =>
    setV((p) => ({ ...p, lines: p.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const isCount = v.type === "COUNT";

  function focusCell(key: string, col: string) {
    gridRef.current?.querySelector<HTMLInputElement>(`[data-row="${key}"][data-col="${col}"]`)?.focus();
  }
  function addLine() {
    const line = newMovementLine();
    setV((p) => ({ ...p, lines: [...p.lines, line] }));
    setTimeout(() => focusCell(line.key, "item"), 0);
  }
  function nextRow(key: string) {
    const idx = v.lines.findIndex((l) => l.key === key);
    const next = v.lines[idx + 1];
    if (next) focusCell(next.key, "item");
    else addLine();
  }

  function loadBook(fill: boolean) {
    run(() => loadBookQuantities(companyId, { warehouseId: v.warehouseId, date: v.date }), {
      refresh: false,
      onSuccess: (q) => {
        setBook(q);
        if (fill) {
          const existing = new Set(v.lines.map((l) => l.itemId));
          const add = data.items.filter((i) => q[i.id] && !dec(q[i.id]!).isZero() && !existing.has(i.id)).map((i) => newMovementLine({ itemId: i.id, quantity: dec(q[i.id]!).toString() }));
          setV((p) => ({ ...p, lines: [...p.lines.filter((l) => l.itemId), ...add] }));
        }
      },
    });
  }

  const payload = () => ({
    id: movementId,
    type: v.type,
    date: v.date,
    warehouseId: v.warehouseId,
    toWarehouseId: v.type === "TRANSFER" ? v.toWarehouseId : "",
    counterAccountId: v.type === "TRANSFER" ? "" : v.counterAccountId,
    description: v.description,
    lines: v.lines.filter((l) => l.itemId).map((l) => ({ itemId: l.itemId, quantity: l.quantity, unitCost: v.type === "RECEIPT" ? l.unitCost : "" })),
  });

  function submit(confirmIt: boolean) {
    setError(null);
    setErrorRow(null);
    const action = confirmIt ? confirmMovementAction : saveMovementAction;
    run(() => action(companyId, payload()), {
      success: confirmIt ? t("movementConfirmed") : ti("draftSaved"),
      refresh: false,
      onSuccess: (d) => router.push(`/c/${companyId}/inventory/movements?doc=${d.id}`),
      onError: (res, msg) => {
        setError(msg);
        if (typeof res.errorParams?.index === "number") setErrorRow(res.errorParams.index);
      },
    });
  }

  const receiptTotal = v.type === "RECEIPT" ? v.lines.reduce((s, l) => s.plus(dec(parseMoneyInput(l.quantity) ?? 0).times(dec(parseMoneyInput(l.unitCost) ?? 0))), dec(0)) : null;

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
    >
      <FormError message={error} />
      <Card>
        <CardContent className="grid gap-4 pt-5 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label={t("type")} htmlFor="m-type">
            <NativeSelect id="m-type" value={v.type} disabled={Boolean(movementId)} onChange={(e) => set("type", e.target.value as MovementType)}>
              {(["RECEIPT", "ISSUE", "TRANSFER", "COUNT"] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`types.${k}`)}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label={ti("date")} htmlFor="m-date">
            <Input id="m-date" type="date" value={v.date} onChange={(e) => set("date", e.target.value)} />
          </FormField>
          <FormField label={v.type === "TRANSFER" ? t("fromWarehouse") : t("warehouse")} htmlFor="m-wh">
            <NativeSelect id="m-wh" value={v.warehouseId} onChange={(e) => set("warehouseId", e.target.value)}>
              {data.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          {v.type === "TRANSFER" ? (
            <FormField label={t("toWarehouse")} htmlFor="m-to">
              <NativeSelect id="m-to" value={v.toWarehouseId} onChange={(e) => set("toWarehouseId", e.target.value)}>
                <option value="">—</option>
                {data.warehouses
                  .filter((w) => w.id !== v.warehouseId)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
              </NativeSelect>
            </FormField>
          ) : (
            <FormField label={t("counterAccount")} htmlFor="m-account" hint={t(`counterHint.${v.type}`)}>
              <NativeSelect id="m-account" value={v.counterAccountId} onChange={(e) => set("counterAccountId", e.target.value)}>
                <option value="">—</option>
                {data.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} {a.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          )}
          <div className="sm:col-span-2 lg:col-span-4">
            <FormField label={t("description")} htmlFor="m-desc">
              <Input id="m-desc" value={v.description} onChange={(e) => set("description", e.target.value)} />
            </FormField>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        {isCount && (
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3 text-sm">
            <span className="text-muted-foreground">{t("countHint")}</span>
            <Button type="button" size="sm" variant="outline" className="ml-auto" disabled={pending} onClick={() => loadBook(true)}>
              <ListPlus /> {t("fillFromStock")}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => loadBook(false)}>
              {t("showBook")}
            </Button>
          </div>
        )}
        <div className="overflow-x-auto">
          <table ref={gridRef} className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="w-8 px-2 py-2" />
                <th className="px-2 py-2 text-left font-medium">{t("item")}</th>
                {isCount && book && <th className="w-28 px-2 py-2 text-right font-medium">{t("bookQuantity")}</th>}
                <th className="w-32 px-2 py-2 text-right font-medium">{isCount ? t("counted") : t("quantity")}</th>
                {isCount && book && <th className="w-28 px-2 py-2 text-right font-medium">{t("difference")}</th>}
                {v.type === "RECEIPT" && <th className="w-36 px-2 py-2 text-right font-medium">{t("unitCost")}</th>}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {v.lines.map((l, i) => {
                const item = itemById.get(l.itemId);
                const bookQty = book ? dec(book[l.itemId] ?? 0) : null;
                const counted = parseMoneyInput(l.quantity);
                return (
                  <tr key={l.key} className={cn(errorRow === i && "bg-destructive/10")}>
                    <td className="px-2 py-1 text-center text-xs text-muted-foreground tabular-nums">{i + 1}</td>
                    <td className="min-w-64 px-2 py-1">
                      <Combobox
                        options={itemOptions}
                        value={l.itemId}
                        aria-label={`${t("item")} ${i + 1}`}
                        placeholder={t("itemPlaceholder")}
                        noResults={t("noStockItems")}
                        onChange={(itemId) => update(l.key, { itemId })}
                        onCommit={() => focusCell(l.key, "quantity")}
                        ref={(el) => {
                          if (el) {
                            el.dataset.row = l.key;
                            el.dataset.col = "item";
                          }
                        }}
                      />
                    </td>
                    {isCount && bookQty && <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{formatQuantity(bookQty, locale)}</td>}
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-1">
                        <Input
                          data-row={l.key}
                          data-col="quantity"
                          inputMode="decimal"
                          className="h-8 text-right tabular-nums"
                          aria-label={`${isCount ? t("counted") : t("quantity")} ${i + 1}`}
                          value={l.quantity}
                          onChange={(e) => update(l.key, { quantity: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              if (v.type === "RECEIPT") focusCell(l.key, "unitCost");
                              else nextRow(l.key);
                            }
                          }}
                        />
                        <span className="w-8 text-xs text-muted-foreground">{item?.unit}</span>
                      </div>
                    </td>
                    {isCount && bookQty && (
                      <td className={cn("px-2 py-1 text-right tabular-nums", counted && !counted.minus(bookQty).isZero() && "font-medium text-warning")}>
                        {counted ? formatQuantity(counted.minus(bookQty), locale) : ""}
                      </td>
                    )}
                    {v.type === "RECEIPT" && (
                      <td className="px-2 py-1">
                        <Input
                          data-row={l.key}
                          data-col="unitCost"
                          inputMode="decimal"
                          className="h-8 text-right tabular-nums"
                          placeholder={t("currentCost")}
                          aria-label={`${t("unitCost")} ${i + 1}`}
                          value={l.unitCost}
                          onChange={(e) => update(l.key, { unitCost: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              nextRow(l.key);
                            }
                          }}
                        />
                      </td>
                    )}
                    <td className="px-1 py-1">
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={ti("removeLine", { n: i + 1 })}
                        onClick={() => setV((p) => ({ ...p, lines: p.lines.length > 1 ? p.lines.filter((x) => x.key !== l.key) : [newMovementLine()] }))}
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
        <div className="flex items-center justify-between border-t px-4 py-2">
          <Button type="button" size="sm" variant="ghost" onClick={addLine}>
            <Plus /> {ti("addLine")}
          </Button>
          {receiptTotal && !receiptTotal.isZero() && (
            <span className="text-sm">
              {t("value")}: <span className="font-semibold tabular-nums">{formatMoney(receiptTotal, locale)}</span>
            </span>
          )}
        </div>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          {tc("cancel")}
        </Button>
        <Button type="submit" variant="outline" disabled={pending}>
          {ti("saveDraft")}
        </Button>
        {canConfirm && (
          <Button type="button" disabled={pending} onClick={() => submit(true)}>
            {t("saveAndConfirm")}
          </Button>
        )}
      </div>
    </form>
  );
}
