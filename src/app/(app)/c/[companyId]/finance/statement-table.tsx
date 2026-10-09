import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type Decimal from "decimal.js";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { StatementRow } from "@/lib/reports/statements";
import { Card } from "@/components/ui/card";

/**
 * Finantsaruande tabel (bilanss, kasumiaruanne, rahavood). Read on nimeruumis `reportLines`;
 * detailvaates on rea all kontod, mis viivad pearaamatusse.
 */
export async function StatementTable({
  rows,
  amountLabel,
  compareLabel,
  detail,
  ledgerHref,
}: {
  rows: StatementRow[];
  amountLabel: string;
  compareLabel?: string | null;
  detail?: boolean;
  ledgerHref?: (accountId: string) => string;
}) {
  const t = await getTranslations("reportLines");
  const locale = await getLocale();
  const m = (v: Decimal | null) => (v === null ? "" : formatMoney(v, locale));
  const withCompare = Boolean(compareLabel);

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium" />
              <th className="w-40 px-4 py-2 text-right font-medium">{amountLabel}</th>
              {withCompare && <th className="w-40 px-4 py-2 text-right font-medium">{compareLabel}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) =>
              r.kind === "heading" ? (
                <tr key={r.code} className="border-t bg-muted/30">
                  <td colSpan={withCompare ? 3 : 2} className="px-4 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {t(r.code)}
                  </td>
                </tr>
              ) : (
                <Rows key={r.code}>
                  <tr
                    className={cn(
                      "border-t",
                      r.kind === "subtotal" && "bg-muted/20 font-semibold",
                      r.kind === "total" && "border-t-2 border-foreground/20 bg-primary/5 font-bold",
                    )}
                    data-line={r.code}
                  >
                    <td className={cn("px-4 py-1.5", r.kind === "line" && "pl-6")}>{t(r.code)}</td>
                    <td className="num px-4 py-1.5">{m(r.amount)}</td>
                    {withCompare && <td className="num px-4 py-1.5 text-muted-foreground">{m(r.compare)}</td>}
                  </tr>
                  {detail &&
                    r.accounts.map((a) => (
                      <tr key={a.id} className="text-xs text-muted-foreground">
                        <td className="py-1 pr-4 pl-10">
                          {ledgerHref && a.code ? (
                            <Link href={ledgerHref(a.id)} className="hover:text-primary hover:underline">
                              <span className="font-mono">{a.code}</span> {a.name}
                            </Link>
                          ) : (
                            <span>
                              <span className="font-mono">{a.code}</span> {a.name || t("priorYearsResult")}
                            </span>
                          )}
                        </td>
                        <td className="num px-4 py-1">{m(a.amount)}</td>
                        {withCompare && <td className="num px-4 py-1">{m(a.compare)}</td>}
                      </tr>
                    ))}
                </Rows>
              ),
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Rows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
