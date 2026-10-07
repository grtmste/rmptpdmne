import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@/lib/prisma";
import type { CompanyRole, PermissionOverrides } from "@/lib/permissions";

export const INVITATION_TTL_DAYS = 7;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export class InvitationError extends Error {
  constructor(public code: "invitationInvalid" | "invitationEmailMismatch" | "alreadyMember") {
    super(code);
    this.name = "InvitationError";
  }
}

/**
 * Loob kutse. Sama e-posti kehtiv kutse samasse ettevõttesse asendatakse uuega.
 * Tagastab toore tokeni (läheb ainult e-kirja), andmebaasi salvestub räsi.
 */
export async function createInvitation(
  db: PrismaClient,
  input: { companyId: string; email: string; role: CompanyRole; permissions?: PermissionOverrides | null; invitedById: string },
) {
  const existingMember = await db.membership.findFirst({
    where: { companyId: input.companyId, user: { email: input.email } },
    select: { id: true },
  });
  if (existingMember) throw new InvitationError("alreadyMember");

  const token = newToken();
  const invitation = await db.$transaction(async (tx) => {
    await tx.invitation.updateMany({
      where: { companyId: input.companyId, email: input.email, status: "PENDING" },
      data: { status: "REVOKED" },
    });
    return tx.invitation.create({
      data: {
        companyId: input.companyId,
        email: input.email,
        role: input.role,
        permissions: input.permissions ?? undefined,
        tokenHash: hashToken(token),
        invitedById: input.invitedById,
        expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000),
      },
    });
  });
  return { invitation, token };
}

/** Leiab kehtiva kutse tokeni järgi (või null). */
export async function findValidInvitation(db: PrismaClient, token: string) {
  const invitation = await db.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { company: { select: { id: true, name: true, archivedAt: true } } },
  });
  if (!invitation || invitation.status !== "PENDING" || invitation.expiresAt < new Date() || invitation.company.archivedAt) {
    return null;
  }
  return invitation;
}

/** Võtab kutse vastu: kasutaja e-post peab ühtima kutse omaga. */
export async function acceptInvitation(db: PrismaClient, token: string, user: { id: string; email: string }) {
  const invitation = await findValidInvitation(db, token);
  if (!invitation) throw new InvitationError("invitationInvalid");
  if (invitation.email.toLowerCase() !== user.email.toLowerCase()) throw new InvitationError("invitationEmailMismatch");

  return db.$transaction(async (tx) => {
    // Tingimuslik uuendus: sama kutset ei saa kaks korda kasutada.
    const claimed = await tx.invitation.updateMany({
      where: { id: invitation.id, status: "PENDING" },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });
    if (claimed.count !== 1) throw new InvitationError("invitationInvalid");
    const membership = await tx.membership.upsert({
      where: { userId_companyId: { userId: user.id, companyId: invitation.companyId } },
      create: {
        userId: user.id,
        companyId: invitation.companyId,
        role: invitation.role,
        permissions: invitation.permissions ?? undefined,
        lastAccessedAt: new Date(),
      },
      update: {},
    });
    await tx.auditLog.create({
      data: {
        companyId: invitation.companyId,
        userId: user.id,
        action: "membership.accept",
        entityType: "Membership",
        entityId: membership.id,
        diff: { after: { email: user.email, role: invitation.role } },
      },
    });
    return { companyId: invitation.companyId, membership };
  });
}
