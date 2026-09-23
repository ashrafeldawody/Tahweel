import type { Migration } from 'kysely';
import * as init from './001_init.js';
import * as reviewHolds from './002_review_holds.js';

export const migrations: Record<string, Migration> = {
  '001_init': init,
  '002_review_holds': reviewHolds,
};
