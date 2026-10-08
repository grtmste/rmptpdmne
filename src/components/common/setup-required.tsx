"use client";

import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { initializeCompanySetup } from "@/server/actions/settings/accounts";
import { useActionRunner } from "./use-action";

/**
 * Kuvatakse seadistuste lehtedel, kui ettevõttel puudub raamatupidamise põhiseadistus
 * (nt enne faasi 1 loodud ettevõte). Üks nupp loob kontoplaani, KM-määrad jm.
 */
export function SetupRequired({ companyId, canEdit }: { companyId: string; canEdit: boolean }) {
  const t = useTranslations("setup");
  const { pending, run } = useActionRunner();
  return (
    <Card>
      <EmptyState
        icon={Sparkles}
        title={t("title")}
        description={t("body")}
        action={
          canEdit ? (
            <Button disabled={pending} onClick={() => run(() => initializeCompanySetup(companyId, {}), { success: t("done") })}>
              {pending ? t("working") : t("button")}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">{t("askOwner")}</p>
          )
        }
      />
    </Card>
  );
}
