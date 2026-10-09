"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Layers } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useActionRunner } from "@/components/common/use-action";
import { consolidateQuotesAction } from "@/server/actions/collections";

export type QuoteGroup = {
  customerId: string;
  customerName: string;
  quotes: Array<{ id: string; number: string; date: string; status: string; currency: string; total: string; description: string }>;
};

export function ConsolidateForm({ companyId, groups, today }: { companyId: string; groups: QuoteGroup[]; today: string }) {
  const t = useTranslations("consolidated");
  const tq = useTranslations("quotes");
  const locale = useLocale();
  const router = useRouter();
  const { pending, run } = useActionRunner();
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [date, setDate] = useState(today);

  const toggle = (group: QuoteGroup, id: string, on: boolean) => {
    // Koondarve on ühe kliendi kohta: teise kliendi valik alustab valikut otsast
    if (customerId !== group.customerId) {
      setCustomerId(group.customerId);
      setSelected(on ? [id] : []);
      return;
    }
    setSelected(on ? [...selected, id] : selected.filter((x) => x !== id));
  };
  const chosen = groups.find((g) => g.customerId === customerId)?.quotes.filter((q) => selected.includes(q.id)) ?? [];
  const total = chosen.reduce((s, q) => s + Number(q.total), 0);

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <Card key={g.customerId} className="overflow-hidden">
          <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2">
            <span className="font-medium">{g.customerName}</span>
            <span className="text-xs text-muted-foreground">{t("quoteCount", { count: g.quotes.length })}</span>
          </div>
          <ul className="divide-y">
            {g.quotes.map((q) => (
              <li key={q.id}>
                <label className="flex cursor-pointer items-center gap-3 px-4 py-2 text-sm hover:bg-muted/30">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--primary)]"
                    checked={customerId === g.customerId && selected.includes(q.id)}
                    onChange={(e) => toggle(g, q.id, e.target.checked)}
                    aria-label={t("selectQuote", { number: q.number })}
                  />
                  <span className="font-mono text-xs">{q.number}</span>
                  <span className="text-muted-foreground">{q.date}</span>
                  <Badge variant="outline">{tq(`statuses.${q.status}`)}</Badge>
                  <span className="min-w-0 flex-1 truncate">{q.description}</span>
                  <span className="tabular-nums">
                    {formatMoney(q.total, locale)} {q.currency}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </Card>
      ))}
      <div className="sticky bottom-16 flex flex-wrap items-end gap-3 rounded-xl border bg-card/95 p-4 backdrop-blur md:bottom-3">
        <div className="space-y-1.5">
          <Label htmlFor="cons-date">{t("invoiceDate")}</Label>
          <Input id="cons-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
        </div>
        <span className="ml-auto text-sm">
          {t("selected", { count: chosen.length })}: <b className="tabular-nums">{formatMoney(total, locale)}</b>
        </span>
        <Button
          disabled={pending || chosen.length === 0}
          onClick={() =>
            run(() => consolidateQuotesAction(companyId, { quoteIds: chosen.map((q) => q.id), date }), {
              refresh: false,
              success: t("created"),
              onSuccess: (d) => router.push(`/c/${companyId}/sales/invoices/${d.id}/edit`),
            })
          }
        >
          <Layers /> {t("create")}
        </Button>
      </div>
    </div>
  );
}
