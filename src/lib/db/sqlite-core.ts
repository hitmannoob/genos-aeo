import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

export interface DatabaseRow {
  [column: string]: unknown;
}

export interface DatabaseQueryResult<T extends object = DatabaseRow> {
  rows: T[];
  rowCount: number;
}

export interface DatabaseClient {
  query<T extends object = DatabaseRow>(
    text: string,
    values?: unknown[]
  ): Promise<DatabaseQueryResult<T>>;
}

interface SQLiteState {
  database: DatabaseSync;
  lockTail: Promise<void>;
}

declare global {
  var __genosSQLiteState: SQLiteState | undefined;
}

const transactionContext = new AsyncLocalStorage<DatabaseClient>();

const JSON_COLUMNS = new Set([
  'ai_analysis',
  'keywords',
  'last_error',
  'metadata',
  'products_and_services',
  'provider_metadata',
  'providers',
  'raw_citation',
  'raw_metadata',
  'raw_response',
  'raw_result',
  'replay_response',
  'result',
  'token_count',
]);

const BOOLEAN_COLUMNS = new Set([
  'cancellation_requested',
  'contains_brand',
  'is_brand_mention',
  'is_domain_citation',
  'is_new_user',
  'selected',
  'setup_complete',
]);

function requireSQLitePath(): string {
  const configuredPath = process.env.SQLITE_PATH?.trim() || './data/genos.sqlite3';
  return path.resolve(configuredPath);
}

function readBoundedInteger(
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

function createDatabase(): DatabaseSync {
  const database = new DatabaseSync(requireSQLitePath(), {
    timeout: readBoundedInteger('SQLITE_BUSY_TIMEOUT_MS', 5_000, 100, 120_000),
    defensive: true,
  });
  database.exec('pragma foreign_keys = on');
  database.exec('pragma journal_mode = wal');
  database.exec('pragma synchronous = normal');
  database.exec('pragma temp_store = memory');
  return database;
}

function getState(): SQLiteState {
  if (!globalThis.__genosSQLiteState) {
    globalThis.__genosSQLiteState = {
      database: createDatabase(),
      lockTail: Promise.resolve(),
    };
  }
  return globalThis.__genosSQLiteState;
}

function normalizeInput(value: unknown): SQLInputValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value === undefined) {
    return null;
  }
  return JSON.stringify(value);
}

function normalizeRow<T extends object>(row: Record<string, unknown>): T {
  const normalized: Record<string, unknown> = { ...row };
  for (const [column, value] of Object.entries(normalized)) {
    if (BOOLEAN_COLUMNS.has(column) && typeof value === 'number') {
      normalized[column] = value !== 0;
      continue;
    }
    if (JSON_COLUMNS.has(column) && typeof value === 'string') {
      try {
        normalized[column] = JSON.parse(value);
      } catch {
        // Preserve the stored value so callers and data-sanity checks can
        // report malformed historical data instead of hiding it.
      }
    }
  }
  return normalized as T;
}

function translateQuery(text: string, values: unknown[]): {
  text: string;
  values: SQLInputValue[];
} {
  const translatedValues: SQLInputValue[] = [];
  const translatedText = text
    .replace(/::\s*(?:uuid\[\]|jsonb|timestamptz|timestamp|uuid|integer|bigint|numeric|int|text|date)\b/gi, '')
    .replace(/\bbtrim\s*\(/gi, 'trim(')
    .replace(/\bnow\(\)/gi, "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
    .replace(/\s+for\s+update(?:\s+of\s+[a-z_][a-z0-9_]*)?/gi, '')
    .replace(/\$(\d+)/g, (_match, indexText: string) => {
      const index = Number(indexText) - 1;
      if (index < 0 || index >= values.length) {
        throw new Error(`Missing SQL parameter $${indexText}`);
      }
      translatedValues.push(normalizeInput(values[index]));
      return '?';
    });

  return { text: translatedText, values: translatedValues };
}

function executeQuery<T extends object>(
  text: string,
  values: unknown[] = []
): DatabaseQueryResult<T> {
  const state = getState();
  const translated = translateQuery(text, values);
  const statement = state.database.prepare(translated.text);
  const returnsRows = /^\s*(?:select|pragma|explain|with)\b/i.test(translated.text)
    || /\breturning\b/i.test(translated.text);

  if (returnsRows) {
    const rows = statement.all(...translated.values)
      .map((row) => normalizeRow<T>(row as Record<string, unknown>));
    return { rows, rowCount: rows.length };
  }

  const result = statement.run(...translated.values);
  return { rows: [], rowCount: Number(result.changes) };
}

const directClient: DatabaseClient = {
  async query<T extends object = DatabaseRow>(
    text: string,
    values: unknown[] = []
  ): Promise<DatabaseQueryResult<T>> {
    return executeQuery<T>(text, values);
  },
};

async function withDatabaseLock<T>(operation: () => Promise<T>): Promise<T> {
  const state = getState();
  const previous = state.lockTail;
  let release: () => void = () => undefined;
  state.lockTail = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

export async function sql<T extends object = DatabaseRow>(
  text: string,
  values: unknown[] = []
): Promise<DatabaseQueryResult<T>> {
  const activeClient = transactionContext.getStore();
  if (activeClient) {
    return activeClient.query<T>(text, values);
  }
  return withDatabaseLock(() => directClient.query<T>(text, values));
}

export async function withTransaction<T>(
  callback: (client: DatabaseClient) => Promise<T>
): Promise<T> {
  const activeClient = transactionContext.getStore();
  if (activeClient) {
    return callback(activeClient);
  }

  return withDatabaseLock(async () => {
    const database = getState().database;
    database.exec('begin immediate');
    try {
      const result = await transactionContext.run(
        directClient,
        () => callback(directClient)
      );
      database.exec('commit');
      return result;
    } catch (error) {
      database.exec('rollback');
      throw error;
    }
  });
}
