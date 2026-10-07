import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/session";
import { safeRedirect } from "@/lib/validation";
import { LoginForm } from "./login-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("loginTitle") };
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const callbackUrl = safeRedirect(sp.callbackUrl, "/");
  if (await getCurrentUser()) redirect(callbackUrl);
  const t = await getTranslations("auth");
  const error = typeof sp.error === "string" ? sp.error : null;
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">{t("loginTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("loginSubtitle")}</p>
      </div>
      <LoginForm callbackUrl={callbackUrl} initialError={error ? t("linkError") : null} />
    </div>
  );
}
