# Contributing

Thanks for helping improve Genos.

## Before opening a change

1. Search existing issues and pull requests.
2. Use an issue for behavior changes that need product discussion.
3. Never include credentials, customer data, copied provider responses, or a real `.env.local`.

## Development

```bash
npm ci
cp .env.example .env.local
docker compose up -d postgres
npm run db:migrate
ALLOW_DATABASE_INTEGRATION_TESTS=true npm run db:verify
npm run dev
```

Keep changes focused. Add a forward-only migration for schema changes; never edit a migration that may already be applied. Preserve tenant scoping and idempotency for every data or billing change.

Before submitting:

```bash
npm run lint
npm run typecheck
npm test
ALLOW_DATABASE_INTEGRATION_TESTS=true npm run db:verify
npm run build
```

Add tests for bug fixes and new parsing, matching, validation, billing, or persistence behavior. Do not weaken validation just to make a provider payload pass.

## Pull requests

Describe:

- the problem and user-visible behavior;
- the chosen fix and important tradeoffs;
- schema or environment changes;
- the exact verification performed.

By contributing, you agree that your contribution is licensed under the repository’s license.
