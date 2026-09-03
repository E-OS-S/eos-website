#!/usr/bin/env node
/**
 * check-ci — the gate on the pipeline definition.
 *
 * Usage:
 *   node scripts/check-ci.mjs [--root <dir>] [--file <path>] [--json] [--help]
 *
 * The pipeline carries three decisions that are easy to lose in an edit and
 * expensive to lose silently, so they are asserted rather than commented:
 *
 *   1. Every job runs on the self-hosted `eos-heavy` runner (owner decision,
 *      2026-09-03). Shared runners for this account are quota-limited and run
 *      out intermittently; GitHub Actions has never produced a run here. A job
 *      that lands on a shared runner is a job that may simply never execute.
 *   2. No `|| true`, no `allow_failure: true` without a reason in a comment.
 *      A gate that cannot go red is decoration (E-OS CLAUDE.md §13).
 *   3. The `pages` job publishes `public/` as an artefact and asserts that the
 *      directory it publishes is not empty.
 *
 * Findings (exit 1):
 *   [runner]        a job with no eos-heavy tag
 *   [allow-failure] allow_failure: true with no adjacent reason
 *   [swallowed]     `|| true` anywhere in a script line
 *   [pages]         the pages job missing its artefact path or its artefact check
 *
 * Exit 2 when the gate could not run: no file, unparseable YAML, no jobs.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const HERE = dirname(fileURLToPath(import.meta.url));
const NAME = 'check-ci';
const EXIT_OK = 0;
const EXIT_FINDINGS = 1;
const EXIT_INSTRUMENT = 2;
const REQUIRED_TAG = 'eos-heavy';

function die(code, message) {
  console.error(`${NAME}: ${code === EXIT_INSTRUMENT ? 'FAIL (instrument)' : 'FAIL'} -- ${message}`);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = { root: join(HERE, '..'), file: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(
        readFileSync(fileURLToPath(import.meta.url), 'utf8')
          .split('\n')
          .filter((l) => l.startsWith(' *') || l.startsWith('/**'))
          .map((l) => l.replace(/^\/?\*+ ?/, ''))
          .join('\n'),
      );
      process.exit(EXIT_OK);
    } else if (arg === '--root') {
      opts.root = argv[i + 1];
      i += 1;
      if (!opts.root) die(EXIT_INSTRUMENT, '--root needs a directory');
    } else if (arg === '--file') {
      opts.file = argv[i + 1];
      i += 1;
      if (!opts.file) die(EXIT_INSTRUMENT, '--file needs a path');
    } else if (arg === '--json') {
      opts.json = true;
    } else {
      die(EXIT_INSTRUMENT, `unknown argument "${arg}"`);
    }
  }
  return opts;
}

const RESERVED = new Set(['stages', 'default', 'variables', 'include', 'workflow', 'cache', 'image', 'services', 'before_script', 'after_script']);

const { root, file: fileArg, json } = parseArgs(process.argv.slice(2));
const file = fileArg ?? join(root, '.gitlab-ci.yml');
if (!existsSync(file)) die(EXIT_INSTRUMENT, `no pipeline file at ${file}`);

const text = readFileSync(file, 'utf8');
let doc;
try {
  doc = parse(text, { merge: true });
} catch (err) {
  die(EXIT_INSTRUMENT, `${file} is not valid YAML: ${err.message}`);
}
if (!doc || typeof doc !== 'object') die(EXIT_INSTRUMENT, `${file} parsed to nothing`);

const jobs = Object.entries(doc).filter(([k, v]) => !RESERVED.has(k) && !k.startsWith('.') && v && typeof v === 'object');
if (jobs.length === 0) die(EXIT_INSTRUMENT, `${file} declares no jobs`);

const defaultTags = doc.default?.tags ?? [];
const findings = [];
const add = (kind, where, detail) => findings.push({ kind, where, detail });

for (const [name, job] of jobs) {
  const tags = job.tags ?? defaultTags;
  if (!Array.isArray(tags) || !tags.includes(REQUIRED_TAG)) {
    add('runner', name, `runs without the ${REQUIRED_TAG} tag (tags: ${JSON.stringify(tags)})`);
  }
  const scripts = ['before_script', 'script', 'after_script']
    .flatMap((k) => (Array.isArray(job[k]) ? job[k] : job[k] ? [job[k]] : []));
  for (const line of scripts) {
    if (typeof line === 'string' && /\|\|\s*true\b/.test(line)) {
      add('swallowed', name, `\`|| true\` swallows a failure: ${line.trim().slice(0, 80)}`);
    }
  }
}

// allow_failure is permitted, but only with the reason on the same line. The
// rule is checked on the raw text rather than the parsed tree, because the
// reason is a comment and a parser throws comments away.
text.split('\n').forEach((line, i) => {
  if (!/^\s*allow_failure:\s*true\b/.test(line)) return;
  if (!/#\s*\S/.test(line)) {
    add('allow-failure', `${file}:${i + 1}`, 'allow_failure: true with no reason in a comment on the same line');
  }
});

const pages = doc.pages;
if (!pages) {
  add('pages', 'pages', 'no pages job: nothing would be published');
} else {
  const paths = pages.artifacts?.paths ?? [];
  if (!paths.includes('public')) add('pages', 'pages', `artifacts.paths does not publish public/ (${JSON.stringify(paths)})`);
  const script = Array.isArray(pages.script) ? pages.script.join('\n') : String(pages.script ?? '');
  if (!/test\s+-f\s+public\/index\.html/.test(script)) {
    add('pages', 'pages', 'does not assert that public/index.html exists after the build');
  }
  if (!/check:built|check-built/.test(script)) {
    add('pages', 'pages', 'does not run the built-artefact gate before publishing');
  }
}

const stats = { file, jobs: jobs.length, tag: REQUIRED_TAG, findings: findings.length };
if (json) console.log(JSON.stringify({ stats, findings }, null, 2));
else for (const f of findings) console.error(`${NAME}: [${f.kind}] ${f.where} ${f.detail}`);

const onTag = jobs.length - findings.filter((f) => f.kind === 'runner').length;
const summary = `${stats.jobs} jobs · ${onTag}/${stats.jobs} on ${REQUIRED_TAG} · ${stats.findings} findings`;
if (findings.length > 0) {
  console.error(`${NAME}: FAIL -- ${summary}`);
  process.exit(EXIT_FINDINGS);
}
console.log(`${NAME}: PASS -- ${summary}`);
process.exit(EXIT_OK);
