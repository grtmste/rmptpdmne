"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { MailPlus, MoreHorizontal, ShieldCheck, Trash2, UserPlus, X } from "lucide-react";
import { COMPANY_ROLES, type CompanyRole, type PermissionOverrides } from "@/lib/permissions";
import { initials } from "@/lib/utils";
import type { ActionResult } from "@/lib/action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { FormError, FormField } from "@/components/common/form-field";
import { inviteMember, removeMember, revokeInvitation, updateMember } from "@/server/actions/members";
import { PermissionEditor } from "./permission-editor";

export type MemberRow = {
  id: string;
  name: string | null;
  email: string;
  role: CompanyRole;
  permissions: PermissionOverrides;
  isSelf: boolean;
  lastAccessed: string | null;
};
export type InvitationRow = { id: string; email: string; role: CompanyRole; expires: string };

export function UsersManager({
  companyId,
  members,
  invitations,
  openInvite,
}: {
  companyId: string;
  members: MemberRow[];
  invitations: InvitationRow[];
  openInvite: boolean;
}) {
  const t = useTranslations("users");
  const tr = useTranslations("roles");
  const te = useTranslations("errors");
  const router = useRouter();
  const [inviteOpen, setInviteOpen] = useState(openInvite);
  const [editing, setEditing] = useState<MemberRow | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<ActionResult<unknown>>, success: string) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(te(res.error));
        return;
      }
      toast.success(success);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("members", { count: members.length })}</CardTitle>
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus /> {t("invite")}
          </Button>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <ul className="divide-y border-t">
            {members.map((m) => {
              const overrideCount = Object.keys(m.permissions).length;
              return (
                <li key={m.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
                    {initials(m.name ?? m.email)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{m.name ?? m.email}</span>
                      {m.isSelf && <Badge variant="secondary">{t("you")}</Badge>}
                    </div>
                    <div className="truncate text-sm text-muted-foreground">{m.email}</div>
                  </div>
                  <div className="hidden text-right sm:block">
                    <div className="text-sm">{tr(m.role)}</div>
                    <div className="text-xs text-muted-foreground">
                      {overrideCount > 0 ? t("overrides", { count: overrideCount }) : m.lastAccessed ? t("lastSeen", { date: m.lastAccessed }) : t("neverSeen")}
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={t("actionsFor", { name: m.name ?? m.email })} disabled={pending}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setEditing(m)}>
                        <ShieldCheck /> {t("editAccess")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive data-[highlighted]:text-destructive [&_svg]:text-destructive!"
                        onSelect={() => {
                          if (confirm(t("removeConfirm", { name: m.name ?? m.email }))) {
                            run(() => removeMember(companyId, { membershipId: m.id }), t("removed"));
                          }
                        }}
                      >
                        <Trash2 /> {t("remove")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("pendingInvitations")}</CardTitle>
        </CardHeader>
        <CardContent className={invitations.length ? "px-0 pb-0" : undefined}>
          {invitations.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noInvitations")}</p>
          ) : (
            <ul className="divide-y border-t">
              {invitations.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-5 py-3">
                  <MailPlus className="size-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{i.email}</div>
                    <div className="text-xs text-muted-foreground">
                      {tr(i.role)} · {t("expires", { date: i.expires })}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => run(() => revokeInvitation(companyId, { invitationId: i.id }), t("revoked"))}
                  >
                    <X /> {t("revoke")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onSubmit={async (values) => {
          const res = await inviteMember(companyId, values);
          if (res.ok) {
            toast.success(t("invited", { email: values.email }));
            router.refresh();
          }
          return res;
        }}
      />
      {editing && (
        <AccessDialog
          member={editing}
          onOpenChange={(o) => !o && setEditing(null)}
          onSubmit={async (values) => {
            const res = await updateMember(companyId, { membershipId: editing.id, ...values });
            if (res.ok) {
              toast.success(t("updated"));
              router.refresh();
            }
            return res;
          }}
        />
      )}
    </div>
  );
}

function RoleSelect({ value, onChange }: { value: CompanyRole; onChange: (role: CompanyRole) => void }) {
  const tr = useTranslations("roles");
  return (
    <div className="space-y-2">
      <NativeSelect id="role" value={value} onChange={(e) => onChange(e.target.value as CompanyRole)}>
        {COMPANY_ROLES.map((r) => (
          <option key={r} value={r}>
            {tr(r)}
          </option>
        ))}
      </NativeSelect>
      <p className="text-xs text-muted-foreground">{tr(`descriptions.${value}`)}</p>
    </div>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: { email: string; role: CompanyRole; permissions: PermissionOverrides | null }) => Promise<ActionResult<unknown>>;
}) {
  const t = useTranslations("users");
  const te = useTranslations("errors");
  const tc = useTranslations("common");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<CompanyRole>("ACCOUNTANT");
  const [permissions, setPermissions] = useState<PermissionOverrides>({});
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  function reset() {
    setEmail("");
    setRole("ACCOUNTANT");
    setPermissions({});
    setAdvanced(false);
    setError(null);
    setFieldErrors({});
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-xl" closeLabel={tc("close")}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            setFieldErrors({});
            startTransition(async () => {
              const res = await onSubmit({ email, role, permissions: Object.keys(permissions).length ? permissions : null });
              if (!res.ok) {
                setFieldErrors(res.fieldErrors ?? {});
                if (res.error !== "validation") setError(te(res.error));
                return;
              }
              reset();
              onOpenChange(false);
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("inviteTitle")}</DialogTitle>
            <DialogDescription>{t("inviteBody")}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <FormError message={error} />
            <FormField label={t("email")} htmlFor="invite-email" errors={fieldErrors.email}>
              <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </FormField>
            <FormField label={t("role")} htmlFor="role">
              <RoleSelect value={role} onChange={setRole} />
            </FormField>
            {role !== "OWNER" &&
              (advanced ? (
                <PermissionEditor role={role} value={permissions} onChange={setPermissions} />
              ) : (
                <Button type="button" variant="link" size="sm" onClick={() => setAdvanced(true)}>
                  {t("customizeAccess")}
                </Button>
              ))}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? tc("saving") : t("sendInvite")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AccessDialog({
  member,
  onOpenChange,
  onSubmit,
}: {
  member: MemberRow;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: { role: CompanyRole; permissions: PermissionOverrides | null }) => Promise<ActionResult<unknown>>;
}) {
  const t = useTranslations("users");
  const te = useTranslations("errors");
  const tc = useTranslations("common");
  const [role, setRole] = useState<CompanyRole>(member.role);
  const [permissions, setPermissions] = useState<PermissionOverrides>(member.permissions);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{t("accessTitle", { name: member.name ?? member.email })}</DialogTitle>
          <DialogDescription>{member.email}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <FormError message={error} />
          <FormField label={t("role")} htmlFor="role">
            <RoleSelect value={role} onChange={setRole} />
          </FormField>
          {role !== "OWNER" && <PermissionEditor role={role} value={permissions} onChange={setPermissions} />}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await onSubmit({
                  role,
                  permissions: role !== "OWNER" && Object.keys(permissions).length ? permissions : null,
                });
                if (!res.ok) return setError(te(res.error));
                onOpenChange(false);
              })
            }
          >
            {pending ? tc("saving") : tc("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
