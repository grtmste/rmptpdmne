"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { companyAction, userAction, ActionError } from "@/lib/action";
import { audit } from "@/lib/audit";
import { sendInvitationEmail } from "@/lib/email";
import { COMPANY_ROLES, permissionOverridesSchema } from "@/lib/permissions";
import { emailSchema } from "@/lib/validation";
import { wouldRemoveLastOwner } from "@/server/services/accounts";
import { acceptInvitation, createInvitation, InvitationError } from "@/server/services/invitations";

function appUrl() {
  return (process.env.APP_URL ?? process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

const inviteSchema = z.object({
  email: emailSchema,
  role: z.enum(COMPANY_ROLES),
  permissions: permissionOverridesSchema,
});

export const inviteMember = companyAction({ module: "users", level: "confirm", schema: inviteSchema }, async (input, ctx) => {
  let result;
  try {
    result = await createInvitation(db, {
      companyId: ctx.company.id,
      email: input.email,
      role: input.role,
      permissions: input.permissions ?? null,
      invitedById: ctx.user.id,
    });
  } catch (e) {
    if (e instanceof InvitationError) throw new ActionError(e.code);
    throw e;
  }
  await sendInvitationEmail(
    input.email,
    `${appUrl()}/invite/${result.token}`,
    ctx.company.name,
    ctx.user.name ?? ctx.user.email,
  );
  await audit({
    companyId: ctx.company.id,
    userId: ctx.user.id,
    action: "membership.invite",
    entityType: "Invitation",
    entityId: result.invitation.id,
    after: { email: input.email, role: input.role },
  });
  revalidatePath(`/c/${ctx.company.id}/settings/users`);
  return { id: result.invitation.id };
});

export const revokeInvitation = companyAction(
  { module: "users", level: "confirm", schema: z.object({ invitationId: z.string().min(1) }) },
  async ({ invitationId }, ctx) => {
    const res = await ctx.cdb.invitation.updateMany({
      where: { id: invitationId, status: "PENDING" },
      data: { status: "REVOKED" },
    });
    if (res.count === 0) throw new ActionError("notFound");
    await audit({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      action: "membership.revokeInvite",
      entityType: "Invitation",
      entityId: invitationId,
    });
    revalidatePath(`/c/${ctx.company.id}/settings/users`);
  },
);

export const updateMember = companyAction(
  {
    module: "users",
    level: "confirm",
    schema: z.object({
      membershipId: z.string().min(1),
      role: z.enum(COMPANY_ROLES),
      permissions: permissionOverridesSchema,
    }),
  },
  async (input, ctx) => {
    const before = await ctx.cdb.membership.findFirst({ where: { id: input.membershipId } });
    if (!before) throw new ActionError("notFound");
    if (await wouldRemoveLastOwner(db, ctx.company.id, input.membershipId, input.role)) {
      throw new ActionError("lastOwner");
    }
    const after = await ctx.cdb.membership.update({
      where: { id: input.membershipId },
      data: { role: input.role, permissions: input.permissions ?? Prisma.DbNull },
    });
    await audit({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      action: "membership.update",
      entityType: "Membership",
      entityId: after.id,
      before: { role: before.role, permissions: before.permissions },
      after: { role: after.role, permissions: after.permissions },
    });
    revalidatePath(`/c/${ctx.company.id}/settings/users`);
  },
);

export const removeMember = companyAction(
  { module: "users", level: "confirm", schema: z.object({ membershipId: z.string().min(1) }) },
  async ({ membershipId }, ctx) => {
    const target = await ctx.cdb.membership.findFirst({
      where: { id: membershipId },
      include: { user: { select: { email: true } } },
    });
    if (!target) throw new ActionError("notFound");
    if (await wouldRemoveLastOwner(db, ctx.company.id, membershipId, null)) throw new ActionError("lastOwner");
    await ctx.cdb.membership.delete({ where: { id: membershipId } });
    await audit({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      action: "membership.remove",
      entityType: "Membership",
      entityId: membershipId,
      before: { email: target.user.email, role: target.role },
    });
    revalidatePath(`/c/${ctx.company.id}/settings/users`);
  },
);

export const acceptInvite = userAction(z.object({ token: z.string().min(1).max(200) }), async ({ token }, user) => {
  try {
    const { companyId } = await acceptInvitation(db, token, user);
    return { companyId };
  } catch (e) {
    if (e instanceof InvitationError) throw new ActionError(e.code);
    throw e;
  }
});
