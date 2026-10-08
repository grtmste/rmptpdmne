"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Lock, Plus, Search } from "lucide-react";
import { reportLinesForType } from "@/lib/accounting/report-lines";
import { accountTypeFromCode } from "@/lib/accounting/ledger";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FormError, FormField } from "@/components/common/form-field";
import { useActionRunner } from "@/components/common/use-action";
import { deleteAccount, saveAccount } from "@/server/actions/settings/accounts";

const TYPES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const;
type AccountType = (typeof TYPES)[number];

export type AccountRow = {
  id: string;
  code: string;
  name: string;
  nameEn: string;
  type: AccountType;
  kind: "DETAIL" | "SUMMARY";
  reportLine: string;
  defaultVatRateId: string;
  vatTurnover: "NONE" | "SALES" | "PURCHASE";
  isPaymentMethod: boolean;
  requiresDepartment: boolean;
  requiredDimensionIds: string[];
  showOnDashboard: boolean;
  active: boolean;
  role: string | null;
  used: boolean;
};

type VatOption = { id: string; code: string; name: string; active: boolean };
type DimOption = { id: string; name: string };

export function AccountsManager({
  companyId,
  accounts,
  vatRates,
  dimensions,
  canEdit,
}: {
  companyId: string;
  accounts: AccountRow[];
  vatRates: VatOption[];
  dimensions: DimOption[];
  canEdit: boolean;
}) {
  const t = useTranslations("accounts");
  const tl = useTranslations("reportLines");
  const [query, setQuery] = useState("");
  const [type, setType] = useState<AccountType | "ALL">("ALL");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<AccountRow | "new" | null>(null);

  const vatById = useMemo(() => new Map(vatRates.map((v) => [v.id, v])), [vatRates]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return accounts.filter(
      (a) =>
        (showInactive || a.active) &&
        (type === "ALL" || a.type === type) &&
        (!q || a.code.toLowerCase().startsWith(q) || a.name.toLowerCase().includes(q)),
    );
  }, [accounts, query, type, showInactive]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} className="pl-8" aria-label={t("search")} />
        </div>
        <div role="tablist" aria-label={t("type")} className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
          {(["ALL", ...TYPES] as const).map((ty) => (
            <button
              key={ty}
              role="tab"
              aria-selected={type === ty}
              onClick={() => setType(ty)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground",
                type === ty && "bg-card text-foreground shadow-sm",
              )}
            >
              {ty === "ALL" ? t("all") : t(`types.${ty}`)}
            </button>
          ))}
        </div>
        <Checkbox label={t("showInactive")} checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
        {canEdit && (
          <Button className="ml-auto" size="sm" onClick={() => setEditing("new")}>
            <Plus /> {t("add")}
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        <Table>
          <THead>
            <tr>
              <TH className="w-24">{t("code")}</TH>
              <TH>{t("name")}</TH>
              <TH className="hidden md:table-cell">{t("reportLine")}</TH>
              <TH className="hidden lg:table-cell">{t("vat")}</TH>
              <TH className="w-28" />
            </tr>
          </THead>
          <TBody>
            {filtered.map((a) => (
              <TR
                key={a.id}
                className={cn("cursor-pointer", !a.active && "opacity-55")}
                onClick={() => setEditing(a)}
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && setEditing(a)}
              >
                <TD className={cn("font-mono text-[13px]", a.kind === "SUMMARY" && "font-semibold")}>{a.code}</TD>
                <TD className={cn(a.kind === "SUMMARY" && "font-semibold")}>{a.name}</TD>
                <TD className="hidden text-muted-foreground md:table-cell">{a.reportLine ? tl(a.reportLine) : "—"}</TD>
                <TD className="hidden text-muted-foreground lg:table-cell">{vatById.get(a.defaultVatRateId)?.name ?? ""}</TD>
                <TD>
                  <div className="flex justify-end gap-1">
                    {a.role && (
                      <span title={t("systemHint")}>
                        <Lock className="size-3.5 text-muted-foreground" aria-label={t("system")} />
                      </span>
                    )}
                    {a.isPaymentMethod && <Badge variant="secondary">{t("payment")}</Badge>}
                    {!a.active && <Badge variant="outline">{t("inactive")}</Badge>}
                  </div>
                </TD>
              </TR>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                  {t("noResults")}
                </td>
              </tr>
            )}
          </TBody>
        </Table>
      </Card>
      <p className="text-xs text-muted-foreground">{t("count", { shown: filtered.length, total: accounts.length })}</p>

      {editing && (
        <AccountDialog
          companyId={companyId}
          account={editing === "new" ? null : editing}
          vatRates={vatRates}
          dimensions={dimensions}
          canEdit={canEdit}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function AccountDialog({
  companyId,
  account,
  vatRates,
  dimensions,
  canEdit,
  onClose,
}: {
  companyId: string;
  account: AccountRow | null;
  vatRates: VatOption[];
  dimensions: DimOption[];
  canEdit: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("accounts");
  const tl = useTranslations("reportLines");
  const tc = useTranslations("common");
  const { pending, run } = useActionRunner();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [v, setV] = useState<Omit<AccountRow, "id" | "role" | "used">>(
    account ?? {
      code: "",
      name: "",
      nameEn: "",
      type: "EXPENSE",
      kind: "DETAIL",
      reportLine: "",
      defaultVatRateId: "",
      vatTurnover: "NONE",
      isPaymentMethod: false,
      requiresDepartment: false,
      requiredDimensionIds: [],
      showOnDashboard: false,
      active: true,
    },
  );
  const set = <K extends keyof typeof v>(key: K, value: (typeof v)[K]) => setV((prev) => ({ ...prev, [key]: value }));
  const lines = reportLinesForType(v.type);
  const system = Boolean(account?.role);
  const readOnly = !canEdit;

  function submit() {
    setError(null);
    setFieldErrors({});
    run(() => saveAccount(companyId, { ...v, id: account?.id }), {
      success: tc("saved"),
      onSuccess: onClose,
      onError: (res, msg) => {
        setFieldErrors(res.fieldErrors ?? {});
        if (res.error !== "validation") setError(msg);
      },
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl" closeLabel={tc("close")} aria-describedby={undefined}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{account ? `${account.code} ${account.name}` : t("newTitle")}</DialogTitle>
          </DialogHeader>
          <DialogBody className="max-h-[65vh] space-y-4 overflow-y-auto">
            <FormError message={error} />
            {system && (
              <p className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                <Lock className="size-3.5" /> {t("systemHint")}
              </p>
            )}
            <fieldset disabled={readOnly} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
                <FormField label={t("code")} htmlFor="code" errors={fieldErrors.code}>
                  <Input
                    id="code"
                    value={v.code}
                    autoFocus={!account}
                    onChange={(e) => {
                      const code = e.target.value;
                      set("code", code);
                      // Uue konto tüüp koodi esimese numbri järgi
                      if (!account) {
                        const guess = accountTypeFromCode(code);
                        if (guess && guess !== v.type) setV((p) => ({ ...p, code, type: guess, reportLine: "" }));
                      }
                    }}
                  />
                </FormField>
                <FormField label={t("name")} htmlFor="name" errors={fieldErrors.name}>
                  <Input id="name" value={v.name} onChange={(e) => set("name", e.target.value)} />
                </FormField>
              </div>
              <FormField label={t("nameEn")} htmlFor="nameEn">
                <Input id="nameEn" value={v.nameEn} onChange={(e) => set("nameEn", e.target.value)} />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label={t("type")} htmlFor="type">
                  <NativeSelect
                    id="type"
                    value={v.type}
                    disabled={system || account?.used}
                    onChange={(e) => setV((p) => ({ ...p, type: e.target.value as AccountType, reportLine: "" }))}
                  >
                    {TYPES.map((ty) => (
                      <option key={ty} value={ty}>
                        {t(`types.${ty}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                <FormField label={t("kind")} htmlFor="kind" hint={t(`kindHints.${v.kind}`)}>
                  <NativeSelect
                    id="kind"
                    value={v.kind}
                    disabled={system || account?.used}
                    onChange={(e) => set("kind", e.target.value as "DETAIL" | "SUMMARY")}
                  >
                    <option value="DETAIL">{t("kinds.DETAIL")}</option>
                    <option value="SUMMARY">{t("kinds.SUMMARY")}</option>
                  </NativeSelect>
                </FormField>
              </div>
              <FormField label={t("reportLine")} htmlFor="reportLine">
                <NativeSelect id="reportLine" value={v.reportLine} onChange={(e) => set("reportLine", e.target.value)}>
                  <option value="">—</option>
                  {lines.map((l) => (
                    <option key={l.code} value={l.code}>
                      {tl(l.code)}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              {v.kind === "DETAIL" && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField label={t("vat")} htmlFor="vat">
                      <NativeSelect id="vat" value={v.defaultVatRateId} onChange={(e) => set("defaultVatRateId", e.target.value)}>
                        <option value="">—</option>
                        {vatRates
                          .filter((r) => r.active || r.id === v.defaultVatRateId)
                          .map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                      </NativeSelect>
                    </FormField>
                    <FormField label={t("vatTurnover")} htmlFor="vatTurnover">
                      <NativeSelect
                        id="vatTurnover"
                        value={v.vatTurnover}
                        onChange={(e) => set("vatTurnover", e.target.value as AccountRow["vatTurnover"])}
                      >
                        {(["NONE", "SALES", "PURCHASE"] as const).map((x) => (
                          <option key={x} value={x}>
                            {t(`turnover.${x}`)}
                          </option>
                        ))}
                      </NativeSelect>
                    </FormField>
                  </div>
                  <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
                    <Checkbox
                      label={t("isPaymentMethod")}
                      description={t("isPaymentMethodHint")}
                      checked={v.isPaymentMethod}
                      onChange={(e) => set("isPaymentMethod", e.target.checked)}
                    />
                    <Checkbox
                      label={t("showOnDashboard")}
                      checked={v.showOnDashboard}
                      onChange={(e) => set("showOnDashboard", e.target.checked)}
                    />
                    <Checkbox
                      label={t("requiresDepartment")}
                      checked={v.requiresDepartment}
                      onChange={(e) => set("requiresDepartment", e.target.checked)}
                    />
                    {dimensions.map((d) => (
                      <Checkbox
                        key={d.id}
                        label={t("requiresDimension", { name: d.name })}
                        checked={v.requiredDimensionIds.includes(d.id)}
                        onChange={(e) =>
                          set(
                            "requiredDimensionIds",
                            e.target.checked ? [...v.requiredDimensionIds, d.id] : v.requiredDimensionIds.filter((x) => x !== d.id),
                          )
                        }
                      />
                    ))}
                  </div>
                </>
              )}
              <Checkbox
                label={t("active")}
                description={t("activeHint")}
                checked={v.active}
                disabled={system}
                onChange={(e) => set("active", e.target.checked)}
              />
            </fieldset>
          </DialogBody>
          <DialogFooter className="justify-between">
            <div>
              {account && canEdit && !account.role && !account.used && (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive"
                  disabled={pending}
                  onClick={() => {
                    if (confirm(t("deleteConfirm", { code: account.code }))) {
                      run(() => deleteAccount(companyId, { id: account.id }), { success: t("deleted"), onSuccess: onClose });
                    }
                  }}
                >
                  {tc("delete")}
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                {canEdit ? tc("cancel") : tc("close")}
              </Button>
              {canEdit && (
                <Button type="submit" disabled={pending}>
                  {pending ? tc("saving") : tc("save")}
                </Button>
              )}
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
