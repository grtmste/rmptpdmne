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

export {};
