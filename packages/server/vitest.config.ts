import { defineConfig } from 'vitest/config';

const usesPostgres = (process.env.DATABASE_URL ?? '').startsWith('postgres');

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    fileParallelism: !usesPostgres,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
