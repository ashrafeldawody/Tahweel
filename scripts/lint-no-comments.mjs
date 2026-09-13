import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.gradle', '.kotlin', '.idea', 'coverage', 'generated']);
const SKIP_FILES = new Set(['gradlew', 'gradlew.bat', 'gradle-wrapper.properties', 'pnpm-lock.yaml']);
const SLASH_LANGS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.kt', '.kts', '.css']);
const HASH_LANGS = new Set(['.ps1', '.sh', '.yml', '.yaml', '.properties', '.pro', '.gitignore', '.npmrc', '.editorconfig', '.dockerignore', 'Dockerfile']);
const XML_LANGS = new Set(['.xml', '.html', '.svg']);

const LINE_COMMENT = /(^|[^:'"`\\])\/\/(?!\/)/;
const BLOCK_COMMENT = /\/\*(?!\*\/)/;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) yield* walk(full);
    } else {
      yield full;
    }
  }
}

function stripStrings(line) {
  return line
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

function findings(file) {
  const name = file.split(sep).pop();
  const ext = extname(file) || name;
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const hits = [];
  const kind = SLASH_LANGS.has(ext) ? 'slash' : HASH_LANGS.has(ext) || HASH_LANGS.has(name) ? 'hash' : XML_LANGS.has(ext) ? 'xml' : null;
  if (!kind) return hits;
  lines.forEach((raw, index) => {
    const line = raw.trimEnd();
    if (kind === 'slash') {
      const bare = stripStrings(line);
      if (LINE_COMMENT.test(bare) || BLOCK_COMMENT.test(bare) || /^\s*\*\s/.test(bare) || /^\s*\*\//.test(bare)) hits.push(index + 1);
    } else if (kind === 'hash') {
      if (/^\s*#(?!!)/.test(line)) hits.push(index + 1);
    } else if (kind === 'xml') {
      if (line.includes('<!--')) hits.push(index + 1);
    }
  });
  return hits;
}

let total = 0;
for (const file of walk(root)) {
  const name = file.split(sep).pop();
  if (SKIP_FILES.has(name)) continue;
  const hits = findings(file);
  if (hits.length) {
    total += hits.length;
    console.log(`${relative(root, file)}: lines ${hits.join(', ')}`);
  }
}
if (total) {
  console.error(`${total} comment-looking line(s) found`);
  process.exit(1);
}
console.log('no comments found');
