# LILY SOKID

Veebipõhine mitme ettevõtte raamatupidamistarkvara Eesti väike- ja keskmistele ettevõtetele ning
raamatupidamisbüroodele. Lähteülesanne ja tööfaasid: [`CLAUDE.md`](CLAUDE.md). Faaside plaanid: [`docs/`](docs).

**Tehnoloogia:** Next.js 16 (App Router) · TypeScript · PostgreSQL (Neon) + Prisma 7 · Auth.js v5 ·
Tailwind CSS v4 + oma shadcn-stiilis komponendid · next-intl (et, en, fi, ru) · Zod · decimal.js ·
Vitest · Playwright

## Kohalik arendus

Eeldused: Node.js ≥ 20.19, pnpm 10, PostgreSQL 16.

```bash
pnpm install
cp .env.example .env            # täida AUTH_SECRET (openssl rand -base64 32)
createdb lilysokid && createdb lilysokid_test
pnpm db:migrate                 # migratsioonid arendusbaasi
pnpm db:seed                    # demoandmed
pnpm dev                        # http://localhost:3000
```

Demokasutajad (parool `demo-parool-123`):

| E-post | Roll |
|---|---|
| omanik@demo.ee | Omanik |
| raamatupidaja@demo.ee | Raamatupidaja |
| koostaja@demo.ee | Koostaja |
| vaataja@demo.ee | Vaataja |

Ilma `RESEND_API_KEY`-ta kirjutatakse magic lingid ja kutsed serveri logisse.

### Käsud

| Käsk | Mida teeb |
|---|---|
| `pnpm dev` | arendusserver |
| `pnpm build` | toodangu build |
| `pnpm typecheck` | TypeScripti kontroll |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest (unit + integratsioon; vajab `TEST_DATABASE_URL`-i) |
| `pnpm test:e2e` | Playwright (käivitab ise arendusserveri) |
| `pnpm db:migrate` | uus migratsioon / arendusbaasi uuendamine |
| `pnpm db:seed` | demoandmed |

Testandmebaasi migreerimine: `DATABASE_URL=$TEST_DATABASE_URL pnpm prisma migrate deploy`.

## Deploy Vercelisse

1. **Vercel → Add New → Project** ja impordi see GitHubi repo. Framework: Next.js (tuvastatakse ise).
2. **Storage → Create Database → Neon** (Marketplace) ja ühenda projektiga. See lisab `DATABASE_URL`-i
   kõikidesse keskkondadesse. Soovi korral lülita sisse preview-harud (iga preview saab oma andmebaasi haru).
3. **Settings → Environment Variables:**
   - `AUTH_SECRET` – `openssl rand -base64 32`
   - `APP_URL` – nt `https://lily-sokid.vercel.app` (kutselinkide jaoks)
   - `RESEND_API_KEY` ja `EMAIL_FROM` – Resendi võti ja kinnitatud domeeniga saatja
   - `BLOB_READ_WRITE_TOKEN` – Vercel Blob (Storage → Blob → Connect) ostuarvete failidele; ilma selleta hoitakse failid andmebaasis
4. **Deploy.** Vercel käivitab `vercel-build` skripti: `prisma generate` → `prisma migrate deploy` → `next build`,
   seega migratsioonid rakenduvad automaatselt.
5. Demoandmed toodangusse (valikuline): `DATABASE_URL="<neoni url>" pnpm db:seed`.

> Neoni puhul kasuta rakenduse jaoks *pooled* ühendust (host sisaldab `-pooler`). Kui migratsioonid peaksid
> pooleri tõttu ebaõnnestuma, lisa `DATABASE_URL_UNPOOLED` ja käivita migratsioonid sellega.

## Arhitektuur lühidalt

- **URL-id:** `/c/[companyId]/...` – iga ettevõtte vaade. Keel tuleb küpsisest, mitte URL-ist.
- **Andmete eraldamine:** ettevõtte andmeid loetakse ainult `ctx.cdb` kaudu (`src/lib/tenant.ts`), mis lisab
  igale päringule `companyId` tingimuse ja keelab võõra `companyId` kirjutamise. Testid: `tests/integration/tenant.test.ts`.
- **Toimingud:** Server Actionid käivad läbi `companyAction()` (`src/lib/action.ts`): sessioon → liikmesus →
  mooduli õigus → Zod → tegevus → audit.
- **Õigused:** rollid `OWNER`, `ACCOUNTANT`, `EDITOR`, `VIEWER` + erandid mooduli kaupa (`src/lib/permissions.ts`).
- **Raha:** ainult `decimal.js` läbi `src/lib/money.ts`; ümardus aritmeetiline (pool ülespoole).
- **Menüü:** üks definitsioon `src/lib/navigation.ts` – külgmenüü, käsupalett, mobiilimenüü ja „tulekul“ lehed.
- **Audit log:** `audit()` (`src/lib/audit.ts`) salvestab muutunud väljad.
