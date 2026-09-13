import type { Migration } from 'kysely';
import * as init from './001_init.js';

export const migrations: Record<string, Migration> = {
  '001_init': init,
};
