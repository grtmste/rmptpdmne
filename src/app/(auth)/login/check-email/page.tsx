import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MailCheck } from "lucide-react";

export default async function CheckEmailPage({ searchParams }: PageProps<"/login/check-email">) {
  const t = await getTranslations("auth");
  const email = (await searchParams).email;
  return (
    <div className="space-y-5 text-center">
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
        <MailCheck className="size-7" />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">{t("checkEmailTitle")}</h1>
      <p className="text-sm text-muted-foreground">
        {t("checkEmailBody", { email: typeof email === "string" ? email : "" })}
      </p>
      <Link href="/login" className="inline-block text-sm font-medium text-primary hover:underline">
        {t("backToLogin")}
      </Link>
    </div>
  );
}
