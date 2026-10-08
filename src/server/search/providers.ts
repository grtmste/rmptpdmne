import "server-only";
import { registerSearchProvider } from "./registry";

/** Ettevõtte kasutajad (faas 0). Järgmised faasid lisavad siia dokumendid ja püsiandmed. */
registerSearchProvider({
  id: "members",
  module: "users",
  async search(ctx, query, limit) {
    const rows = await ctx.cdb.membership.findMany({
      where: {
        user: {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { email: { contains: query, mode: "insensitive" } },
          ],
        },
      },
      take: limit,
      select: { id: true, role: true, user: { select: { name: true, email: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      kind: "member",
      title: r.user.name ?? r.user.email,
      subtitle: r.user.email,
      href: "/settings/users",
    }));
  },
});

/** Kontoplaan: otsing koodi algusest või nimest. */
registerSearchProvider({
  id: "accounts",
  module: "settings",
  async search(ctx, query, limit) {
    const rows = await ctx.cdb.glAccount.findMany({
      where: {
        active: true,
        OR: [{ code: { startsWith: query } }, { name: { contains: query, mode: "insensitive" } }],
      },
      orderBy: { code: "asc" },
      take: limit,
      select: { id: true, code: true, name: true },
    });
    return rows.map((r) => ({
      id: r.id,
      kind: "account",
      title: `${r.code} ${r.name}`,
      href: "/settings/accounts",
    }));
  },
});

/** Pearaamatu kanded numbri või selgituse järgi. */
registerSearchProvider({
  id: "journal",
  module: "finance",
  async search(ctx, query, limit) {
    const rows = await ctx.cdb.journalEntry.findMany({
      where: {
        OR: [
          { number: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
        ],
      },
      orderBy: { date: "desc" },
      take: limit,
      select: { id: true, number: true, description: true, date: true },
    });
    return rows.map((r) => ({
      id: r.id,
      kind: "entry",
      title: `${r.number ?? "—"} ${r.description ?? ""}`.trim(),
      subtitle: r.date.toISOString().slice(0, 10),
      href: `/finance/journal?entry=${r.id}`,
    }));
  },
});

export {};
