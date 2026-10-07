# Faas 0 – plaan (ootab kinnitust)

Eesmärk: töötav rakenduse karkass, kuhu järgmised faasid moodulid lisavad. Faasi lõpus saab
registreeruda või sisse logida, luua ettevõtte, vahetada ettevõtete vahel, liikuda külgmenüüs ja
käsupaletis ning vahetada keelt ja teemat. Ettevõtete andmed on üksteisest testidega tõestatult
eraldatud.

---

## 1. Tehnilised valikud ja versioonid

| Teema | Valik | Märkus |
|---|---|---|
| Raamistik | Next.js 16 (App Router), React 19, TypeScript `strict` + `noUncheckedIndexedAccess` | |
| Paketihaldur | pnpm | |
| ORM | Prisma 7 (`prisma-client` generaator, `@prisma/adapter-pg`, `prisma.config.ts`) | Prisma 8 on veel RC |
| Andmebaas | Neon Postgres (toodang + preview-harud), kohalik Postgres 16 arenduseks ja CI jaoks | |
| Auth | Auth.js v5: Credentials (e-post + parool) + Resend magic link, JWT sessioon | Smart-ID hiljem OIDC providerina |
| Paroolid | argon2id (`@node-rs/argon2`) | |
| UI | Tailwind CSS v4, shadcn/ui (oma teema), lucide-react, `cmdk`, `next-themes` | |
| i18n | next-intl, **keel küpsises / kasutaja seadetes, mitte URL-is** | URL jääb `/c/[companyId]/...` |
| Valideerimine | Zod 4, ühised skeemid serveri ja kliendi vahel | |
| Raha | decimal.js, kõik ümardused `src/lib/money.ts` kaudu | vt küsimus 1 |
| Rate limit | Postgres-põhine fikseeritud aken (`RateLimit` tabel) | Upstash saab hiljem asendada |
| Testid | Vitest (unit + integratsioon päris Postgresiga), Playwright (E2E) | |
| CI | GitHub Actions: lint, typecheck, Vitest (Postgres service), Playwright smoke | |

**Nimekonflikt:** Auth.js vajab mudelit `Account` (OAuth/OIDC sidumised, vaja ka Smart-ID jaoks).
Seepärast on pearaamatu konto mudel nimega **`GlAccount`** (tabel `gl_account`).

---

## 2. Kaustastruktuur

```
.
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts                 # demo büroo, 2 ettevõtet, demo kasutajad igas rollis
├── prisma.config.ts
├── messages/                   # et.json (vaikimisi), en.json, fi.json, ru.json
├── src/
│   ├── app/
│   │   ├── (auth)/             # login, register, magic-link kontroll, kutse vastuvõtmine
│   │   ├── (app)/
│   │   │   ├── companies/      # ettevõtete valik + „Lisa ettevõte“ (faasis 10 koondvaade)
│   │   │   └── c/[companyId]/
│   │   │       ├── layout.tsx  # õiguste kontroll, külgmenüü, ülariba, käsupalett
│   │   │       ├── page.tsx    # töölaud (faasis 0 tühi karkass + alustamise juhend)
│   │   │       ├── sales/ purchases/ payments/ finance/
│   │   │       ├── inventory/ assets/ reports/
│   │   │       └── settings/   # faasis 0: ettevõtte põhiandmed, kasutajad ja kutsed
│   │   └── api/
│   │       ├── auth/[...nextauth]/
│   │       ├── cron/           # faas 7
│   │       └── v1/             # faas 10 (REST API)
│   ├── components/
│   │   ├── ui/                 # shadcn komponendid (oma teemaga)
│   │   ├── shell/              # sidebar, topbar, company-switcher, command-palette, user-menu
│   │   └── common/             # page-header, empty-state, data-table, form-field, money-input
│   ├── lib/
│   │   ├── money.ts            # Decimal, ümardus, vormindus – AINUS koht
│   │   ├── db.ts               # Prisma klient (ainult süsteemsed päringud)
│   │   ├── tenant.ts           # companyDb(companyId) – companyId-ga piiratud klient
│   │   ├── auth.ts             # Auth.js konfiguratsioon
│   │   ├── permissions.ts      # rollid × moodulid × tasemed
│   │   ├── navigation.ts       # menüü definitsioon (külgmenüü + käsupalett + mobiil)
│   │   ├── audit.ts            # audit(ctx, action, entity, diff)
│   │   ├── rate-limit.ts
│   │   └── action.ts           # companyAction(): sessioon + õigus + Zod + audit ühes kohas
│   ├── server/
│   │   ├── services/           # domeeniloogika (ei sõltu Next.js-ist, testitav)
│   │   └── queries/            # lugemispäringud lehtedele
│   ├── i18n/                   # next-intl request config, keele valik
│   └── generated/prisma/       # genereeritud Prisma klient (gitignore)
├── tests/
│   ├── unit/                   # money, permissions, navigation
│   ├── integration/            # tenant isolation, auth, kutsed (päris Postgres)
│   └── e2e/                    # Playwright
├── .env.example
└── README.md                   # kohalik arendus + Vercel/Neon deploy
```

---

## 3. Prisma skeemi esimene versioon (faas 0)

Faasis 0 luuakse ainult identiteedi, ligipääsu ja auditi tabelid. Äritabelid (`GlAccount`,
`VatRate`, `FiscalYear` jne) lisanduvad oma faasides eraldi migratsioonidena.

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"   // URL tuleb prisma.config.ts-ist
}

enum OrgRole          { ADMIN MEMBER }
enum CompanyRole      { OWNER ACCOUNTANT EDITOR VIEWER }
enum InvitationStatus { PENDING ACCEPTED REVOKED EXPIRED }

/// Raamatupidamisbüroo või ettevõtte enda „konto“, mis omab ettevõtteid.
model Organization {
  id        String   @id @default(cuid())
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  members   OrganizationMember[]
  companies Company[]
}

model OrganizationMember {
  id             String   @id @default(cuid())
  organizationId String
  userId         String
  role           OrgRole  @default(MEMBER)   // ADMIN võib lisada ettevõtteid
  createdAt      DateTime @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([organizationId, userId])
  @@index([userId])
}

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  emailVerified DateTime?
  name          String?
  image         String?
  passwordHash  String?               // null = ainult magic link
  locale        String    @default("et")
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  accounts       Account[]
  orgMemberships OrganizationMember[]
  memberships    Membership[]
}

/// Auth.js – välised identiteedid (OAuth/OIDC, hiljem Smart-ID).
model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

/// Auth.js – magic linkide tokenid.
model VerificationToken {
  identifier String
  token      String
  expires    DateTime

  @@unique([identifier, token])
}

model Company {
  id             String    @id @default(cuid())
  organizationId String
  name           String
  regCode        String?                         // registrikood
  vatNumber      String?                         // KMKR nr
  countryCode    String    @default("EE") @db.Char(2)
  baseCurrency   String    @default("EUR") @db.Char(3)
  documentLocale String    @default("et")        // dokumentide vaikimisi keel
  isDemo         Boolean   @default(false)
  archivedAt     DateTime?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
  createdById    String?

  organization Organization @relation(fields: [organizationId], references: [id])
  memberships  Membership[]
  invitations  Invitation[]

  @@index([organizationId])
  @@index([regCode])
}

/// Kasutaja ligipääs ettevõttele.
model Membership {
  id             String      @id @default(cuid())
  userId         String
  companyId      String
  role           CompanyRole
  /// Mooduli kaupa erandid rolli vaikeõigustest, nt { "sales": "edit", "settings": "none" }
  permissions    Json?
  lastAccessedAt DateTime?                        // ettevõtte vahetaja „viimati kasutatud“
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt

  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  company Company @relation(fields: [companyId], references: [id], onDelete: Cascade)

  @@unique([userId, companyId])
  @@index([userId, lastAccessedAt(sort: Desc)])
}

model Invitation {
  id          String           @id @default(cuid())
  companyId   String
  email       String
  role        CompanyRole
  permissions Json?
  tokenHash   String           @unique              // token ise läheb ainult e-kirja
  status      InvitationStatus @default(PENDING)
  expiresAt   DateTime
  acceptedAt  DateTime?
  invitedById String
  createdAt   DateTime         @default(now())

  company Company @relation(fields: [companyId], references: [id], onDelete: Cascade)

  @@index([companyId, status])
  @@index([email])
}

/// Muutmatu logi. Ainult INSERT – rakenduses update/delete puudub.
model AuditLog {
  id         String   @id @default(cuid())
  companyId  String?                       // null = kasutaja/süsteemi tasemel sündmus
  userId     String?
  action     String                        // nt "company.update", "membership.invite"
  entityType String
  entityId   String?
  diff       Json?                         // { before, after } muutunud väljad
  ip         String?
  userAgent  String?
  createdAt  DateTime @default(now())

  @@index([companyId, createdAt(sort: Desc)])
  @@index([entityType, entityId])
}

model RateLimit {
  key     String   @id                     // nt "login:ip:1.2.3.4"
  count   Int
  resetAt DateTime
}
```

### Reeglid kõigile järgmiste faaside äritabelitele

- Väljad `id String @id @default(cuid())`, `companyId`, `createdAt`, `updatedAt`, `createdById`.
- `@@unique([companyId, id])` ja **seosed teiste äritabelitega komposiitvõtmega**
  `(companyId, xxxId)`. Nii ei saa näiteks A ettevõtte arve viidata B ettevõtte kliendile isegi
  koodivea korral – andmebaas keelab selle.
- Summad `Decimal @db.Decimal(18, 2)`, kogused ja kursid `Decimal @db.Decimal(18, 4)` /
  `(18, 6)`. Rakenduses ainult `Decimal` (decimal.js), mitte kunagi `number`.
- Kuupäevad, millel pole kellaaega (arve kuupäev, kande kuupäev): `@db.Date`.

---

## 4. Ettevõtete andmete eraldamine

1. **`companyDb(companyId)`** – Prisma Client Extension (Prisma 7-s pole enam `$use` middleware’i).
   Iga äritabeli päringule lisatakse automaatselt `where.companyId`, `create`-le `data.companyId`;
   `findUnique`, `update`, `delete` teisendatakse nii, et teise ettevõtte kirjet ei leita.
   Äritabelite nimekiri tuleb Prisma DMMF-ist (kõik mudelid, millel on `companyId` väli).
2. **`companyAction()`** – kõik ettevõtte Server Actionid käivad läbi selle: sessioon →
   liikmesuse kontroll → mooduli õigus → Zod → tegevus `companyDb` kaudu → audit.
3. **Lint-reegel** keelab `src/app` ja `src/server/services` all toore `db` importi
   (ainult `companyDb`), erandid märgitakse eraldi.
4. **Testid** (integratsioon päris Postgresiga): kaks ettevõtet, kontrollitakse, et `findMany`,
   `findUnique`, `update`, `delete`, `count`, `aggregate` ei näe ega muuda teise ettevõtte
   andmeid; et URL-is teise ettevõtte ID-ga ligipääs annab 404; et rollita kasutaja ei saa
   Server Actionit käivitada.
5. Postgres Row Level Security kui teine kaitsekiht – võimalik lisada hiljem, faasis 0 ei tee.

---

## 5. Rollid ja õigused

Moodulid: `dashboard, sales, purchases, payments, finance, inventory, assets, reports, settings, users`.
Tasemed: `none < view < edit < confirm` (confirm = dokumendi kinnitamine/kandmine, perioodi sulgemine).

| Roll | Äri moodulid | Seadistused | Kasutajad |
|---|---|---|---|
| OWNER | confirm | confirm | haldab |
| ACCOUNTANT | confirm | confirm | – |
| EDITOR | edit (koostab mustandeid) | view | – |
| VIEWER | view | view | – |

`Membership.permissions` võimaldab üksikmooduli kaupa erandit (nt EDITOR, kes näeb ainult müüki).
Ühe funktsiooniga `can(membership, module, level)` kontrollitakse nii serveris kui UI-s
(UI ainult peidab, otsustab server).

---

## 6. Kasutajaliides ja disainisüsteem

**Värvid** (oma palett, Meriti sinist ei kasutata):
- Põhivärv: sügav kuuserohe/teal (`primary` ~ `#0F5C55`, tumedas teemas heledam `#3BB3A3`)
- Neutraalsed: soe kivihall (Tailwind `stone` skaala), taust hele `#FAFAF8`, tume `#141614`
- Rõhuvärv: merevaik (hoiatused, tähtajad), punane ainult vigade/ületatud tähtaegade jaoks
- Kõik värvid CSS muutujatena (`--primary` jne), WCAG AA kontrast mõlemas teemas
- Font: Inter (tabelites `tabular-nums`, et summad joonduks)

**Paigutus:**
- **Vasak külgmenüü** (kokkupandav ikoonireaks, olek meelde jäetud). Üleval ettevõtte vahetaja,
  siis moodulid gruppidena (Töölaud · Müük · Ost · Maksed · Finants · Ladu · Põhivara ·
  Aruanded), all Seadistused ja kasutajamenüü. Moodul avaneb külgmenüüs alamloendiks
  (Dokumendid / Püsiandmed / Aruanded).
- **Ülariba:** leivapuru, otsinguväli „Otsi või tee… ⌘K“, nupp „+ Loo“ (kiirloomine),
  teavitused, teema- ja keelevahetus.
- **Käsupalett (Ctrl/Cmd+K):** menüüpunktid, kiirtoimingud, ettevõtted; arhitektuur
  otsinguallikate registriga, kuhu faasid 3–5 lisavad dokumendid, kliendid, tarnijad, artiklid.
  Kiirklahvid ka „G → M“ (mine müüki) stiilis.
- **Ettevõtte vahetaja:** otsing, viimati kasutatud üleval, „Lisa ettevõte“, klaviatuuriga
  kasutatav. Vahetamine säilitab sama mooduli lehe teises ettevõttes.
- **Mobiil:** külgmenüü muutub sahtliks, alla kiirtoimingute riba (Uus arve, Uus makse, Foto).
- Valmimata moodulid on menüüs nähtavad ja avavad oma tühja oleku lehe („See osa tuleb faasis X“).
- Ühine `menu definition` (`lib/navigation.ts`) toidab külgmenüüd, käsupaletti ja mobiilimenüüd
  ning arvestab õigusi.

---

## 7. Faasi 0 tööde loetelu

1. Projekti alus: Next.js, TS strict, ESLint + Prettier, Tailwind v4, shadcn/ui teema, pnpm.
2. Prisma 7 + migratsioon ülaltoodud skeemiga, seed (demo büroo, 2 ettevõtet, kasutaja igas rollis).
3. Auth.js: registreerimine (loob ka organisatsiooni), parooliga sisselogimine, magic link
   (arenduses link konsooli, toodangus Resend), väljalogimine, rate limit auth-teekonnal.
4. Rollid/õigused (`permissions.ts`) + `companyAction()` + `companyDb()` + audit helper.
5. Rakenduse kest: külgmenüü, ülariba, ettevõtte vahetaja, käsupalett, hele/tume teema, mobiilimenüü.
6. i18n: next-intl, kõik kasutajaliidese tekstid sõnumifailides; et + en täielikult,
   fi + ru minu tõlkes (vajavad emakeelse kõneleja ülevaatust).
7. Lehed: ettevõtete nimekiri, „Lisa ettevõte“, ettevõtte põhiandmed (minimaalne),
   kasutajad ja kutsed (kutse e-postiga, roll, kutse vastuvõtmine), töölaua karkass
   alustamise juhendiga, tühjad olekud teistele moodulitele.
8. `src/lib/money.ts` + testid (alus kõigile järgmistele faasidele).
9. Testid: unit (money, permissions, navigation), integratsioon (tenant isolation, kutsed),
   Playwright (registreerimine → ettevõtte loomine → vahetamine → käsupalett).
10. GitHub Actions CI, `.env.example`, README koos Vercel + Neon juhendiga.

**Mida ma ise teha ei saa:** Verceli projekti ja Neoni andmebaasi loomine sinu kontodel.
README-s on täpsed sammud (Vercel Marketplace’i Neon integratsioon paneb `DATABASE_URL`
automaatselt paika); mina valmistan ette konfiguratsiooni, migratsioonid ja build-käsu.
