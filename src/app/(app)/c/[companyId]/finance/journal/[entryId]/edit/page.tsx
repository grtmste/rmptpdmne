import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { toISODate } from "@/lib/accounting/dates";
import { PageHeader } from "@/components/common/page-header";
import { JournalEditor, type EditorLine } from "../../journal-editor";
import { loadEditorData } from "../../editor-data";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("journal");
  return { title: t("editTitle") };
}

export default async function EditJournalEntryPage({ params }: PageProps<"/c/[companyId]/finance/journal/[entryId]/edit">) {
  const { companyId, entryId } = await params;
  const ctx = await requireCompany(companyId, "finance", "edit");
  const t = await getTranslations("journal");
  const entry = await ctx.cdb.journalEntry.findFirst({
    where: { id: entryId },
    include: {
      lines: { orderBy: { sortOrder: "asc" }, include: { dimensions: { include: { value: { select: { dimensionId: true } } } } } },
    },
  });
  if (!entry) notFound();
  // Postitatud kannet ei muudeta – suuname eelvaatesse
  if (entry.status !== "DRAFT") redirect(`/c/${companyId}/finance/journal?entry=${entry.id}`);
  const data = await loadEditorData(ctx);

  const lines: EditorLine[] = entry.lines.map((l) => ({
    key: l.id,
    accountId: l.accountId,
    description: l.description ?? "",
    debit: l.debit.isZero() ? "" : l.debit.toFixed(2),
    credit: l.credit.isZero() ? "" : l.credit.toFixed(2),
    departmentId: l.departmentId ?? "",
    vatRateId: l.vatRateId ?? "",
    vatAmount: l.vatAmount?.toFixed(2) ?? "",
    dims: Object.fromEntries(l.dimensions.map((d) => [d.value.dimensionId, d.dimensionValueId])),
  }));

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={t("editTitle")} description={t("draftSubtitle")} />
      <JournalEditor
        companyId={companyId}
        entryId={entry.id}
        initial={{ date: toISODate(entry.date), description: entry.description ?? "", lines }}
        canPost={can(ctx.membership, "finance", "confirm")}
        {...data}
      />
    </div>
  );
}
