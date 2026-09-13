import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { Kysely, Migrator, PostgresDialect, SqliteDialect, sql } from 'kysely';
import pg from 'pg';
import type { Database } from './schema.js';
import { migrations } from './migrations/index.js';

export type Dialect = 'sqlite' | 'postgres';

export interface DatabaseHandle {
  db: Kysely<Database>;
  dialect: Dialect;
  location: string;
  close(): Promise<void>;
}

export function dialectOf(url: string): Dialect {
  return /^postgres(ql)?:/.test(url) ? 'postgres' : 'sqlite';
}

function sqlitePath(url: string): string {
  const stripped = url.replace(/^(sqlite:|file:)(\/\/)?/, '');
  if (stripped === ':memory:') return stripped;
  return resolve(stripped);
}

function maskCredentials(url: string): string {
  return url.replace(/\/\/.*@/, '//***@');
}

export function openDatabase(url: string): DatabaseHandle {
  if (dialectOf(url) === 'postgres') {
    const pool = new pg.Pool({ connectionString: url });
    const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
    return { db, dialect: 'postgres', location: maskCredentials(url), close: () => db.destroy() };
  }
  const file = sqlitePath(url);
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const sqlite = new BetterSqlite3(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  const db = new Kysely<Database>({ dialect: new SqliteDialect({ database: sqlite }) });
  return { db, dialect: 'sqlite', location: file, close: () => db.destroy() };
}

export async function migrateToLatest(db: Kysely<Database>): Promise<string[]> {
  const migrator = new Migrator({
    db,
    provider: { getMigrations: async () => migrations },
  });
  const { error, results } = await migrator.migrateToLatest();
  if (error) throw error instanceof Error ? error : new Error(String(error));
  return (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
}

export async function pingDatabase(db: Kysely<Database>): Promise<boolean> {
  try {
    await sql`select 1`.execute(db);
    return true;
  } catch {
    return false;
  }
}

export async function truncateAll(db: Kysely<Database>): Promise<void> {
  await db.deleteFrom('webhook_deliveries').execute();
  await db.deleteFrom('sms_messages').execute();
  await db.deleteFrom('payment_intents').execute();
  await db.deleteFrom('devices').execute();
  await db.deleteFrom('settings').execute();
}
