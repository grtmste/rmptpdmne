import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/prisma";
import { createCompanyForUser, createUserWithOrganization, wouldRemoveLastOwner } from "@/server/services/accounts";
import { acceptInvitation, createInvitation, findValidInvitation, hashToken, InvitationError } from "@/server/services/invitations";
import { resetDatabase } from "./helpers";

const db = createPrismaClient();
let ownerId: string;
let companyId: string;

beforeAll(async () => {
  await resetDatabase(db);
  const { user, organization } = await createUserWithOrganization(db, {
    email: "owner@test.ee",
    name: "Omanik",
    passwordHash: null,
    locale: "et",
    organizationName: "Büroo",
  });
  ownerId = user.id;
  companyId = (await createCompanyForUser(db, user.id, organization.id, { name: "Kutse OÜ", regCode: null, vatNumber: null })).id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("kutsed", () => {
  it("salvestab ainult tokeni räsi", async () => {
    const { invitation, token } = await createInvitation(db, {
      companyId,
      email: "a@test.ee",
      role: "ACCOUNTANT",
      invitedById: ownerId,
    });
    expect(invitation.tokenHash).toBe(hashToken(token));
    expect(invitation.tokenHash).not.toContain(token);
  });

  it("uus kutse samale e-postile tühistab vana", async () => {
    const first = await createInvitation(db, { companyId, email: "b@test.ee", role: "VIEWER", invitedById: ownerId });
    const second = await createInvitation(db, { companyId, email: "b@test.ee", role: "EDITOR", invitedById: ownerId });
    expect(await findValidInvitation(db, first.token)).toBeNull();
    expect((await findValidInvitation(db, second.token))?.role).toBe("EDITOR");
  });

  it("vastuvõtmine loob liikmesuse ja kutset ei saa uuesti kasutada", async () => {
    const { token } = await createInvitation(db, {
      companyId,
      email: "c@test.ee",
      role: "EDITOR",
      permissions: { purchases: "none" },
      invitedById: ownerId,
    });
    const user = await db.user.create({ data: { email: "c@test.ee" } });
    const result = await acceptInvitation(db, token, user);
    expect(result.companyId).toBe(companyId);
    expect(result.membership.role).toBe("EDITOR");
    expect(result.membership.permissions).toEqual({ purchases: "none" });
    await expect(acceptInvitation(db, token, user)).rejects.toBeInstanceOf(InvitationError);
  });

  it("teise e-postiga kasutaja ei saa kutset vastu võtta", async () => {
    const { token } = await createInvitation(db, { companyId, email: "d@test.ee", role: "VIEWER", invitedById: ownerId });
    const other = await db.user.create({ data: { email: "other@test.ee" } });
    await expect(acceptInvitation(db, token, other)).rejects.toMatchObject({ code: "invitationEmailMismatch" });
  });

  it("aegunud kutse ei kehti", async () => {
    const { invitation, token } = await createInvitation(db, { companyId, email: "e@test.ee", role: "VIEWER", invitedById: ownerId });
    await db.invitation.update({ where: { id: invitation.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await findValidInvitation(db, token)).toBeNull();
  });

  it("olemasolevat liiget ei saa uuesti kutsuda", async () => {
    await expect(
      createInvitation(db, { companyId, email: "owner@test.ee", role: "VIEWER", invitedById: ownerId }),
    ).rejects.toMatchObject({ code: "alreadyMember" });
  });
});

describe("viimane omanik", () => {
  it("ainsat omanikku ei saa alandada ega eemaldada", async () => {
    const m = await db.membership.findFirstOrThrow({ where: { companyId, userId: ownerId } });
    expect(await wouldRemoveLastOwner(db, companyId, m.id, "ACCOUNTANT")).toBe(true);
    expect(await wouldRemoveLastOwner(db, companyId, m.id, null)).toBe(true);
    expect(await wouldRemoveLastOwner(db, companyId, m.id, "OWNER")).toBe(false);
  });

  it("kui omanikke on kaks, võib ühe alandada", async () => {
    const second = await db.user.create({ data: { email: "owner2@test.ee" } });
    await db.membership.create({ data: { userId: second.id, companyId, role: "OWNER" } });
    const m = await db.membership.findFirstOrThrow({ where: { companyId, userId: ownerId } });
    expect(await wouldRemoveLastOwner(db, companyId, m.id, "VIEWER")).toBe(false);
  });
});

describe("ettevõtte loomine", () => {
  it("ainult organisatsiooni ADMIN saab ettevõtet luua", async () => {
    const org = await db.organizationMember.findFirstOrThrow({ where: { userId: ownerId } });
    const outsider = await db.user.create({ data: { email: "outsider@test.ee" } });
    await expect(
      createCompanyForUser(db, outsider.id, org.organizationId, { name: "X", regCode: null, vatNumber: null }),
    ).rejects.toThrow("forbidden");
  });

  it("looja saab omanikuks ja audit logi kirje tekib", async () => {
    const logs = await db.auditLog.findMany({ where: { companyId, action: "company.create" } });
    expect(logs).toHaveLength(1);
    const m = await db.membership.findFirstOrThrow({ where: { companyId, userId: ownerId } });
    expect(m.role).toBe("OWNER");
  });
});
