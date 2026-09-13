import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(readFileSync(join(root, 'docs', 'openapi.json'), 'utf8'));
const outDir = join(root, 'postman');
mkdirSync(outDir, { recursive: true });

const SECURITY_HEADERS = {
  IngestToken: { key: 'Authorization', value: 'Bearer {{ingestToken}}' },
  ApiKey: { key: 'X-Api-Key', value: '{{apiKey}}' },
  AdminToken: { key: 'Authorization', value: 'Bearer {{adminToken}}' },
};

function resolve(schema) {
  if (schema && schema.$ref) {
    const name = schema.$ref.split('/').pop();
    return resolve(spec.components.schemas[name]);
  }
  return schema;
}

function exampleFor(schema, depth = 0) {
  const s = resolve(schema);
  if (!s || depth > 6) return null;
  if (s.example !== undefined) return s.example;
  if (s.default !== undefined) return s.default;
  if (s.enum) return s.enum[0];
  if (s.allOf) return Object.assign({}, ...s.allOf.map((part) => exampleFor(part, depth + 1) ?? {}));
  if (s.anyOf || s.oneOf) return exampleFor((s.anyOf ?? s.oneOf)[0], depth + 1);
  switch (s.type) {
    case 'object': {
      const out = {};
      for (const [key, prop] of Object.entries(s.properties ?? {})) {
        const value = exampleFor(prop, depth + 1);
        if (value !== null || (s.required ?? []).includes(key)) out[key] = value;
      }
      return out;
    }
    case 'array':
      return [exampleFor(s.items, depth + 1)].filter((v) => v !== null);
    case 'string':
      return s.format === 'date-time' ? new Date().toISOString() : 'string';
    case 'integer':
    case 'number':
      return s.minimum ?? 1;
    case 'boolean':
      return false;
    default:
      return null;
  }
}

function toPostmanPath(path) {
  return path
    .replace(/\{([^}]+)\}/g, ':$1')
    .split('/')
    .filter(Boolean);
}

function buildRequest(path, method, operation) {
  const headers = [{ key: 'Accept', value: 'application/json' }];
  for (const requirement of operation.security ?? []) {
    for (const scheme of Object.keys(requirement)) {
      if (SECURITY_HEADERS[scheme]) headers.push(SECURITY_HEADERS[scheme]);
    }
  }
  const query = (operation.parameters ?? [])
    .filter((p) => p.in === 'query')
    .map((p) => ({ key: p.name, value: String(exampleFor(p.schema) ?? ''), disabled: !p.required, description: p.description ?? p.schema?.description }));
  const variable = (operation.parameters ?? [])
    .filter((p) => p.in === 'path')
    .map((p) => ({ key: p.name, value: String(exampleFor(p.schema) ?? ''), description: p.description }));
  const enabledQuery = query.filter((q) => !q.disabled);
  const queryString = enabledQuery.length ? `?${enabledQuery.map((q) => `${q.key}=${q.value}`).join('&')}` : '';
  const request = {
    method: method.toUpperCase(),
    header: headers,
    url: { raw: `{{baseUrl}}${path.replace(/\{([^}]+)\}/g, ':$1')}${queryString}`, host: ['{{baseUrl}}'], path: toPostmanPath(path), query, variable },
    description: [operation.summary, operation.description].filter(Boolean).join('\n\n'),
  };
  const body = operation.requestBody?.content?.['application/json']?.schema;
  if (body) {
    headers.push({ key: 'Content-Type', value: 'application/json' });
    request.body = { mode: 'raw', raw: JSON.stringify(exampleFor(body), null, 2), options: { raw: { language: 'json' } } };
  }
  return request;
}

function buildItem(path, method, operation) {
  const item = { name: operation.summary ?? `${method.toUpperCase()} ${path}`, request: buildRequest(path, method, operation), response: [] };
  if (path === '/admin/login') {
    item.event = [
      {
        listen: 'test',
        script: {
          type: 'text/javascript',
          exec: [
            'if (pm.response.code === 200) {',
            '  pm.environment.set("adminToken", pm.response.json().token);',
            '}',
          ],
        },
      },
    ];
  }
  if (path === '/api/v1/intents' && method === 'post') {
    item.event = [
      {
        listen: 'test',
        script: {
          type: 'text/javascript',
          exec: ['if (pm.response.code === 201) {', '  pm.environment.set("intentId", pm.response.json().id);', '}'],
        },
      },
    ];
  }
  return item;
}

const folders = new Map();
for (const [path, methods] of Object.entries(spec.paths)) {
  for (const [method, operation] of Object.entries(methods)) {
    const tag = operation.tags?.[0] ?? 'Other';
    if (!folders.has(tag)) folders.set(tag, []);
    folders.get(tag).push(buildItem(path, method, operation));
  }
}

const collection = {
  info: {
    name: 'Tahweel',
    description: `${spec.info.description}\n\nGenerated from docs/openapi.json by scripts/generate-postman.mjs. Import Tahweel.postman_environment.json and fill in baseUrl, apiKey, ingestToken; run "Exchange the admin password for a JWT" to fill adminToken.`,
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: [...folders.entries()].map(([name, items]) => ({ name, description: spec.tags?.find((t) => t.name === name)?.description, item: items })),
  variable: [{ key: 'baseUrl', value: 'http://localhost:3000' }],
};

const environment = {
  name: 'Tahweel local',
  values: [
    { key: 'baseUrl', value: 'http://localhost:3000', enabled: true },
    { key: 'apiKey', value: '', enabled: true },
    { key: 'ingestToken', value: '', enabled: true },
    { key: 'adminToken', value: '', enabled: true },
    { key: 'adminPassword', value: '', enabled: true },
    { key: 'intentId', value: '', enabled: true },
  ],
  _postman_variable_scope: 'environment',
};

for (const folder of collection.item) {
  for (const item of folder.item) {
    if (item.request.url.path.join('/') === 'admin/login') {
      item.request.body.raw = JSON.stringify({ password: '{{adminPassword}}' }, null, 2);
    }
  }
}

writeFileSync(join(outDir, 'Tahweel.postman_collection.json'), `${JSON.stringify(collection, null, 2)}\n`);
writeFileSync(join(outDir, 'Tahweel.postman_environment.json'), `${JSON.stringify(environment, null, 2)}\n`);
const count = collection.item.reduce((n, folder) => n + folder.item.length, 0);
console.log(`wrote postman collection with ${count} requests in ${collection.item.length} folders`);
