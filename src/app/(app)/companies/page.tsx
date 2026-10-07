import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowRight, Building2, Plus } from "lucide-react";
import { requireUser } from "@/server/session";
import { canCreateCompany, listUserCompanies } from "@/server/queries/companies";
import { formatDate } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { CompanyAvatar } from "@/components/shell/company-switcher";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("companies");
  return { title: t("listTitle") };
}

/** Ettevõtete valik. Faasis 10 laieneb see koondvaateks (saldod, võlgnevused, KMD staatus). */
export default async function CompaniesPage() {
  const user = await requireUser();
  const t = await getTranslations("companies");
  const tr = await getTranslations("roles");
  const locale = await getLocale();
  const [companies, mayCreate] = await Promise.all([listUserCompanies(user.id), canCreateCompany(user.id)]);

  return (
    <>
      <PageHeader
        title={t("listTitle")}
        description={t("listSubtitle")}
        actions={
          mayCreate && (
            <Button asChild>
              <Link href="/companies/new">
                <Plus /> {t("add")}
              </Link>
            </Button>
          )
        }
      />
      <Card>
        {companies.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={t("emptyTitle")}
            description={t("emptyBody")}
            action={
              mayCreate && (
                <Button asChild>
                  <Link href="/companies/new">
                    <Plus /> {t("add")}
                  </Link>
                </Button>
              )
            }
          />
        ) : (
          <ul className="divide-y">
            {companies.map((c) => (
              <li key={c.id}>
                <Link href={`/c/${c.id}`} className="group flex items-center gap-4 px-5 py-4 hover:bg-muted/50">
                  <CompanyAvatar name={c.name} className="size-10 text-sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{c.name}</span>
                      {c.isDemo && <Badge variant="warning">{t("demo")}</Badge>}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {[c.regCode, tr(c.role)].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div className="hidden text-right text-xs text-muted-foreground sm:block">
                    {c.lastAccessedAt ? t("lastOpened", { date: formatDate(c.lastAccessedAt, locale) }) : t("neverOpened")}
                  </div>
                  <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
