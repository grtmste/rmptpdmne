import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { toISODate } from "@/lib/accounting/dates";
import { todayLocal } from "@/lib/dates";
import { PageHeader } from "@/components/common/page-header";
import { SetupRequired } from "@/components/common/setup-required";
import { JournalEditor } from "../journal-editor";
import { loadEditorData } from "../editor-data";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("journal");
  return { title: t("newTitle") };
}

export default async function NewJournalEntryPage({ params }: PageProps<"/c/[companyId]/finance/journal/new">) {
  const { companyId } = await params;
  const ctx = await requireCompany(companyId, "finance", "edit");
  const t = await getTranslations("journal");
  const data = await loadEditorData(ctx);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={t("newTitle")} description={t("newSubtitle")} />
      {data.accounts.length === 0 ? (
        <SetupRequired companyId={companyId} canEdit={can(ctx.membership, "settings", "edit")} />
      ) : (
        <JournalEditor
          companyId={companyId}
          initial={{ date: toISODate(todayLocal()), description: "", lines: [] }}
          canPost={can(ctx.membership, "finance", "confirm")}
          {...data}
        />
      )}
    </div>
  );
}
