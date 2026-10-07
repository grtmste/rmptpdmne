import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/server/session";

/** Juurleht: suunab viimati kasutatud ettevõttesse, ettevõtete valikusse või sisselogimisse. */
export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const memberships = await db.membership.findMany({
    where: { userId: user.id, company: { archivedAt: null } },
    orderBy: [{ lastAccessedAt: { sort: "desc", nulls: "last" } }, { createdAt: "asc" }],
    select: { companyId: true },
    take: 2,
  });
  if (memberships.length === 0) redirect("/companies/new");
  redirect(`/c/${memberships[0]!.companyId}`);
}
