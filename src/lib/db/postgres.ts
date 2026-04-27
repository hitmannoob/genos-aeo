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

export function getPostgresPool(): Pool {
  if (globalThis.__genosPostgresPool) {
    return globalThis.__genosPostgresPool;
  }

  const databaseUrl = requireDatabaseUrl();
  const useSsl = shouldUseSsl(databaseUrl);

  globalThis.__genosPostgresPool = new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.POSTGRES_POOL_MAX ?? 5),
    idleTimeoutMillis: Number(process.env.POSTGRES_IDLE_TIMEOUT_MS ?? 30_000),
    connectionTimeoutMillis: Number(process.env.POSTGRES_CONNECTION_TIMEOUT_MS ?? 10_000),
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
