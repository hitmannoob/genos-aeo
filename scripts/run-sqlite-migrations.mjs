import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(rootDir, 'db', 'migrations');

dotenv.config({
  path: [path.join(rootDir, '.env.local'), path.join(rootDir, '.env')],
  quiet: true,
});

function databasePath() {
  return path.resolve(rootDir, process.env.SQLITE_PATH?.trim() || './data/genos.sqlite3');
}

function busyTimeout() {
  const raw = process.env.SQLITE_BUSY_TIMEOUT_MS;
  if (raw === undefined) return 5_000;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 100 || value > 120_000) {
    throw new Error('SQLITE_BUSY_TIMEOUT_MS must be an integer between 100 and 120000');
  }
  return value;
}

async function main() {
  const target = databasePath();
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });

  const database = new DatabaseSync(target, {
    timeout: busyTimeout(),
    defensive: true,
  });
  database.exec('pragma foreign_keys = on');
  database.exec('pragma journal_mode = wal');
  database.exec('pragma synchronous = normal');
  database.exec(`
    create table if not exists schema_migrations (
      filename text primary key,
      checksum text not null,
      applied_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ) strict
  `);

  try {
    const files = (await fs.readdir(migrationsDir))
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const migrationSql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
      const checksum = createHash('sha256').update(migrationSql).digest('hex');
      const applied = database.prepare(
        'select checksum from schema_migrations where filename = ? limit 1'
      ).get(file);

      if (applied) {
        if (applied.checksum !== checksum) {
          throw new Error(`Migration checksum mismatch for ${file}`);
        }
        console.log(`Skipping ${file}`);
        continue;
      }

      console.log(`Applying ${file}`);
      database.exec('begin immediate');
      try {
        database.exec(migrationSql);
        database.prepare(
          'insert into schema_migrations (filename, checksum) values (?, ?)'
        ).run(file, checksum);
        database.exec('commit');
      } catch (error) {
        database.exec('rollback');
        throw error;
      }
    }

    console.log(`SQLite migrations are up to date: ${target}`);
    await fs.chmod(target, 0o600);
  } finally {
    database.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
