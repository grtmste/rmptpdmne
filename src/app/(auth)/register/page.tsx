import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/session";
import { RegisterForm } from "./register-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("registerTitle") };
}

export default async function RegisterPage({ searchParams }: PageProps<"/register">) {
  const sp = await searchParams;
  const invite = typeof sp.invite === "string" ? sp.invite : undefined;
  const email = typeof sp.email === "string" ? sp.email : undefined;
  if (await getCurrentUser()) redirect(invite ? `/invite/${invite}` : "/");
  const t = await getTranslations("auth");
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">{t("registerTitle")}</h1>
        <p className="text-sm text-muted-foreground">{invite ? t("registerInviteSubtitle") : t("registerSubtitle")}</p>
      </div>
      <RegisterForm inviteToken={invite} defaultEmail={email} />
      <p className="text-center text-sm text-muted-foreground">
        {t("haveAccount")}{" "}
        <Link
          href={invite ? `/login?callbackUrl=${encodeURIComponent(`/invite/${invite}`)}` : "/login"}
          className="font-medium text-primary hover:underline"
        >
          {t("login")}
        </Link>
      </p>
    </div>
  );
}
