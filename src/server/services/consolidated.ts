import type { Prisma } from "@/generated/prisma/client";
import { saveInvoiceDraft, SalesError } from "./sales";

/**
 * Koondarve: mitu sama kliendi pakkumist (tellimust) üheks arve mustandiks. Iga pakkumise
 * read tulevad järjest, eraldatuna pakkumise numbriga reaga; pakkumised märgitakse arveks tehtuks.
 */

type Tx = Prisma.TransactionClient;

export async function consolidateQuotes(tx: Tx, companyId: string, userId: string | null, quoteIds: string[], date: Date) {
  const quotes = await tx.quote.findMany({
    where: { companyId, id: { in: quoteIds } },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
    orderBy: [{ date: "asc" }, { number: "asc" }],
  });
  if (quotes.length !== new Set(quoteIds).size) throw new SalesError("quoteNotFound");
  if (quotes.some((q) => q.status === "INVOICED")) throw new SalesError("quoteInvoiced");
  const first = quotes[0]!;
  if (quotes.some((q) => q.customerId !== first.customerId)) throw new SalesError("quotesDifferentCustomers");
  if (quotes.some((q) => q.currency !== first.currency || q.pricesIncludeVat !== first.pricesIncludeVat)) throw new SalesError("quotesCurrency");

  const invoiceId = await saveInvoiceDraft(tx, companyId, userId, {
    type: "INVOICE",
    customerId: first.customerId,
    date,
    currency: first.currency,
    pricesIncludeVat: first.pricesIncludeVat,
    yourReference: [...new Set(quotes.map((q) => q.yourReference).filter(Boolean))].join(", ") || null,
    lines: quotes.flatMap((q) =>
      q.lines.map((l, i) => ({
        itemId: l.itemId,
        code: l.code,
        // Pakkumise number esimese rea kirjeldusse, et arvelt oleks näha päritolu
        description: i === 0 && q.number ? `${q.number}: ${l.description}` : l.description,
        quantity: l.quantity.toString(),
        unit: l.unit,
        unitPrice: l.unitPrice.toString(),
        discountPct: l.discountPct.toString(),
        vatRateId: l.vatRateId,
        accountId: l.accountId,
        departmentId: l.departmentId,
        dimensionValueIds: l.dimensionValueIds,
        unitCost: l.unitCost?.toString() ?? null,
      })),
    ),
  });
  const res = await tx.quote.updateMany({
    where: { companyId, id: { in: quoteIds }, status: { not: "INVOICED" } },
    data: { status: "INVOICED", invoiceId },
  });
  if (res.count !== quotes.length) throw new SalesError("quoteInvoiced");
  return invoiceId;
}
