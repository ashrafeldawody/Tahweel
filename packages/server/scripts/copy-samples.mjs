import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, '..', 'src', 'parsers');
const to = join(here, '..', 'dist', 'parsers');
mkdirSync(to, { recursive: true });
for (const file of readdirSync(from)) {
  if (file.endsWith('.samples.json')) cpSync(join(from, file), join(to, file));
}
