# Genos

Genos is an open-source answer-engine visibility dashboard. It runs tracked buyer queries across supported AI/search providers, stores the responses and citations, and shows brand visibility, source domains, and competitor presence over time.

## What it does

- Onboards a brand from a public domain with validated website metadata and structured AI extraction.
- Generates editable Awareness, Interest, Consideration, and Purchase queries.
- Runs individual queries or resumable batches across configured providers.
- Tracks response-level brand and competitor presence, citations, domain citations, provider performance, and trends.
- Exports citation data as spreadsheet-safe CSV.
- Uses an idempotent credit ledger for billable actions and refunds reserved credits when an upstream operation fails.
- Keeps application data in PostgreSQL and uses Firebase only for user authentication.

## Stack

- Next.js 16, React 19, TypeScript, and Tailwind CSS 3
- PostgreSQL through `pg`
- Firebase Authentication and Firebase Admin token verification
- TanStack Query for client-side server state
- OpenRouter routing for OpenAI, Google, and Perplexity models
- Optional Sentry error and performance monitoring

## Requirements

- Node.js 20.9 or newer and npm 10 or newer
- PostgreSQL 14 or newer
- A Firebase project with Email/Password and/or Google authentication enabled
- An OpenRouter API key for each signed-in browser

## Local setup

```bash
git clone <your-fork-url>
cd genos-aeo
npm ci
cp .env.example .env.local
```

Start PostgreSQL yourself, or use the included Compose service:

```bash
docker compose up -d postgres
npm run db:migrate
ALLOW_DATABASE_INTEGRATION_TESTS=true npm run db:verify
npm run config:check
npm run dev
```

Open <http://localhost:3000>, sign in with Firebase, and enter your OpenRouter
API key when prompted. The example Compose database URL already matches `.env.example`.

`npm run db:migrate` applies every SQL file in `db/migrations` in filename order. Applied filenames and SHA-256 checksums are recorded in `schema_migrations`; changing an already-applied migration intentionally fails. Add a new migration instead. `npm run db:verify` is restricted to localhost and requires `ALLOW_DATABASE_INTEGRATION_TESTS=true`; it rolls back all test rows.

## Configuration

Copy `.env.example` and replace its placeholders. The main groups are:

| Area | Variables |
| --- | --- |
| PostgreSQL | `DATABASE_URL`, `POSTGRES_SSL`, optional pool settings |
| Firebase client | `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID` |
| Firebase Admin | `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` |
| OpenRouter | Entered by each signed-in user in the browser; optional trusted-service fallback `OPENROUTER_API_KEY` |
| OpenRouter models | Optional `OPENROUTER_OPENAI_MODEL`, `OPENROUTER_GOOGLE_MODEL`, `OPENROUTER_PERPLEXITY_MODEL` |
| Trusted services | `SERVICE_API_SECRET`, optional `ADMIN_API_SECRET` |
| Admin users | comma-separated `ADMIN_EMAILS` |
| Sentry | optional `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, and source-map build credentials |

Never commit `.env.local`, service-account JSON, private keys, or provider credentials.

## Provider roles

| Flow | Providers used when configured |
| --- | --- |
| Company research | OpenAI, Perplexity, and Google when verified website metadata is available |
| Query generation | OpenAI and Google |
| Tracked query execution | OpenAI, Google, and Perplexity |

All provider calls go through OpenRouter using the browser-provided key. A tracked query succeeds when at least one selected provider succeeds. If all providers fail, reserved credits are refunded. Provider response caching is scoped to the authenticated user and successful complete provider sets only.

The default OpenRouter model slugs live in `src/lib/api-providers/provider-manager.ts`. OpenRouter-reported request cost is stored for dashboard reporting.

## Credits and idempotency

Current product credit costs are defined once in `src/lib/billing/creditCosts.ts`:

- Company lookup: 5 credits
- Query generation: 10 credits
- One tracked query execution: 10 credits
- Brand creation: 100 credits

Billable APIs reserve credits transactionally before calling providers. Client request IDs are persisted in `query_execution_requests`, so retries replay completed requests, reject conflicting payloads, and cannot charge twice. Query runs and credit-ledger entries link back to the execution request for auditability.

## Background processing

Batch reprocessing creates durable PostgreSQL job and item rows, leases one runner, and checkpoints after every query. The browser polls the job endpoint; an expired lease can be resumed safely with the same per-query idempotency key. The browser passes the OpenRouter key to the active runner; the job does not persist it.

The included runner uses Next.js `after()` and is appropriate for small deployments whose function duration covers a query. Automatic scheduled processing is intentionally disabled. Larger deployments should invoke the same durable job runner from a queue/worker with a suitable execution timeout.

## Security model

- Browser API requests use revoked-token-aware Firebase Admin verification.
- Provider-backed requests also require `X-OpenRouter-Api-Key`. The key is stored in browser local storage and is not persisted in PostgreSQL or the Firebase user profile.
- Trusted service calls to `/api/user-query` require both `SERVICE_API_SECRET` and `X-Service-User-Id`.
- Admin data-sanity access requires an admin Firebase identity or the separate admin/service secret.
- Every brand, query, run, citation, job, and ledger lookup is tenant-scoped; database constraints reinforce cross-tenant ownership.
- Domain metadata fetching allows public HTTP(S) hosts only, resolves and pins public addresses, limits redirects/body size/time, and blocks private or reserved networks.
- Model outputs are strict-schema validated. Website metadata is treated as untrusted prompt content.
- Markdown rendering does not allow raw HTML, and CSV exports neutralize spreadsheet formulas.

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Development commands

```bash
npm run dev          # development server
npm run dev:clean    # remove only .next, then start development
npm run dev:port     # development server on port 3001
npm run health       # check http://127.0.0.1:3000/
npm run config:check # validate required environment groups without printing secrets
npm run db:migrate   # apply PostgreSQL migrations
npm run db:verify    # verify a local schema; requires explicit opt-in
npm run lint
npm run typecheck
npm test
npm run build
```

## Repository map

```text
db/migrations/          PostgreSQL schema and forward-only migrations
scripts/                Portable maintenance and migration commands
src/app/                App Router pages and authenticated API routes
src/components/         Dashboard and shared UI
src/context/            Auth, brand, theme, toast, and pending-query state
src/lib/analytics/      Server-side corpus analytics
src/lib/api-providers/  Provider clients, normalization, retry, cost, cache
src/lib/billing/        Shared credit costs and server ledger operations
src/lib/db/             PostgreSQL access and transactional workflows
src/lib/prompts/        Prompt construction and strict response parsing
tests/                  Vitest unit tests
```

## Deployment checklist

1. Provision PostgreSQL and run `npm run db:migrate` once per release.
2. Configure Firebase authorized domains and all required environment variables.
3. Use TLS verification for hosted PostgreSQL (`POSTGRES_SSL=true`, `POSTGRES_SSL_REJECT_UNAUTHORIZED=true`).
4. Set long, independent service/admin secrets; do not reuse provider or Firebase keys.
5. Set the platform function duration high enough for the enabled provider timeouts, or move batch execution to a worker.
6. Optionally configure Sentry. Source maps upload only when `SENTRY_AUTH_TOKEN` is present.
7. Run migrations, `npm run db:verify`, lint, typecheck, tests, and the production build in CI.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before opening a pull request.

## License

Genos is available under the [MIT License](LICENSE).
