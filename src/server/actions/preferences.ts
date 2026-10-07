"use server";

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { isLocale, LOCALE_COOKIE } from "@/i18n/config";
import { getCurrentUser } from "@/server/session";

export async function setLocale(locale: string): Promise<void> {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  const user = await getCurrentUser();
  if (user && user.locale !== locale) {
    await db.user.update({ where: { id: user.id }, data: { locale } });
  }
}

export async function setSidebarCollapsed(collapsed: boolean): Promise<void> {
  (await cookies()).set("sidebar_collapsed", collapsed ? "1" : "0", {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}
