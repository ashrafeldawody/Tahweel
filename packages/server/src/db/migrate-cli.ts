import { loadEnv } from '../config/env.js';
import { migrateToLatest, openDatabase } from './connection.js';

const env = loadEnv();
const handle = openDatabase(env.DATABASE_URL);
const applied = await migrateToLatest(handle.db);
console.log(applied.length ? `applied: ${applied.join(', ')}` : 'database is up to date');
await handle.close();
