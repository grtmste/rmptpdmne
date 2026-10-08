import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { toISODate } from "@/lib/accounting/dates";
import { calendarYearOf } from "@/lib/accounting/fiscal";
import { PageHeader } from "@/components/common/page-header";
import { SetupRequired } from "@/components/common/setup-required";
import { OpeningBalancesEditor, type OpeningAccount } from "./opening-balances-editor";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.settings.openingBalances") };
}

export default async function OpeningBalancesPage({ params }: PageProps<"/c/[companyId]/settings/opening-balances">) {
  const { companyId } = await params;
  const ctx = await requireCompany(companyId, "settings");
  const t = await getTranslations("opening");
  const tn = await getTranslations("nav");
  const canEdit = can(ctx.membership, "settings", "confirm");

  const [company, accounts, entry] = await Promise.all([
    ctx.cdb.company.findFirstOrThrow({ select: { accountingStartDate: true, lockedUntil: true } }),
    ctx.cdb.glAccount.findMany({
      where: { kind: "DETAIL", OR: [{ role: null }, { role: { not: "CURRENT_YEAR_PROFIT" } }] },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, type: true, active: true },
    }),
    ctx.cdb.journalEntry.findFirst({ where: { source: "OPENING_BALANCE" }, include: { lines: true } }),
  ]);

  const amounts = new Map<string, { debit: string; credit: string }>();
  for (const l of entry?.lines ?? []) {
    amounts.set(l.accountId, {
      debit: l.debit.isZero() ? "" : l.debit.toFixed(2),
      credit: l.credit.isZero() ? "" : l.credit.toFixed(2),
    });
  }
  const rows: OpeningAccount[] = accounts
    .filter((a) => a.active || amounts.has(a.id))
    .map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      debit: amounts.get(a.id)?.debit ?? "",
      credit: amounts.get(a.id)?.credit ?? "",
    }));

  const start = company.accountingStartDate ?? calendarYearOf(new Date()).startDate;
  const locked = Boolean(entry && company.lockedUntil && entry.date.getTime() <= company.lockedUntil.getTime());

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={tn("items.settings.openingBalances")} description={t("subtitle")} />
      {accounts.length === 0 ? (
        <SetupRequired companyId={companyId} canEdit={can(ctx.membership, "settings", "edit")} />
      ) : (
        <OpeningBalancesEditor
          companyId={companyId}
          accounts={rows}
          accountingStartDate={toISODate(start)}
          saved={Boolean(entry)}
          canEdit={canEdit && !locked}
          locked={locked}
        />
      )}
    </div>
  );
}
