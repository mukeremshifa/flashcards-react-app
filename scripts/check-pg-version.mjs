#!/usr/bin/env node
/**
 * Compares the Postgres major that the linked Supabase project runs against the
 * major recorded in supabase/pg-version.json (which the test suite pins PGlite to).
 *
 * Run this after any Supabase platform upgrade, and before blaming a migration
 * that passes locally but fails on `db push`.
 *
 *   npm run db:pg-version
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const expected = JSON.parse(
  readFileSync(join(root, 'supabase', 'pg-version.json'), 'utf8'),
);

function readLinkedRef() {
  try {
    return readFileSync(join(root, 'supabase', '.temp', 'project-ref'), 'utf8').trim();
  } catch {
    return null;
  }
}

const ref = readLinkedRef();
if (!ref) {
  console.error('No linked project. Run: npx supabase link --project-ref <ref>');
  process.exit(2);
}

let projects;
try {
  const raw = execFileSync(
    'npx',
    ['--yes', 'supabase', 'projects', 'list', '-o', 'json'],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    },
  );
  const parsed = JSON.parse(raw);
  projects = Array.isArray(parsed) ? parsed : (parsed.projects ?? []);
} catch (error) {
  console.error(
    'Could not reach the Supabase API. Are you logged in (npx supabase login)?',
  );
  console.error(String(error.message ?? error).split('\n')[0]);
  process.exit(2);
}

const project = projects.find(p => p.ref === ref);
if (!project) {
  console.error(`Linked ref ${ref} is not in your project list.`);
  process.exit(2);
}

const liveVersion = project.database?.version ?? '(unknown)';
const liveMajor = Number.parseInt(String(project.database?.postgres_engine ?? ''), 10);

console.log(`project   ${project.name} (${ref}, ${project.region})`);
console.log(`live      Postgres ${liveVersion}  -> major ${liveMajor}`);
console.log(`expected  major ${expected.expectedMajor}  (supabase/pg-version.json)`);

if (liveMajor !== expected.expectedMajor) {
  console.error(
    `\nMISMATCH. Tests run PG ${expected.expectedMajor} via PGlite, production runs ` +
      `PG ${liveMajor}.\n` +
      'Align them before trusting the suite:\n' +
      `  - to follow production: set expectedMajor to ${liveMajor} and install the PGlite ` +
      'line shipping that major (0.4.x = PG 17, 0.5.x = PG 18)\n' +
      '  - to stay put: leave the JSON alone and do not upgrade the project yet',
  );
  process.exit(1);
}

console.log('\nAligned.');
