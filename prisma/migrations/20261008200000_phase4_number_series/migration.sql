-- Ostuarvete ja kuluaruannete numbriseeriad olemasolevatele ettevõtetele.
INSERT INTO "NumberSeries" ("id", "companyId", "documentType", "prefix", "suffix", "yearBased", "padding", "nextNumber", "createdAt", "updatedAt")
SELECT 'ns' || md5(c."id" || t.doc), c."id", t.doc::"DocumentType", t.prefix, '', false, 0, 1, NOW(), NOW()
FROM "Company" c
CROSS JOIN (VALUES ('PURCHASE_INVOICE', 'OA-'), ('EXPENSE_REPORT', 'KA-')) AS t(doc, prefix)
WHERE EXISTS (SELECT 1 FROM "NumberSeries" s WHERE s."companyId" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "NumberSeries" s WHERE s."companyId" = c."id" AND s."documentType"::text = t.doc);
