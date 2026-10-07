import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MailX, UserPlus } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/server/session";
import { findValidInvitation } from "@/server/services/invitations";
import { Button } from "@/components/ui/button";
import { AcceptInviteButton } from "./accept-button";

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const t = await getTranslations("invite");
  const tr = await getTranslations("roles");
  const invitation = await findValidInvitation(db, token);

  if (!invitation) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <MailX className="size-7" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("invalidTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("invalidBody")}</p>
        <Link href="/" className="inline-block text-sm font-medium text-primary hover:underline">
          {t("toApp")}
        </Link>
      </div>
    );
  }

  const user = await getCurrentUser();
  const callback = `/invite/${token}`;
  const mismatch = user && user.email.toLowerCase() !== invitation.email.toLowerCase();

  return (
    <div className="space-y-5">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
        <UserPlus className="size-7" />
      </div>
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title", { company: invitation.company.name })}</h1>
        <p className="text-sm text-muted-foreground">
          {t("body", { email: invitation.email, role: tr(invitation.role) })}
        </p>
      </div>
      {!user && (
        <div className="grid gap-2">
          <Button asChild>
            <Link href={`/register?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(invitation.email)}`}>
              {t("createAccount")}
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/login?callbackUrl=${encodeURIComponent(callback)}`}>{t("loginExisting")}</Link>
          </Button>
        </div>
      )}
      {user && mismatch && (
        <p role="alert" className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
          {t("mismatch", { current: user.email, invited: invitation.email })}
        </p>
      )}
      {user && !mismatch && <AcceptInviteButton token={token} />}
    </div>
  );
}
