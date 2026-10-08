import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { FileText, ImageIcon, Inbox } from "lucide-react";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { UploadZone } from "./upload-zone";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.purchases.inbox") };
}

export default async function PurchaseInboxPage({ params }: PageProps<"/c/[companyId]/purchases/inbox">) {
  const { companyId } = await params;
  const ctx = await requireCompany(companyId, "purchases");
  const t = await getTranslations("purchases");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const drafts = await ctx.cdb.purchaseInvoice.findMany({
    where: { status: "DRAFT", source: "UPLOAD" },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, supplierName: true, invoiceNumber: true, createdAt: true, total: true },
  });
  const attachments = await ctx.cdb.attachment.findMany({
    where: { documentType: "PurchaseInvoice", documentId: { in: drafts.map((d) => d.id) } },
    orderBy: { createdAt: "asc" },
    select: { id: true, documentId: true, fileName: true, contentType: true },
  });
  const firstFile = new Map<string, (typeof attachments)[number]>();
  for (const a of attachments) if (!firstFile.has(a.documentId)) firstFile.set(a.documentId, a);
  const canEdit = can(ctx.membership, "purchases", "edit");

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader title={tn("items.purchases.inbox")} description={t("inboxSubtitle")} />
      {canEdit && <UploadZone companyId={companyId} />}
      <Card className="overflow-hidden">
        {drafts.length === 0 ? (
          <EmptyState icon={Inbox} title={t("inboxEmptyTitle")} description={t("inboxEmptyBody")} />
        ) : (
          <ul className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3" aria-label={t("inboxLabel")}>
            {drafts.map((d) => {
              const file = firstFile.get(d.id);
              return (
                <li key={d.id} className="bg-card">
                  <Link href={`/c/${companyId}/purchases/invoices/${d.id}/edit`} className="flex h-full flex-col gap-2 p-4 hover:bg-muted/40">
                    <div className="flex h-36 items-center justify-center overflow-hidden rounded-md border bg-muted/40">
                      {file?.contentType.startsWith("image/") ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/c/${companyId}/attachments/${file.id}`} alt={file.fileName} className="h-full w-full object-cover" />
                      ) : file ? (
                        <FileText className="size-10 text-muted-foreground" />
                      ) : (
                        <ImageIcon className="size-10 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{d.supplierName || file?.fileName || t("noSupplierYet")}</div>
                      <div className="text-xs text-muted-foreground">{t("uploadedAt", { date: formatDate(d.createdAt, locale) })}</div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
