import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Banknote, Landmark, Wallet } from "lucide-react";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { formatIban } from "@/lib/iban";
import { dec, formatMoney } from "@/lib/money";
import { POSTED } from "@/server/services/journal";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { BankAccountDialog } from "./bank-account-dialog";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.payments.accounts") };
}

export default async function BankAccountsPage({ params }: PageProps<"/c/[companyId]/payments/accounts">) {
  const { companyId } = await params;
  const ctx = await requireCompany(companyId, "payments");
  const t = await getTranslations("bankAccounts");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const [accounts, glAccounts] = await Promise.all([
    ctx.cdb.bankAccount.findMany({ orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { name: "asc" }] }),
    ctx.cdb.glAccount.findMany({ where: { active: true, kind: "DETAIL", type: "ASSET" }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
  ]);
  // Saldo pearaamatust (raha konto); mitu panka samal kontol jagavad saldot
  const totals = await ctx.cdb.journalLine.groupBy({
    by: ["accountId"],
    where: { accountId: { in: accounts.map((a) => a.accountId) }, entry: POSTED },
    _sum: { debit: true, credit: true },
  });
  const balance = new Map(totals.map((x) => [x.accountId, dec(x._sum.debit ?? 0).minus(dec(x._sum.credit ?? 0))]));
  const shared = new Map<string, number>();
  for (const a of accounts) shared.set(a.accountId, (shared.get(a.accountId) ?? 0) + 1);
  const glName = new Map(glAccounts.map((g) => [g.id, `${g.code} ${g.name}`]));
  const canEdit = can(ctx.membership, "payments", "confirm");
  const glOptions = glAccounts.map((g) => ({ id: g.id, label: `${g.code} ${g.name}` }));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={tn("items.payments.accounts")} description={t("subtitle")} actions={canEdit && <BankAccountDialog companyId={companyId} glAccounts={glOptions} />} />
      {accounts.length === 0 ? (
        <Card>
          <EmptyState icon={Landmark} title={t("emptyTitle")} description={t("emptyBody")} />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {accounts.map((a) => {
            const Icon = a.kind === "BANK" ? Landmark : Wallet;
            return (
              <Card key={a.id} className={a.active ? undefined : "opacity-60"}>
                <CardContent className="space-y-3 pt-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                        <Icon className="size-5" />
                      </div>
                      <div>
                        <div className="font-semibold">{a.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">{a.iban ? formatIban(a.iban) : t(`kinds.${a.kind}`)}</div>
                      </div>
                    </div>
                    {canEdit && (
                      <BankAccountDialog
                        companyId={companyId}
                        glAccounts={glOptions}
                        accountId={a.id}
                        initial={{
                          kind: a.kind,
                          name: a.name,
                          iban: a.iban ? formatIban(a.iban) : "",
                          bic: a.bic ?? "",
                          currency: a.currency,
                          accountId: a.accountId,
                          showOnInvoice: a.showOnInvoice,
                          active: a.active,
                        }}
                      />
                    )}
                  </div>
                  <div className="flex items-end justify-between gap-3">
                    <div className="text-xs text-muted-foreground">
                      {glName.get(a.accountId)}
                      {(shared.get(a.accountId) ?? 0) > 1 && <span className="block">{t("sharedAccount")}</span>}
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">{t("balance")}</div>
                      <div className="text-xl font-semibold tabular-nums">{formatMoney(balance.get(a.accountId) ?? 0, locale, { currency: ctx.company.baseCurrency })}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 text-sm">
                    {!a.active && <Badge variant="outline">{t("inactive")}</Badge>}
                    {a.kind === "BANK" && a.showOnInvoice && <Badge variant="secondary">{t("onInvoice")}</Badge>}
                    <Link className="inline-flex items-center gap-1 text-primary hover:underline" href={`/c/${companyId}/payments?account=${a.id}`}>
                      <Banknote className="size-3.5" /> {t("payments")}
                    </Link>
                    {a.kind === "BANK" ? (
                      <Link className="text-primary hover:underline" href={`/c/${companyId}/payments/statements?account=${a.id}`}>
                        {t("statements")}
                      </Link>
                    ) : (
                      <Link className="text-primary hover:underline" href={`/c/${companyId}/payments/cashbook?account=${a.id}`}>
                        {t("cashbook")}
                      </Link>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
