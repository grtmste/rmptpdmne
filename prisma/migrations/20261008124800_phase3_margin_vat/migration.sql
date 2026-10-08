-- Kasuminormi erikorra käibemaksud olemasolevatele ettevõtetele (uued saavad need mallist).
-- Eraldi migratsioonis, sest uut enum-väärtust ei saa kasutada samas tehingus, kus see lisati.

INSERT INTO "VatRate" ("id", "companyId", "code", "name", "nameEn", "kind", "deductiblePct", "invoiceNote", "salesAccountId", "active", "sortOrder", "createdAt", "updatedAt")
SELECT 'vm' || md5(c."id" || t.code), c."id", t.code, t.name, t.name_en, 'MARGIN'::"VatKind", 100, t.note,
       (SELECT a."id" FROM "GlAccount" a WHERE a."companyId" = c."id" AND a."code" = '2300'),
       true, t.sort, NOW(), NOW()
FROM "Company" c
CROSS JOIN (VALUES
  ('KAS', 'Kasutatud kauba erikord', 'Margin scheme – second-hand goods', 'Kasuminormi maksustamise kord – kasutatud kaup, KMS § 41', 20),
  ('REIS', 'Reisiteenuse erikord', 'Margin scheme – travel agents', 'Kasuminormi maksustamise kord – reisiteenus, KMS § 40', 21)
) AS t(code, name, name_en, note, sort)
WHERE EXISTS (SELECT 1 FROM "VatRate" v WHERE v."companyId" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "VatRate" v WHERE v."companyId" = c."id" AND v."code" = t.code);

INSERT INTO "VatRatePeriod" ("id", "companyId", "vatRateId", "rate", "validFrom", "validTo", "createdAt", "updatedAt")
SELECT 'vp' || md5(v."id" || p.valid_from), v."companyId", v."id", p.rate, p.valid_from::date, p.valid_to::date, NOW(), NOW()
FROM "VatRate" v
CROSS JOIN (VALUES
  (20, '2009-07-01', '2023-12-31'),
  (22, '2024-01-01', '2025-06-30'),
  (24, '2025-07-01', NULL)
) AS p(rate, valid_from, valid_to)
WHERE v."kind" = 'MARGIN' AND v."id" LIKE 'vm%'
  AND NOT EXISTS (SELECT 1 FROM "VatRatePeriod" x WHERE x."vatRateId" = v."id");
