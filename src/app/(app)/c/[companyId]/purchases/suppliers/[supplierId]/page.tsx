import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { FilePlus2 } from "lucide-react";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { formatIban } from "@/lib/iban";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { SupplierForm } from "../supplier-form";
import { loadSupplierFormData } from "../form-data";

export async function generateMetadata({ params }: PageProps<"/c/[companyId]/purchases/suppliers/[supplierId]">): Promise<Metadata> {
  const { companyId, supplierId } = await params;
  const ctx = await requireCompany(companyId, "purchases");
  const s = await ctx.cdb.supplier.findFirst({ where: { id: supplierId }, select: { name: true } });
  return { title: s?.name ?? "—" };
}

export default async function SupplierPage({ params }: PageProps<"/c/[companyId]/purchases/suppliers/[supplierId]">) {
  const { companyId, supplierId } = await params;
  const ctx = await requireCompany(companyId, "purchases");
  const t = await getTranslations("suppliers");
  const ti = await getTranslations("invoices");
  const locale = await getLocale();
  const s = await ctx.cdb.supplier.findFirst({ where: { id: supplierId } });
  if (!s) notFound();
  const [data, invoices] = await Promise.all([
    loadSupplierFormData(ctx),
    ctx.cdb.purchaseInvoice.findMany({
      where: { supplierId },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 10,
      select: { id: true, number: true, invoiceNumber: true, date: true, total: true, status: true },
    }),
  ]);
  const canEdit = can(ctx.membership, "purchases", "edit");
  const str = (x: string | null) => x ?? "";
  return (
    <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div>
        <PageHeader title={s.name} description={t("editSubtitle")} />
        <SupplierForm
          companyId={companyId}
          supplierId={s.id}
          canEdit={canEdit}
          {...data}
          initial={{
            name: s.name,
            isPerson: s.isPerson,
            regCode: str(s.regCode),
            vatNumber: str(s.vatNumber),
            countryCode: s.countryCode,
            addressStreet: str(s.addressStreet),
            addressCity: str(s.addressCity),
            addressPostalCode: str(s.addressPostalCode),
            addressCounty: str(s.addressCounty),
            email: str(s.email),
            phone: str(s.phone),
            contactPerson: str(s.contactPerson),
            bankAccount: s.bankAccount ? formatIban(s.bankAccount) : "",
            referenceNumber: str(s.referenceNumber),
            paymentTermDays: s.paymentTermDays?.toString() ?? "",
            currency: s.currency,
            groupId: str(s.groupId),
            defaultAccountId: str(s.defaultAccountId),
            defaultVatRateId: str(s.defaultVatRateId),
            notes: str(s.notes),
            active: s.active,
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
                    <Link href={`/c/${companyId}/purchases/invoices?doc=${i.id}`} className="flex items-center justify-between gap-2 py-1.5 hover:underline">
                      <span className="flex items-center gap-1.5">
                        <span className="font-mono">{i.invoiceNumber ?? i.number ?? ti("draftNumber")}</span>
                        {i.status === "DRAFT" && <Badge variant="warning">{ti("statusDraft")}</Badge>}
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
                <Link href={`/c/${companyId}/purchases/invoices/new?supplier=${s.id}`}>
                  <FilePlus2 /> {t("newInvoice")}
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
