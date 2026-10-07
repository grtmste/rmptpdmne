"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logout } from "@/server/actions/auth";

export function LogoutButton() {
  const t = useTranslations("shell");
  const [pending, startTransition] = useTransition();
  return (
    <Button variant="ghost" size="sm" disabled={pending} onClick={() => startTransition(() => logout())}>
      <LogOut /> <span className="hidden sm:inline">{t("signOut")}</span>
    </Button>
  );
}
