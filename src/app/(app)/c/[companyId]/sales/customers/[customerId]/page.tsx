import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { FilePlus2 } from "lucide-react";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { isLocale } from "@/i18n/config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { CustomerForm } from "../customer-form";
import { loadCustomerFormData } from "../form-data";

export async function generateMetadata({ params }: PageProps<"/c/[companyId]/sales/customers/[customerId]">): Promise<Metadata> {
  const { companyId, customerId } = await params;
  const ctx = await requireCompany(companyId, "sales");
  const c = await ctx.cdb.customer.findFirst({ where: { id: customerId }, select: { name: true } });
  return { title: c?.name ?? "—" };
}

export default async function CustomerPage({ params }: PageProps<"/c/[companyId]/sales/customers/[customerId]">) {
  const { companyId, customerId } = await params;
  const ctx = await requireCompany(companyId, "sales");
  const t = await getTranslations("customers");
  const ti = await getTranslations("invoices");
  const locale = await getLocale();
  const c = await ctx.cdb.customer.findFirst({ where: { id: customerId } });
  if (!c) notFound();
  const [data, invoices] = await Promise.all([
    loadCustomerFormData(ctx),
    ctx.cdb.salesInvoice.findMany({
      where: { customerId },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 10,
      select: { id: true, number: true, date: true, total: true, currency: true, status: true, type: true },
    }),
  ]);
  const canEdit = can(ctx.membership, "sales", "edit");
  const s = (x: string | null) => x ?? "";

  return (
    <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div>
        <PageHeader title={c.name} description={t("editSubtitle")} />
        <CustomerForm
          companyId={companyId}
          customerId={c.id}
          canEdit={canEdit}
          groups={data.groups}
          vatRates={data.vatRates}
          currencies={data.currencies}
          defaults={data.defaults}
          initial={{
            name: c.name,
            isPerson: c.isPerson,
            regCode: s(c.regCode),
            vatNumber: s(c.vatNumber),
            countryCode: c.countryCode,
            addressStreet: s(c.addressStreet),
            addressCity: s(c.addressCity),
            addressPostalCode: s(c.addressPostalCode),
            addressCounty: s(c.addressCounty),
            email: s(c.email),
            emailCc: s(c.emailCc),
            phone: s(c.phone),
            contactPerson: s(c.contactPerson),
            paymentTermDays: c.paymentTermDays?.toString() ?? "",
            lateInterestPct: c.lateInterestPct?.toString() ?? "",
            locale: isLocale(c.locale) ? c.locale : "et",
            currency: c.currency,
            referenceNumber: s(c.referenceNumber),
            groupId: s(c.groupId),
            defaultVatRateId: s(c.defaultVatRateId),
            notes: s(c.notes),
            active: c.active,
          }}
        />
      </div>
      <aside className="space-y-4 lg:pt-16">
        <Card>
          <CardHeader>
            <CardTitle>{t("recentInvoices")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {invoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noInvoices")}</p>
            ) : (
              <ul className="divide-y text-sm">
                {invoices.map((i) => (
                  <li key={i.id}>
                    <Link href={`/c/${companyId}/sales/invoices?doc=${i.id}`} className="flex items-center justify-between gap-2 py-1.5 hover:underline">
                      <span className="flex items-center gap-1.5">
                        <span className="font-mono">{i.number ?? ti("draftNumber")}</span>
                        {i.status === "DRAFT" && <Badge variant="warning">{ti("statusDraft")}</Badge>}
                        {i.type !== "INVOICE" && <Badge variant="outline">{ti(`types.${i.type}`)}</Badge>}
                      </span>
                      <span className="text-right tabular-nums">
                        {formatMoney(i.total, locale)} <span className="text-xs text-muted-foreground">{formatDate(i.date, locale)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {canEdit && (
              <Button asChild variant="outline" className="w-full">
                <Link href={`/c/${companyId}/sales/invoices/new?customer=${c.id}`}>
                  <FilePlus2 /> {ti("newForCustomer")}
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
