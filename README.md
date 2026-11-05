# The True Scholars — app

The logged-in product behind [thetruescholars.com](https://thetruescholars.com): a vetted academic
expert marketplace (Fiverr-style services + Upwork-style jobs with bidding), with escrow, and later
the AI research tools. The public marketing site stays on WordPress.

**Status: Phase 1 — Foundation.** Accounts, the marketplace database, the escrow ledger and Paystack
test payments. Marketplace screens come next (see "Roadmap").

## Stack

| Part | Choice |
| --- | --- |
| Web app | Next.js 15 (App Router, React 19, TypeScript) |
| Styling | Tailwind CSS 4 with The True Scholars brand tokens (`src/app/globals.css`) |
| Database | PostgreSQL via Drizzle ORM (`src/db/schema.ts`, migrations in `drizzle/`) |
| Accounts | Auth.js v5: email + password, optional Google sign-in |
| Payments | Paystack (Mobile Money + cards), GHS |
| Tests | Vitest; escrow tests run on an in-memory PostgreSQL (PGlite) |

## Run it locally

You need Node.js 20 or newer and a PostgreSQL database (a free one from Neon or Supabase works).

```bash
npm install
cp .env.example .env        # then fill in DATABASE_URL, AUTH_SECRET and the Paystack TEST keys
npm run db:migrate          # creates the tables
npm run dev                 # http://localhost:3000
```

Checks:

```bash
npm test          # ledger, escrow and Paystack signature tests
npm run typecheck
npm run build
```

## How money works (escrow)

All amounts are integers in pesewas (GH₵1 = 100). Balances are never stored; they are summed from
`ledger_entries`, a double-entry ledger where every movement sums to zero:

| Movement | Entries |
| --- | --- |
| Client pays a milestone | EXTERNAL −a → ESCROW(milestone) +a |
| Client approves delivery | ESCROW −a → EXPERT_AVAILABLE(expert) +(a − fee), PLATFORM_FEES +fee |
| Refund | ESCROW −a → EXTERNAL +a |
| Dispute split | part released (with fee), rest refunded |
| Expert withdraws | EXPERT_AVAILABLE −a → EXTERNAL +a |

Rules live in `src/lib/ledger.ts` (pure) and `src/server/escrow.ts` (database transactions with row
locks and status checks). Paystack payments are booked once per reference, whether the webhook or the
redirect arrives first. The platform fee is set by `PLATFORM_FEE_BPS` and locked on each order.

> Before taking real money: confirm with a fintech lawyer and Paystack how escrow funds may be held
> under Bank of Ghana rules.

## Paystack setup (test mode)

1. Paystack dashboard → Settings → API Keys & Webhooks → copy the **test** secret and public keys into `.env`.
2. Set the webhook URL to `https://<your app domain>/api/paystack/webhook`.
3. Sign in, open the dashboard and use **Run a test payment** (GH₵1, test mode only).

## Project layout

```
src/
  app/            pages (sign-in, sign-up, dashboard, payments/callback) and API routes
  app/actions/    server actions (auth, payments)
  auth.ts         Auth.js configuration
  components/     Logo, Header, forms
  db/             Drizzle schema and client
  lib/            money, ledger rules, Paystack client
  server/         escrow and payment services
tests/            Vitest suites
drizzle/          SQL migrations
```

## Roadmap

1. **Foundation** — accounts, database, escrow ledger, Paystack test payments ✅
2. **Experts** — vetting application, admin review queue, expert profiles
3. **Services** — create services with Basic/Standard/Pro tiers, browse and search, checkout into escrow
4. **Orders** — order room with messages and files, deliveries, revisions, approval, reviews
5. **Jobs with bidding** — post a job, proposals with bid credits, compare and hire, milestones
6. **Trust & admin** — disputes, moderation, payouts, seller levels
7. **AI tools** — Literature Review, Statistics Assistant (works with Stata), Qualitative Studio
