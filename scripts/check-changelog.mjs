#!/usr/bin/env node
/**
 * check-changelog -- the gate for the changelog parser and its source.
 *
 * Usage: node scripts/check-changelog.mjs [--root <dir>] [--help]
 *
 * Three things it can fail on, each independently:
 *
 *   [parser]     built-in fixtures, positive and negative. The negative ones
 *                exist because a parser that only ever parses good input is
 *                not tested (CLAUDE.md 5.4). A malformed heading must NOT
 *                become a release, and a changelog entry containing markup
 *                must come out escaped.
 *   [invariant]  the real source must parse into something that looks like the
 *                E-OS changelog: at least three releases, an Unreleased
 *                section, no empty entries.
 *   [drift]      when EOS_REPO names a reachable E-OS working tree, the
 *                vendored copy must be byte-identical to it. Escape:
 *                EOS_ALLOW_CHANGELOG_DRIFT=1 (it prints both hashes when used).
 *                Without EOS_REPO there is nothing to compare against, and the
 *                summary says `drift not-compared` rather than staying quiet.
 *
 * Exit 0 pass, 1 findings, 2 the check could not run.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseChangelog,
  renderInline,
  readChangelogSource,
  candidatePaths,
} from '../src/lib/changelog.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const NAME = 'check-changelog';
const EXIT_OK = 0;
const EXIT_FINDINGS = 1;
const EXIT_INSTRUMENT = 2;

let root = join(HERE, '..');
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--root') {
    root = argv[i + 1];
    i += 1;
    if (!root) {
      console.error(`${NAME}: FAIL (instrument) -- --root needs a directory`);
      process.exit(EXIT_INSTRUMENT);
    }
  } else if (argv[i] === '--help' || argv[i] === '-h') {
    console.log('usage: node scripts/check-changelog.mjs [--root <dir>]');
    process.exit(EXIT_OK);
  } else {
    console.error(`${NAME}: FAIL (instrument) -- unknown argument "${argv[i]}"`);
    process.exit(EXIT_INSTRUMENT);
  }
}

const findings = [];
const fail = (kind, detail) => findings.push(`[${kind}] ${detail}`);

// ---------------------------------------------------------------- fixtures --
const GOOD = [
  '# Changelog',
  '',
  'Preamble sentence.',
  '',
  '## [Unreleased]',
  '',
  'A note that is not a bullet.',
  '',
  '### Added',
  '- first entry with `code` and **bold**',
  '- second entry',
  '  continued on the next line',
  '',
  '## [0.2.0] - 2026-08-22',
  '',
  '### Fixed',
  '- a fix',
  '',
  '## Before `v0.1.0`',
  '',
  '- inherited history',
].join('\r\n');

{
  const p = parseChangelog(GOOD);
  if (p.releases.length !== 3) fail('parser', `expected 3 releases from the fixture, got ${p.releases.length}`);
  if (!p.releases[0]?.unreleased) fail('parser', 'the first fixture release is not flagged unreleased');
  if (p.releases[1]?.date !== '2026-08-22') fail('parser', `date lost: ${p.releases[1]?.date}`);
  if (p.releases[0]?.notes.length !== 1) fail('parser', 'the non-bullet note under Unreleased was dropped');
  const added = p.releases[0]?.sections[0];
  if (added?.items.length !== 2) fail('parser', `expected 2 items in Added, got ${added?.items.length}`);
  if (!added?.items[1]?.includes('continued on the next line')) {
    fail('parser', 'a continuation line did not join its bullet');
  }
  if (p.counts.items !== 4) fail('parser', `counts.items should be 4, got ${p.counts.items}`);
  if (p.preamble.length === 0) fail('parser', 'the preamble was dropped');
}

// Negative fixture 1: a heading that is not a heading must not create a release.
{
  const BAD = ['##[NotAHeading]', '- an entry'].join('\n');
  const p = parseChangelog(BAD);
  if (p.releases.length !== 0) {
    fail('parser', `"##[NotAHeading]" was accepted as a release (${p.releases.length} found)`);
  }
}

// Negative fixture 2: a section outside any release must not attach anywhere.
{
  const p = parseChangelog(['### Added', '- orphan'].join('\n'));
  if (p.counts.sections !== 0) fail('parser', 'a section before any release was accepted');
}

// Negative fixture 3: markup in an entry must be escaped, links must be sanitised.
{
  const html = renderInline('<script>alert(1)</script> [x](javascript:alert(1)) [ok](https://example.org)');
  if (html.includes('<script')) fail('parser', 'renderInline let a <script> tag through');
  if (/href="javascript:/i.test(html)) fail('parser', 'renderInline kept a javascript: href');
  if (!html.includes('href="https://example.org"')) fail('parser', 'renderInline dropped a safe link');
}

// Negative fixture 4: a bullet-less release must still count as a release.
{
  const p = parseChangelog('## [9.9.9] - 2030-01-01\n');
  if (p.releases.length !== 1) fail('parser', 'an empty release was dropped');
}

// -------------------------------------------------------------- invariants --
let source;
try {
  source = readChangelogSource(root);
} catch (err) {
  console.error(`${NAME}: FAIL (instrument) -- ${err.message}`);
  process.exit(EXIT_INSTRUMENT);
}

if (source.missing) {
  console.error(`${NAME}: FAIL (instrument) -- no changelog source (EOS_ALLOW_MISSING_CHANGELOG=1 is set)`);
  process.exit(EXIT_INSTRUMENT);
}

const parsed = parseChangelog(source.text);
if (parsed.releases.length < 3) {
  fail('invariant', `only ${parsed.releases.length} releases parsed from ${source.path}`);
}
if (!parsed.releases.some((r) => r.unreleased)) {
  fail('invariant', 'no [Unreleased] release found');
}
if (parsed.counts.items < 50) {
  fail('invariant', `only ${parsed.counts.items} entries parsed -- the source has far more`);
}
for (const release of parsed.releases) {
  for (const section of release.sections) {
    for (const item of section.items) {
      if (item.trim() === '') fail('invariant', `empty entry in ${release.version} / ${section.title}`);
    }
  }
}
if (!source.crlf) {
  fail('invariant', `${source.path} has no CRLF -- the E-OS CHANGELOG.md is pinned to CRLF`);
}

// ------------------------------------------------------------------ drift ---
// Only EOS_REPO produces a non-vendored candidate now, so drift is compared
// exactly when somebody names a live tree. The summary line below says which
// of the two happened: a green run that silently skipped the comparison would
// read as "no drift" when it means "not looked at".
const vendored = join(root, 'vendor', 'CHANGELOG.md');
const upstream = candidatePaths(root).find((c) => c.label !== 'vendored' && existsSync(c.path));
let drift = 'not-compared (no EOS_REPO)';
if (upstream && existsSync(vendored)) {
  const a = createHash('sha256').update(readFileSync(upstream.path)).digest('hex');
  const b = createHash('sha256').update(readFileSync(vendored)).digest('hex');
  if (a === b) {
    drift = `none (${upstream.label} == vendored)`;
  } else if (process.env.EOS_ALLOW_CHANGELOG_DRIFT === '1') {
    drift = `allowed by EOS_ALLOW_CHANGELOG_DRIFT=1 -- upstream ${a.slice(0, 12)} vendored ${b.slice(0, 12)}`;
    console.warn(`${NAME}: drift ${drift}`);
  } else {
    drift = 'FOUND';
    fail('drift', `vendor/CHANGELOG.md ${b.slice(0, 12)} != ${upstream.label} ${a.slice(0, 12)} -- run scripts/sync-changelog.mjs`);
  }
} else if (!existsSync(vendored)) {
  drift = 'FOUND';
  fail('drift', 'vendor/CHANGELOG.md is absent -- CI has no source to build from');
}

// ----------------------------------------------------------------- report ---
const summary =
  `${source.origin} · ${source.bytes} B · sha256 ${source.sha256.slice(0, 12)} · ` +
  `crlf=${source.crlf} · ${parsed.counts.releases} releases · ${parsed.counts.sections} sections · ` +
  `${parsed.counts.items} entries · drift ${drift} · ${findings.length} findings`;

for (const f of findings) console.error(`${NAME}: ${f}`);
if (findings.length > 0) {
  console.error(`${NAME}: FAIL -- ${summary}`);
  process.exit(EXIT_FINDINGS);
}
console.log(`${NAME}: PASS -- ${summary}`);
process.exit(EXIT_OK);
