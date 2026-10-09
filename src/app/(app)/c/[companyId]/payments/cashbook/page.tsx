import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Wallet } from "lucide-react";
import { requireCompany } from "@/server/session";
import { parseISODate, toISODate } from "@/lib/accounting/dates";
import { formatDate, todayLocal } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { generalLedger } from "@/server/reports/ledger";
import { db } from "@/lib/db";
import { PrintButton } from "@/components/common/print-button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ListSearch } from "@/components/common/list-controls";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.payments.cashbook") };
}

/** Kassaraamat: kassa sissetulekud ja väljaminekud jooksva saldoga (pearaamatust). */
export default async function CashbookPage({ params, searchParams }: PageProps<"/c/[companyId]/payments/cashbook">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "payments");
  const t = await getTranslations("cashbook");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const cashes = await ctx.cdb.bankAccount.findMany({ where: { kind: "CASH" }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const cash = cashes.find((c) => c.id === str(sp.account)) ?? cashes[0];
  const today = todayLocal();
  const from = parseISODate(str(sp.from)) ?? parseISODate(`${toISODate(today).slice(0, 7)}-01`)!;
  const to = parseISODate(str(sp.to)) ?? today;
  if (!cash) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader title={tn("items.payments.cashbook")} />
        <Card>
          <EmptyState icon={Wallet} title={t("noCash")} description={t("noCashBody")} />
        </Card>
      </div>
    );
  }
  const ledger = await generalLedger(db, ctx.company.id, { from, to, accountIds: [cash.accountId] });
  const account = ledger.accounts[0];
  const opening = account?.opening ?? 0;
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={tn("items.payments.cashbook")}
        description={`${cash.name} · ${formatDate(from, locale)} – ${formatDate(to, locale)}`}
        actions={
          <PrintButton label={t("print")} />
        }
      />
      <div className="print:hidden">
        <ListSearch
          placeholder={t("search")}
          dates
          filters={cashes.length > 1 ? [{ name: "account", label: t("cash"), options: cashes.map((c) => ({ value: c.id, label: c.name })) }] : []}
        />
      </div>
      <Card className="mt-4 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="w-24 px-4 py-2 text-left font-medium">{t("date")}</th>
              <th className="w-24 px-2 py-2 text-left font-medium">{t("document")}</th>
              <th className="px-2 py-2 text-left font-medium">{t("description")}</th>
              <th className="w-28 px-2 py-2 text-right font-medium">{t("in")}</th>
              <th className="w-28 px-2 py-2 text-right font-medium">{t("out")}</th>
              <th className="w-28 px-4 py-2 text-right font-medium">{t("balance")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            <tr className="bg-muted/30 font-medium">
              <td className="px-4 py-2" colSpan={5}>
                {t("opening")}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">{formatMoney(opening, locale)}</td>
            </tr>
            {(account?.lines ?? []).map((l, i) => (
              <tr key={`${l.entryId}-${i}`}>
                <td className="px-4 py-1.5 text-muted-foreground tabular-nums">{formatDate(l.date, locale)}</td>
                <td className="px-2 py-1.5 font-mono text-xs">{l.number}</td>
                <td className="px-2 py-1.5">{l.description}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{l.debit.isZero() ? "" : formatMoney(l.debit, locale)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{l.credit.isZero() ? "" : formatMoney(l.credit, locale)}</td>
                <td className="px-4 py-1.5 text-right tabular-nums">{formatMoney(l.balance, locale)}</td>
              </tr>
            ))}
            <tr className="bg-muted/30 font-medium">
              <td className="px-4 py-2" colSpan={3}>
                {t("closing")}
              </td>
              <td className="px-2 py-2 text-right tabular-nums">{formatMoney(account?.debit ?? 0, locale)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{formatMoney(account?.credit ?? 0, locale)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{formatMoney(account?.closing ?? opening, locale)}</td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}
