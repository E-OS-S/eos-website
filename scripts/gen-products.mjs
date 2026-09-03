#!/usr/bin/env node
/**
 * gen-products -- writes src/data/products.json from the E-OS build config.
 *
 * Usage: node scripts/gen-products.mjs [--root <dir>] [--check]
 *
 * Inputs (read-only, from the E-OS orchestration repository):
 *   config/x86_64/eos.toml   -- [packages.*] tables and the [packages] table
 *   config/desktop.toml      -- the desktop package set eos.toml includes
 *   repos.toml               -- repository name, type, hosts and pinned rev
 *
 * Why a generator and not a hand-written list: ROADMAP PR-001 exists because
 * three hand-written product lists in this project already disagree with the
 * configuration. This file holds only FACTS (package name, repository, type,
 * pinned revision, recipe path). Every sentence a reader sees comes from the
 * i18n catalogues instead, so a product cannot be described in one language
 * and not the other.
 *
 * `--check` re-generates in memory and fails (exit 1) if the committed file
 * differs -- that is the negative test: change a pin in repos.toml and this
 * gate goes red instead of the website quietly showing the old revision.
 *
 * The payload is PATH-INDEPENDENT on purpose. It records which files it was
 * generated from, never the directory they were read from: a payload carrying
 * an absolute path makes `--check` fail on a second machine with byte-identical
 * configuration, and a red that names a drift which does not exist sends the
 * reader hunting for a stale pin that is fine (CLAUDE.md 13, U-177).
 *
 * EOS_REPO must name the E-OS checkout. There is no default: guessing one
 * laptop's path is how a measurement ends up describing a tree nobody meant to
 * measure (CLAUDE.md 20.1), so an unset EOS_REPO is exit 2, not a guess.
 *
 * Exit 0 pass, 1 drift (with --check), 2 the inputs could not be read.
 */
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const NAME = 'gen-products';
/** Named in the payload instead of the directory it was read from. */
const SOURCE_LABEL = 'E-OS orchestration repository';

let root = join(HERE, '..');
let checkOnly = false;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--root') { root = argv[i + 1]; i += 1; }
  else if (argv[i] === '--check') checkOnly = true;
  else if (argv[i] === '--help' || argv[i] === '-h') {
    console.log('usage: node scripts/gen-products.mjs [--root <dir>] [--check]');
    process.exit(0);
  } else {
    console.error(`${NAME}: FAIL (instrument) -- unknown argument "${argv[i]}"`);
    process.exit(2);
  }
}

const eosRepo = process.env.EOS_REPO;
if (!eosRepo) {
  console.error(
    `${NAME}: FAIL (instrument) -- EOS_REPO is not set; point it at the E-OS orchestration checkout`,
  );
  process.exit(2);
}
const need = (p) => {
  const full = join(eosRepo, p);
  if (!existsSync(full)) {
    console.error(`${NAME}: FAIL (instrument) -- ${full} not found; set EOS_REPO to the E-OS checkout`);
    process.exit(2);
  }
  return readFileSync(full, 'utf8');
};

const eosToml = need('config/x86_64/eos.toml');
const desktopToml = need('config/desktop.toml');
const reposToml = need('repos.toml');

/** Package names from `[packages.<name>]` tables and from the `[packages]` table body. */
function packagesOf(toml) {
  const found = new Set();
  for (const m of toml.matchAll(/^\[packages\.([A-Za-z0-9_.-]+)\]/gm)) found.add(m[1]);
  const body = toml.split(/^\[packages\]\s*$/m)[1];
  if (body) {
    for (const line of body.split('\n')) {
      if (/^\s*\[/.test(line)) break;
      const m = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=\s*(\{|")/);
      if (m && !/=\s*"ignore"/.test(line)) found.add(m[1]);
    }
  }
  return found;
}

const shippedPackages = new Set([...packagesOf(eosToml), ...packagesOf(desktopToml)]);

/** `[[repo]]` blocks from repos.toml, keyed by name. */
function reposOf(toml) {
  const out = new Map();
  const blocks = toml.split(/^\[\[repo\]\]\s*$/m).slice(1);
  for (const block of blocks) {
    const entry = {};
    for (const line of block.split('\n')) {
      if (/^\[/.test(line)) break;
      const m = line.match(/^\s*([a-z_]+)\s*=\s*(?:"([^"]*)"|(true|false))\s*(?:#.*)?$/);
      if (m) entry[m[1]] = m[2] !== undefined ? m[2] : m[3] === 'true';
    }
    if (entry.name) out.set(entry.name, entry);
  }
  return out;
}

const repos = reposOf(reposToml);

/**
 * The curated product list. Package/repository facts are looked up; prose is
 * not here on purpose (see the header). `planned` products have no package and
 * no pin yet -- that is what "planned" means and the page says it.
 */
const CURATED = [
  { id: 'eos-notes',   name: 'E-OS Notes',        status: 'shipped', pkg: 'eos-notes',   repo: 'eos-notes',   roadmap: ['PR-007', 'PR-008', 'PR-009'], caveats: ['no-host-backend', 'no-tests'] },
  { id: 'eos-control', name: 'E-OS Control',      status: 'shipped', pkg: 'eos-control', repo: 'eos-control', roadmap: ['PR-004', 'PR-007', 'PR-009'], caveats: ['no-host-backend', 'no-tests'] },
  { id: 'eos-guard',   name: 'E-OS Guard',        status: 'shipped', pkg: 'eos-guard',   repo: 'eos-guard',   roadmap: ['PR-002', 'PR-004', 'PR-004b'], caveats: ['duplicate-engine', 'no-signature-engine'] },
  { id: 'netsurf',     name: 'NetSurf',           status: 'shipped', pkg: 'netsurf',     repo: null,          roadmap: ['PR-014', 'R-D06'],           caveats: ['netsurf-prebuilt'] },
  { id: 'cosmic-term', name: 'COSMIC Terminal',   status: 'shipped', pkg: 'cosmic-term', repo: null,          roadmap: [],                            caveats: ['upstream-app'] },
  { id: 'eos-sheets',  name: 'E-OS Sheets',       status: 'planned', pkg: null,          repo: null,          roadmap: ['PR-010'],                    caveats: ['not-started'] },
  { id: 'eos-slides',  name: 'E-OS Slides',       status: 'planned', pkg: null,          repo: null,          roadmap: ['PR-011'],                    caveats: ['not-started'] },
  { id: 'eos-drive',   name: 'E-OS Drive',        status: 'planned', pkg: null,          repo: null,          roadmap: ['PR-012', 'CS-001'],          caveats: ['not-started', 'needs-server'] },
  { id: 'eos-store',   name: 'E-OS Store',        status: 'planned', pkg: null,          repo: null,          roadmap: ['PR-013'],                    caveats: ['not-started'] },
];

const products = CURATED.map((p) => {
  const repo = p.repo ? repos.get(p.repo) : null;
  if (p.repo && !repo) {
    console.error(`${NAME}: FAIL (instrument) -- repos.toml has no entry named "${p.repo}"`);
    process.exit(2);
  }
  if (p.status === 'shipped' && p.pkg && !shippedPackages.has(p.pkg)) {
    console.error(`${NAME}: FAIL -- "${p.pkg}" is marked shipped but no [packages] entry declares it`);
    process.exit(1);
  }
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    package: p.pkg,
    inImage: p.status === 'shipped' && Boolean(p.pkg) && shippedPackages.has(p.pkg),
    roadmap: p.roadmap,
    caveats: p.caveats,
    repository: repo
      ? {
          name: repo.name,
          type: repo.type,
          gitlab: repo.gitlab,
          github: repo.github,
          upstream: repo.upstream ?? null,
          recipe: repo.recipe ?? null,
          pinnedBranch: repo.pinned_branch ?? null,
          pinnedRev: repo.pinned_rev ?? null,
        }
      : null,
  };
});

const payload = {
  $comment:
    'GENERATED by scripts/gen-products.mjs from config/x86_64/eos.toml, config/desktop.toml and ' +
    'repos.toml in the E-OS orchestration repository. Do not hand-edit: run the generator. ' +
    'Prose lives in src/i18n/*.json, not here.',
  generatedFrom: {
    // A label, never the absolute path: see the header. The file list is the
    // provenance that matters, and it is the same on every machine.
    source: SOURCE_LABEL,
    files: ['config/x86_64/eos.toml', 'config/desktop.toml', 'repos.toml'],
  },
  packageCount: shippedPackages.size,
  products,
};

const json = `${JSON.stringify(payload, null, 2)}\n`;
const target = join(root, 'src', 'data', 'products.json');

if (checkOnly) {
  if (!existsSync(target)) {
    console.error(`${NAME}: FAIL -- ${target} is missing; run the generator`);
    process.exit(1);
  }
  const current = readFileSync(target, 'utf8');
  if (current !== json) {
    console.error(`${NAME}: FAIL -- src/data/products.json differs from the configuration it claims to come from`);
    process.exit(1);
  }
  console.log(`${NAME}: PASS -- products.json matches ${eosRepo} (${products.length} products, ${shippedPackages.size} packages seen)`);
  process.exit(0);
}

writeFileSync(`${target}.partial`, json);
renameSync(`${target}.partial`, target);
console.log(
  `${NAME}: wrote src/data/products.json -- ${products.length} products ` +
    `(${products.filter((p) => p.status === 'shipped').length} shipped, ` +
    `${products.filter((p) => p.status === 'planned').length} planned), ` +
    `${shippedPackages.size} package entries read`,
);
