import 'server-only';

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

declare global {
  var __genosPostgresPool: Pool | undefined;
}

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not configured');
  }
  return databaseUrl;
}

function isLocalDatabaseUrl(databaseUrl: string): boolean {
  try {
    const url = new URL(databaseUrl);
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

function shouldUseSsl(databaseUrl: string): boolean {
  if (process.env.POSTGRES_SSL === 'true') return true;
  if (process.env.POSTGRES_SSL === 'false') return false;
  return !isLocalDatabaseUrl(databaseUrl);
}

function boundedIntegerFromEnv(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

export function getPostgresPool(): Pool {
  if (globalThis.__genosPostgresPool) {
    return globalThis.__genosPostgresPool;
  }

  const databaseUrl = requireDatabaseUrl();
  const useSsl = shouldUseSsl(databaseUrl);

  globalThis.__genosPostgresPool = new Pool({
    connectionString: databaseUrl,
    max: boundedIntegerFromEnv('POSTGRES_POOL_MAX', 5, 1, 100),
    idleTimeoutMillis: boundedIntegerFromEnv('POSTGRES_IDLE_TIMEOUT_MS', 30_000, 1_000, 600_000),
    connectionTimeoutMillis: boundedIntegerFromEnv('POSTGRES_CONNECTION_TIMEOUT_MS', 10_000, 1_000, 120_000),
    ssl: useSsl
      ? {
          rejectUnauthorized: process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED !== 'false',
        }
      : undefined,
  });

  return globalThis.__genosPostgresPool;
}

export async function sql<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<QueryResult<T>> {
  return getPostgresPool().query<T>(text, values);
}

export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPostgresPool().connect();

  try {
    await client.query('begin');
    const result = await callback(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
