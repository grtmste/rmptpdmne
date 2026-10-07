"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/common/form-field";
import { acceptInvite } from "@/server/actions/members";

export function AcceptInviteButton({ token }: { token: string }) {
  const t = useTranslations("invite");
  const te = useTranslations("errors");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-3">
      <FormError message={error} />
      <Button
        className="w-full"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await acceptInvite({ token });
            if (!res.ok) return setError(te(res.error));
            router.replace(`/c/${res.data.companyId}`);
            router.refresh();
          })
        }
      >
        {t("accept")}
      </Button>
    </div>
  );
}
