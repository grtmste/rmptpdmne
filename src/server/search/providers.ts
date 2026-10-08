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

/** Müügiarved numbri, viitenumbri või kliendi järgi. */
registerSearchProvider({
  id: "salesInvoices",
  module: "sales",
  async search(ctx, query, limit) {
    const rows = await ctx.cdb.salesInvoice.findMany({
      where: {
        OR: [
          { number: { contains: query, mode: "insensitive" } },
          { referenceNumber: { startsWith: query } },
          { customerName: { contains: query, mode: "insensitive" } },
        ],
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: limit,
      select: { id: true, number: true, customerName: true, total: true, currency: true, date: true },
    });
    return rows.map((r) => ({
      id: r.id,
      kind: "invoice",
      title: `${r.number ?? "—"} · ${r.customerName}`,
      subtitle: `${r.date.toISOString().slice(0, 10)} · ${r.total.toFixed(2)} ${r.currency}`,
      href: `/sales/invoices?doc=${r.id}`,
    }));
  },
});

/** Pakkumised numbri või kliendi järgi. */
registerSearchProvider({
  id: "quotes",
  module: "sales",
  async search(ctx, query, limit) {
    const rows = await ctx.cdb.quote.findMany({
      where: {
        OR: [{ number: { contains: query, mode: "insensitive" } }, { customerName: { contains: query, mode: "insensitive" } }],
      },
      orderBy: { date: "desc" },
      take: limit,
      select: { id: true, number: true, customerName: true, date: true },
    });
    return rows.map((r) => ({
      id: r.id,
      kind: "quote",
      title: `${r.number} · ${r.customerName}`,
      subtitle: r.date.toISOString().slice(0, 10),
      href: `/sales/quotes?doc=${r.id}`,
    }));
  },
});

/** Kliendid nime, registrikoodi või e-posti järgi. */
registerSearchProvider({
  id: "customers",
  module: "sales",
  async search(ctx, query, limit) {
    const rows = await ctx.cdb.customer.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { regCode: { startsWith: query } },
          { email: { contains: query, mode: "insensitive" } },
        ],
      },
      orderBy: { name: "asc" },
      take: limit,
      select: { id: true, name: true, regCode: true },
    });
    return rows.map((r) => ({ id: r.id, kind: "customer", title: r.name, subtitle: r.regCode ?? undefined, href: `/sales/customers/${r.id}` }));
  },
});

/** Artiklid koodi või nime järgi. */
registerSearchProvider({
  id: "items",
  module: "sales",
  async search(ctx, query, limit) {
    const rows = await ctx.cdb.item.findMany({
      where: { OR: [{ code: { startsWith: query, mode: "insensitive" } }, { name: { contains: query, mode: "insensitive" } }] },
      orderBy: { code: "asc" },
      take: limit,
      select: { id: true, code: true, name: true },
    });
    return rows.map((r) => ({ id: r.id, kind: "item", title: `${r.code} ${r.name}`, href: `/items?q=${encodeURIComponent(r.code)}` }));
  },
});

/** Ostuarved registreerimis- või tarnija arve numbri või tarnija järgi. */
registerSearchProvider({
  id: "purchaseInvoices",
  module: "purchases",
  async search(ctx, query, limit) {
    const rows = await ctx.cdb.purchaseInvoice.findMany({
      where: {
        OR: [
          { number: { contains: query, mode: "insensitive" } },
          { invoiceNumber: { contains: query, mode: "insensitive" } },
          { supplierName: { contains: query, mode: "insensitive" } },
        ],
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: limit,
      select: { id: true, number: true, invoiceNumber: true, supplierName: true, total: true, currency: true, date: true },
    });
    return rows.map((r) => ({
      id: r.id,
      kind: "purchaseInvoice",
      title: `${r.number ?? "—"} · ${r.supplierName || "?"}${r.invoiceNumber ? ` (${r.invoiceNumber})` : ""}`,
      subtitle: `${r.date.toISOString().slice(0, 10)} · ${r.total.toFixed(2)} ${r.currency}`,
      href: `/purchases/invoices?doc=${r.id}`,
    }));
  },
});

/** Tarnijad nime, registrikoodi või IBAN-i järgi. */
registerSearchProvider({
  id: "suppliers",
  module: "purchases",
  async search(ctx, query, limit) {
    const rows = await ctx.cdb.supplier.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { regCode: { startsWith: query } },
          { bankAccount: { contains: query.replace(/\s+/g, "").toUpperCase() } },
        ],
      },
      orderBy: { name: "asc" },
      take: limit,
      select: { id: true, name: true, regCode: true },
    });
    return rows.map((r) => ({ id: r.id, kind: "supplier", title: r.name, subtitle: r.regCode ?? undefined, href: `/purchases/suppliers/${r.id}` }));
  },
});

export {};
