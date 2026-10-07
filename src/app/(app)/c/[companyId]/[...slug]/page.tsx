import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Hammer } from "lucide-react";
import { requireCompany } from "@/server/session";
import { findNavItem, isAvailable, QUICK_ACTIONS } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";

/**
 * „Tulekul“ leht kõigile menüüpunktidele, mille faas pole veel valmis.
 * Tundmatu aadress annab 404.
 */
export default async function ComingSoonPage({ params }: PageProps<"/c/[companyId]/[...slug]">) {
  const { companyId, slug } = await params;
  const path = "/" + slug.join("/");
  const item = findNavItem(path);
  const action = QUICK_ACTIONS.find((a) => a.href.split("?")[0] === path);
  const requiredModule = item?.module ?? action?.module;
  const phase = item?.phase ?? action?.phase;
  if (!requiredModule || phase === undefined || isAvailable(phase)) notFound();

  await requireCompany(companyId, requiredModule);
  const t = await getTranslations("comingSoon");
  const tn = await getTranslations("nav");
  const title = item ? tn(`items.${item.id}`) : tn(`quick.${action!.id}`);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={title} />
      <Card>
        <EmptyState
          icon={Hammer}
          title={t("title")}
          description={t("body", { phase })}
          action={
            <Button variant="outline" asChild>
              <Link href={`/c/${companyId}`}>{t("back")}</Link>
            </Button>
          }
        />
      </Card>
    </div>
  );
}
