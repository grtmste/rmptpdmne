# Pearaamat – raamatupidamistarkvara (Merit Aktiva funktsionaalsusega, oma disainiga)

> Projekti lähteülesanne. Töö käib faasidena – iga faasi lõpus peatu ja oota ülevaatust.
> Faaside plaanid ja tehtud otsused: `docs/`.

---

## 1. Roll ja eesmärk

Oled kogenud full-stack arendaja ja Eesti raamatupidamise ekspert. Ehita veebipõhine **mitme ettevõtte raamatupidamistarkvara** (töönimi: **"Pearaamat"** – võib muuta), mis katab Eesti väikese ja keskmise ettevõtte raamatupidamise: müük, ost, maksed, pearaamat, käibemaks, ladu, põhivara ja aruandlus.

Funktsionaalne eeskuju on Merit Aktiva, **kuid**:
- Ära kopeeri Meriti disaini, paigutust, ikoone, värve, illustratsioone, tekste ega logosid.
- Kasutajaliides peab olema iseseisvalt kujundatud ja äratuntavalt erinev (vt punkt 4).
- Funktsioonid ei pea olema 1:1 – lihtsusta, kus see kasutajale kasulik.

Rakendus deploy'takse **Vercelisse**.

---

## 2. Tehnoloogia

- **Next.js (App Router) + TypeScript** (strict mode)
- **PostgreSQL** (Neon või Supabase) + **Prisma** ORM
- **Auth.js** (e-post + parool, magic link; hiljem Smart-ID/Mobiil-ID võimalus)
- **Tailwind CSS + shadcn/ui** (oma teema), ikoonid **lucide-react**
- **next-intl** – keeled: eesti (vaikimisi), inglise, soome, vene
- **Zod** valideerimiseks, **TanStack Table** tabelitele, **Recharts** graafikutele
- PDF: **@react-pdf/renderer** (arved, pakkumised, aruanded)
- E-post: **Resend**
- Failid (ostuarvete skaneeringud, manused): **Vercel Blob**
- Ajastatud tööd (perioodilised arved, meeldetuletused): **Vercel Cron**
- Testid: **Vitest** (raamatupidamisloogika) + **Playwright** (põhivood)

Rahasummad: **mitte kunagi float**. Kasuta `Decimal` (Prisma `Decimal(18,2)`, kogused `Decimal(18,4)`) ja decimal.js-i arvutustes. Ümardamine pangandusreegliga ühes kohas (`lib/money.ts`).

---

## 3. Mitme kliendi (ettevõtte) haldus – arhitektuur

Kasutaja võib olla raamatupidamisbüroo, kes haldab mitut klientettevõtet.

- **Organisatsioon (büroo)** → omab mitut **Ettevõtet** (klient).
- **Kasutaja** ↔ **Ettevõte** seos rolliga: `OWNER`, `ACCOUNTANT`, `EDITOR`, `VIEWER` (õigused moodulite kaupa).
- Kõik äriandmete tabelid sisaldavad `companyId`; iga päring filtreeritakse selle järgi (Prisma middleware / helper `withCompany()`), et andmed ei saaks ettevõtete vahel lekkida. Kirjuta selle kohta testid.
- **Ettevõtte vahetaja**: otsinguga, viimati kasutatud ettevõtted üleval, "Lisa ettevõte".
- **Ettevõtete koondvaade**: tabel kõigist klientidest – pangasaldo, laekumata müügiarved, tasumata ostuarved, KMD tähtaeg ja staatus, viimane tegevus.
- **Kasutajate haldus**: kutsu kasutaja e-postiga, määra roll ettevõtte kaupa.
- **Audit log**: kes, mida, millal muutis (dokumendid, kanded, seadistused).
- URL struktuur: `/c/[companyId]/...`

---

## 4. Disain (peab erinema Meritist)

- **Vasakpoolne kokkupandav külgmenüü** (mitte ülemine rippmenüü). Moodulid ikoonide ja gruppidega.
- **Käsupalett (Ctrl/Cmd + K)**: kiirotsing dokumentide, klientide, tarnijate, artiklite ja menüüpunktide järgi; kiirtoimingud ("Uus müügiarve", "Uus makse").
- Oma värvipalett (nt sügav roheline/teal + soe neutraalne hall; **mitte** Meriti sinine). Hele ja tume teema.
- Kaardipõhine töölaud, mille vidinaid saab ümber järjestada ja peita.
- Dokumendivaated: vasakul nimekiri, paremal eelvaade (split view); ridade sisestus klaviatuuriga (Tab/Enter liigub järgmisele lahtrile).
- Tühjad olekud omaenda illustratsioonide või lihtsate ikoonidega.
- Mobiilisõbralik (vähemalt vaatamine, makse/arve kiire lisamine, ostuarve foto üleslaadimine).
- Kõik kasutajaliidese tekstid on sinu enda sõnastuses.

---

## 5. Moodulid ja funktsioonid

### 5.1 Töölaud
- Alustamise juhend (checklist): majandusaasta, pangad/kassad, kontoplaan, algsaldod.
- Laekumata müügiarved: summa kokku, sh tähtaeg ületatud; nädalate kaupa graafik (vanemad / möödunud nädalad / jooksev / tulevik).
- Tasumist vajavad ostuarved: sama loogika + kinnitamata ostuarvete arv.
- Kontode info: valitud kontode käive jooksev kuu / aasta algusest.
- Pangad (IBAN, saldo, kiirlingid: maksed, maksekorraldused, väljavõtte import) ja kassad.
- Teated (süsteemi teated, tähtajad: KMD 20. kuupäev, majandusaasta aruanne).

### 5.2 Müük
**Dokumendid:** müügiarved (sh kreeditarve, ettemaksuarve), pakkumised (→ teisendus arveks), perioodilised arved (ajastatud, automaatne saatmine e-postiga), koondarvete koostamine (mitu tellimust/pakkumist → üks arve).
**Püsiandmed:** artiklid (kaup/teenus, ühik, hind, KM määr, kontod), kliendid (registrikood, KMKR nr, aadress, maksetähtaeg, viivis, keel, kliendigrupp).
**Funktsioonid:** viitenumbri genereerimine (Eesti 7-3-1 meetod), PDF ja e-post, e-arve eksport, laekumiste sidumine, viiviste arvestus, saldoteatised ja meeldetuletused (masssaatmine + saatmise logi).
**Aruanded:** müügiaruanne, müügianalüüs (kliendi/artikli/perioodi lõikes), pakkumiste aruanne, kliendivõlgnevused (kuupäeva seisuga ja perioodiline), kliendilaekumised, klientide käibeandmik.

### 5.3 Ost
**Dokumendid:** ostuarved, ostutellimused, kinnitamata ostuarved (sissetulnud e-arved/skaneeritud PDF-id ootavad kinnitust), aruandvate isikute kuluaruanded.
**Püsiandmed:** artiklid (ühised müügiga), tarnijad, aruandvad isikud.
**Funktsioonid:** ostuarve PDF/pildi üleslaadimine ja manusena salvestamine; (hilisem faas) andmete automaatne tuvastamine dokumendilt; pöördkäibemaks EL teenustele/kaupadele.
**Aruanded:** ostuaruanne, ostu- ja maksuvõlgnevused (seisuga, perioodiline, tasumise aruanne), saldoteatised tarnijatele, tarnijate käibeandmik.

### 5.4 Maksed
- Maksed (sissetulevad/väljaminevad) – sidumine arvetega, osaline tasumine, ettemaksed, ühe maksega mitme arve tasumine.
- Pangad ja kassad (mitu, eri valuutad).
- **Pangaväljavõtte import ISO 20022 camt.053 XML** (+ CSV) ja automaatne sobitamine viitenumbri/summa/nime järgi; kasutaja kinnitab.
- **Maksekorralduste eksport pain.001** tasumata ostuarvetest.
- Kassaraamat.
- E-arvete koondfail panka.

### 5.5 Finants
- Pearaamatu kanded (käsitsi kanne, mallid, korduvad kanded, storno).
- Käibedeklaratsioon **KMD + KMD INF** – arvutus kannetest, eksport EMTA e-MTA formaadis (XML).
- Pearaamat, käibeandmik, päevaraamat.
- Bilanss, kasumiaruanne (skeem 1 ja 2), rahavoogude aruanne (kaudne meetod).
- Majandusaasta aruande põhiaruanded (eksport, mida saab e-äriregistrisse sisestada).
- Kassapõhine kontode aruanne.
- Dimensioonide aruanded (perioodiline, ühe dimensiooni lõikes teise järgi).
- Arhiveerimine (perioodi andmete eksport ZIP: PDF-id + CSV + JSON).

### 5.6 Ladu
- Lao liikumised (sissetulek, väljaminek, ümberpaigutus ladude vahel, inventuur).
- Omahinna arvestus (FIFO või kaalutud keskmine – ettevõtte seadistus).
- Aruanded: lao seis, detailne kauba liikumine, lao seisu kontroll, laokaupade analüüs, kaupade käibeandmik.
- Omahinna ja lao koguse ümberarvestus.

### 5.7 Põhivara
- Põhivarade register (grupp, asukoht, vastutaja, soetusmaksumus, kasulik eluiga, jääkväärtus).
- Kuine amortisatsiooni arvestus (lineaarne) → automaatne pearaamatu kanne.
- Mahakandmine, ümberhindamine, ümberklassifitseerimine.
- Aruanded: amortisatsioon, koondaruanne, põhivarade nimekiri.

### 5.8 Seadistused
**Ettevõte:** ettevõtte andmed (nimi, registrikood, KMKR, aadress, logo arvetele), e-arvete ja integratsioonide seadistus, saadetud/vastuvõetud e-arvete aruanne, kasutajad, API võtmed.
**Üldised:** arve seadistus (mall, värvid, jaluse tekst), numbriseeriad (dokumendi tüübi kaupa), müügihinnad ja allahindlused (kliendigrupi/kliendi kaupa), viivise seadistus, saldoteatiste/meeldetuletuste tekstid, püsikommentaarid, mõõtühikud ja teisendused, riigid, valuutad (Eesti Panga/EKP kursid), e-posti seadistused, keel.
**Finants:** kontoplaan (vaikimisi Eesti standardne kontoplaan, muudetav), käibemaksumäärad (**kehtivuskuupäevadega**, mitte koodi sisse kirjutatud), vaikimisi kontod, majandusaastad (avamine/sulgemine, perioodi lukustamine), kasumiaruande seadistus, andmete import (CSV/Excel: kliendid, tarnijad, artiklid, kontoplaan, algsaldod), algsaldod, kande numbrite järjestamine.
**Dimensioonid:** osakonnad, vabad dimensioonid (nt projekt, objekt), põhivarade grupid/asukohad/vastutajad, artikli-, kliendi- ja tarnijagrupid, laod.

### 5.9 API
REST API (`/api/v1/...`) API-võtmega ettevõtte kohta: kliendid, artiklid, müügiarved, ostuarved, maksed, kanded. OpenAPI dokumentatsioon. (Nt e-poe/WooCommerce liidestuseks.)

---

## 6. Raamatupidamise reeglid (kohustuslikud)

1. **Kahekordne kirjendus**: iga kinnitatud dokument (arve, makse, laoliikumine, amortisatsioon) loob automaatselt pearaamatu kande; deebet = kreedit, muidu salvestus ebaõnnestub.
2. **Mustand → Kinnitatud**: kinnitatud dokumenti ei muudeta otse. Parandus käib kreeditarve, storno või tühistamisega (koos audit logiga). Mustandit võib vabalt muuta.
3. **Suletud perioodi** ei saa dokumente lisada ega muuta.
4. KM arvestus ridade kaupa, ümardus dokumendi tasemel, KMD andmed tulevad ainult kannetest.
5. Valuutadokumendid: summa nii dokumendi valuutas kui EUR-is (kurss dokumendi kuupäeval), kursivahed eraldi kontole.
6. Kõik summad ja arvutused on unit-testidega kaetud (arve kogusummad, KM, viivis, viitenumber, amortisatsioon, FIFO, KMD).

---

## 7. Andmemudel (lähtepunkt, täienda vajadusel)

`Organization, User, Membership(role), Company, FiscalYear, Period, Account, VatRate, Currency, ExchangeRate, Dimension, DimensionValue, Customer, CustomerGroup, Supplier, SupplierGroup, Employee(aruandev isik), Item, ItemGroup, Unit, Warehouse, NumberSeries, SalesInvoice(+Line), Quote(+Line), RecurringInvoice, PurchaseInvoice(+Line), PurchaseOrder(+Line), ExpenseReport(+Line), Payment, PaymentAllocation, BankAccount, CashAccount, BankStatement(+Line), JournalEntry(+Line), StockMovement(+Line), StockLayer(FIFO), FixedAsset, DepreciationRun, Attachment, EmailLog, AuditLog, ApiKey, Notification`

Igal äritabelil: `id (cuid)`, `companyId`, `createdAt`, `updatedAt`, `createdById`.

---

## 8. Töö faasid

Tee iga faas lõpuni, käivita testid, kirjelda lühidalt tehtut ja **oota kinnitust** enne järgmist.

| Faas | Sisu |
|---|---|
| 0 | Projekti seadistus, Vercel + Neon, Auth, rollid, ettevõtte vahetaja, külgmenüü, käsupalett, i18n raamistik, disainisüsteem |
| 1 | Seadistused: ettevõtte andmed, kontoplaan, KM määrad, majandusaastad, numbriseeriad, valuutad, dimensioonid, algsaldod |
| 2 | Pearaamat: käsitsi kanded, pearaamat, käibeandmik, päevaraamat |
| 3 | Müük: kliendid, artiklid, müügiarved (PDF, e-post), pakkumised, kreeditarved |
| 4 | Ost: tarnijad, ostuarved (manused), kinnitamata ostuarved, kuluaruanded |
| 5 | Maksed: pangad, kassad, maksete sidumine, camt.053 import, pain.001 eksport, kassaraamat |
| 6 | Aruanded: bilanss, kasumiaruanne, KMD + KMD INF, võlgnevuste ja käibeandmike aruanded, töölaua vidinad |
| 7 | Perioodilised arved, saldoteatised, meeldetuletused, viivised (Vercel Cron) |
| 8 | Ladu |
| 9 | Põhivara |
| 10 | Ettevõtete koondvaade, audit log, andmete import, arhiveerimine, API, e-arved |

---

## 9. Kvaliteedinõuded

- Serveripoolne valideerimine igal toimingul (Server Actions + Zod); kliendipoolne valideerimine ainult mugavuseks.
- Pikkade nimekirjade server-side lehekülgede kaupa laadimine, filtrid ja otsing; eksport CSV/Excel/PDF.
- Andmebaasi migratsioonid Prismaga, seed-skript demoettevõttega (näidisandmed).
- Keskkonnamuutujad dokumenteeritud `.env.example` failis; README koos Verceli deploy juhistega.
- Turvalisus: rate limiting auth- ja API-teekonnal, paroolid räsitud, API võtmed räsitud kujul, kõik ettevõtte andmed `companyId` järgi isoleeritud.
- Ligipääsetavus: klaviatuuriga kasutatav, korralik kontrast.
