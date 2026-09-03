#!/usr/bin/env node
/**
 * sync-changelog -- refresh vendor/CHANGELOG.md from the E-OS working tree.
 *
 * Usage: node scripts/sync-changelog.mjs [--root <dir>]
 *
 * Copies BYTES, not text. The source is CRLF-pinned in the E-OS repository and
 * a text-mode copy is exactly how that pin gets broken (CLAUDE.md P-8).
 * Writes through a .partial file and renames, so an interrupted run cannot
 * leave a zero-length file that looks like an artefact (CLAUDE.md P-4).
 *
 * Exit 0 wrote or already identical, 2 no source to copy from.
 */
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { candidatePaths } from '../src/lib/changelog.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let root = join(HERE, '..');
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--root') { root = argv[i + 1]; i += 1; }
}

const source = candidatePaths(root).find((c) => c.label !== 'vendored' && existsSync(c.path));
if (!source) {
  console.error('sync-changelog: FAIL (instrument) -- no E-OS working tree found; set EOS_REPO');
  process.exit(2);
}

const bytes = readFileSync(source.path);
const target = join(root, 'vendor', 'CHANGELOG.md');
mkdirSync(dirname(target), { recursive: true });

const digest = (b) => createHash('sha256').update(b).digest('hex');
if (existsSync(target) && digest(readFileSync(target)) === digest(bytes)) {
  console.log(`sync-changelog: already identical -- sha256 ${digest(bytes).slice(0, 12)} (${bytes.length} B)`);
  process.exit(0);
}

const partial = `${target}.partial`;
writeFileSync(partial, bytes);
renameSync(partial, target);
console.log(
  `sync-changelog: wrote vendor/CHANGELOG.md from ${source.label} (${source.path}) -- ` +
    `${bytes.length} B, sha256 ${digest(bytes).slice(0, 12)}, crlf=${bytes.includes(13)}`,
);
