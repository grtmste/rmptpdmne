"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Banknote } from "lucide-react";
import { parseISODate } from "@/lib/accounting/dates";
import { formatDate } from "@/lib/dates";
import { dec, formatMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";

export type DocumentPayment = { id: string; number: string | null; date: string; direction: string; amount: string; cancelled: boolean };

/** Arve tasumise seis eelvaates: tasutud, tasumata, seotud maksed ja nupp makse lisamiseks. */
export function PaymentStatus({
  companyId,
  total,
  paid,
  currency,
  payments,
  payHref,
  payLabel,
}: {
  companyId: string;
  total: string;
  paid: string;
  currency: string;
  payments: DocumentPayment[];
  payHref: string;
  payLabel: string;
}) {
  const t = useTranslations("paymentStatus");
  const locale = useLocale();
  const open = dec(total).minus(dec(paid));
  const done = open.isZero() && !dec(total).isZero();
  return (
    <div className="space-y-2 border-t px-5 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={done ? "font-medium text-success" : open.isZero() ? "text-muted-foreground" : "font-medium"}>
          {done ? t("paid") : t("open", { amount: `${formatMoney(open, locale)} ${currency}` })}
        </span>
        {!open.isZero() && (
          <Button size="sm" variant="outline" asChild>
            <Link href={payHref}>
              <Banknote /> {payLabel}
            </Link>
          </Button>
        )}
      </div>
      {payments.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {payments.map((p, i) => (
            <li key={`${p.id}-${i}`} className={p.cancelled ? "line-through" : undefined}>
              <Link className="font-mono text-primary hover:underline" href={`/c/${companyId}/payments?doc=${p.id}`}>
                {p.number}
              </Link>{" "}
              · {formatDate(parseISODate(p.date)!, locale)} · {formatMoney(p.amount, locale)}
              {p.direction === "NETTING" ? ` · ${t("netting")}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
