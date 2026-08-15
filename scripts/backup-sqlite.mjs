import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { backup, DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({
  path: [path.join(rootDir, '.env.local'), path.join(rootDir, '.env')],
  quiet: true,
});

const sourcePath = path.resolve(rootDir, process.env.SQLITE_PATH?.trim() || './data/genos.sqlite3');
const timestamp = new Date().toISOString().replaceAll(':', '-');
const destinationPath = path.resolve(
  process.argv[2] || path.join(rootDir, 'backups', `genos-${timestamp}.sqlite3`)
);

if (sourcePath === destinationPath) {
  throw new Error('Backup destination must differ from SQLITE_PATH');
}

await fs.mkdir(path.dirname(destinationPath), { recursive: true, mode: 0o700 });
const database = new DatabaseSync(sourcePath, { readOnly: true, timeout: 5_000 });
try {
  await backup(database, destinationPath);
  await fs.chmod(destinationPath, 0o600);
  console.log(`SQLite backup created: ${destinationPath}`);
} finally {
  database.close();
}
