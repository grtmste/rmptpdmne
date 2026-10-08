import type { Prisma } from "@/generated/prisma/client";
import { formatDocumentNumber } from "@/lib/accounting/numbering";
import { DEFAULT_NUMBER_SERIES } from "@/lib/accounting/templates";

type Tx = Prisma.TransactionClient;
type DocumentType = (typeof DEFAULT_NUMBER_SERIES)[number]["documentType"];

/**
 * Võtab dokumendi järgmise numbri. Loendurit suurendatakse ühe UPDATE-lausega, seega
 * kaks samaaegset tehingut ei saa sama numbrit. Kasuta sama transaktsiooni, milles dokument
 * salvestatakse – tehingu tagasipööramisel jääb number vabaks.
 */
export async function nextDocumentNumber(tx: Tx, companyId: string, documentType: DocumentType, date: Date) {
  let series = await tx.numberSeries.findUnique({ where: { companyId_documentType: { companyId, documentType } } });
  if (!series) {
    const def = DEFAULT_NUMBER_SERIES.find((s) => s.documentType === documentType)!;
    series = await tx.numberSeries.upsert({
      where: { companyId_documentType: { companyId, documentType } },
      create: { companyId, ...def },
      update: {},
    });
  }
  const year = date.getUTCFullYear();
  let n: number;
  if (series.yearBased) {
    const counter = await tx.numberSeriesCounter.upsert({
      where: { companyId_seriesId_year: { companyId, seriesId: series.id, year } },
      create: { companyId, seriesId: series.id, year, nextNumber: 2 },
      update: { nextNumber: { increment: 1 } },
    });
    n = counter.nextNumber - 1;
  } else {
    const updated = await tx.numberSeries.update({
      where: { id: series.id },
      data: { nextNumber: { increment: 1 } },
    });
    n = updated.nextNumber - 1;
  }
  return formatDocumentNumber(series, n, year);
}
