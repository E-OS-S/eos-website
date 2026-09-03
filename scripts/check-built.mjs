#!/usr/bin/env node
/**
 * check-built — the gate that reads the artefact instead of the exit code.
 *
 * Usage:
 *   node scripts/check-built.mjs [--root <dir>] [--out <dir>] [--json] [--help]
 *
 * `astro build` exiting 0 says a build ran. It does not say the download gate
 * held, that every page still has its landmarks, or that the internal links
 * point at files that exist. Those are properties of the HTML, so they are
 * measured on the HTML (E-OS CLAUDE.md §5.3).
 *
 * Findings (exit 1):
 *   [gate-leak]   a link to a release artefact while downloads.developerOnly
 *                 is true — the one failure that would make the gate a lie
 *   [lang-missing]  <html> without a lang attribute
 *   [landmark]      no <main id="main">, no <footer>, or no <nav>
 *   [skip-link]     no link to #main as the route into the content
 *   [h1-count]      not exactly one <h1> on the page
 *   [dead-link]     an internal href with no file behind it
 *   [locale-gap]    a page that exists in one locale and not in the other
 *
 * Exit 2 — a different code on purpose — when the gate could not run at all:
 *   no output directory, no HTML in it, unreadable configuration. Exit 1 means
 *   the artefact is wrong; exit 2 means the instrument is (CLAUDE.md §13).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, extname, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const NAME = 'check-built';

const EXIT_OK = 0;
const EXIT_FINDINGS = 1;
const EXIT_INSTRUMENT = 2;

function die(code, message) {
  console.error(`${NAME}: ${code === EXIT_INSTRUMENT ? 'FAIL (instrument)' : 'FAIL'} -- ${message}`);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = { root: join(HERE, '..'), out: null, json: false };
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
    } else if (arg === '--out') {
      opts.out = argv[i + 1];
      i += 1;
      if (!opts.out) die(EXIT_INSTRUMENT, '--out needs a directory');
    } else if (arg === '--json') {
      opts.json = true;
    } else {
      die(EXIT_INSTRUMENT, `unknown argument "${arg}"`);
    }
  }
  return opts;
}

function walk(dir, accept, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, accept, out);
    else if (accept(full)) out.push(full);
  }
  return out;
}

/** Release artefacts, by extension. A link to one of these is what the gate withholds. */
const ARTEFACT_EXT = /\.(img|iso|zip|pkgar|tar\.gz|tgz|tar\.zst|sha256|sha256sum|minisig|sig|asc)(\?|#|$)/i;

/** href/src values, with the quote style GitLab Pages will actually serve. */
const ATTR = /\b(?:href|src)\s*=\s*"([^"]*)"/gi;

const main = async () => {
  const { root, out: outArg, json } = parseArgs(process.argv.slice(2));
  const out = outArg ?? join(root, 'public');

  if (!existsSync(out)) {
    die(EXIT_INSTRUMENT, `no build output at ${out}; run \`npm run build\` first`);
  }

  let config;
  try {
    config = await import(pathToFileURL(join(root, 'site.config.mjs')).href);
  } catch (err) {
    die(EXIT_INSTRUMENT, `site.config.mjs could not be read: ${err.message}`);
  }
  const { downloads, base, locales } = config;
  if (!downloads || typeof downloads.developerOnly !== 'boolean') {
    die(EXIT_INSTRUMENT, 'site.config.mjs has no downloads.developerOnly boolean');
  }

  const pages = walk(out, (f) => extname(f) === '.html').sort();
  if (pages.length === 0) die(EXIT_INSTRUMENT, `no .html files under ${out}`);

  const findings = [];
  const add = (kind, file, detail) => findings.push({ kind, file: relative(out, file), detail });

  const prefix = (base ?? '').replace(/\/$/, '');
  const routesByLocale = new Map(locales.map((l) => [l, new Set()]));
  let internalChecked = 0;

  for (const page of pages) {
    const html = readFileSync(page, 'utf8');
    const rel = relative(out, page);

    // ---- locale coverage ---------------------------------------------------
    const m = rel.match(/^([a-z]{2})\//);
    if (m && routesByLocale.has(m[1])) routesByLocale.get(m[1]).add(rel.slice(m[1].length + 1));

    // ---- document-level invariants ----------------------------------------
    if (!/<html[^>]*\blang="[^"]+"/i.test(html)) add('lang-missing', page, '<html> carries no lang');
    if (!/<main[^>]*\bid="main"/i.test(html)) add('landmark', page, 'no <main id="main">');
    if (!/<nav[\s>]/i.test(html)) add('landmark', page, 'no <nav>');
    // The root document is the language chooser: its whole body is the main
    // region, so a skip link would skip nothing and a footer of legal links on
    // a redirect stub is not content. Every other rule still applies to it.
    if (rel !== 'index.html') {
      if (!/<footer[\s>]/i.test(html)) add('landmark', page, 'no <footer>');
      if (!/href="#main"/i.test(html)) add('skip-link', page, 'no link to #main');
    }

    const h1 = (html.match(/<h1[\s>]/gi) ?? []).length;
    if (h1 !== 1) add('h1-count', page, `${h1} <h1> elements, expected exactly 1`);

    // ---- links -------------------------------------------------------------
    for (const attr of html.matchAll(ATTR)) {
      const href = attr[1].trim();
      if (!href || href.startsWith('#') || href.startsWith('data:')) continue;

      const external = /^[a-z][a-z0-9+.-]*:/i.test(href);

      if (downloads.developerOnly && ARTEFACT_EXT.test(href)) {
        add('gate-leak', page, `links a release artefact while the gate is closed: ${href}`);
      }
      for (const artefact of downloads.artefacts ?? []) {
        const needle = typeof artefact === 'string' ? artefact : (artefact.url ?? artefact.file ?? '');
        if (downloads.developerOnly && needle && href.includes(needle)) {
          add('gate-leak', page, `links a withheld artefact: ${href}`);
        }
      }
      if (external) continue;

      // Internal: resolve against the output directory.
      const clean = href.split('#')[0].split('?')[0];
      if (!clean) continue;
      let target;
      if (clean.startsWith('/')) {
        if (prefix && !clean.startsWith(`${prefix}/`) && clean !== prefix) {
          add('dead-link', page, `absolute link outside the configured base: ${href}`);
          continue;
        }
        target = join(out, clean.slice(prefix.length));
      } else {
        target = join(dirname(page), clean);
      }
      internalChecked += 1;
      const ok =
        existsSync(target) &&
        (statSync(target).isFile() || existsSync(join(target, 'index.html')));
      if (!ok) add('dead-link', page, `${href} resolves to nothing at ${relative(out, target)}`);
    }
  }

  // ---- every route in every locale ----------------------------------------
  const union = new Set();
  for (const set of routesByLocale.values()) for (const r of set) union.add(r);
  for (const [locale, set] of routesByLocale) {
    for (const route of union) {
      if (!set.has(route)) {
        add('locale-gap', join(out, locale, route), `${posix.join(locale, route)} exists in another locale only`);
      }
    }
  }

  const stats = {
    pages: pages.length,
    locales: [...routesByLocale.keys()],
    routesPerLocale: union.size,
    internalLinks: internalChecked,
    gate: downloads.developerOnly ? 'closed' : 'open',
    findings: findings.length,
  };

  if (json) {
    console.log(JSON.stringify({ stats, findings }, null, 2));
  } else {
    for (const f of findings) console.error(`${NAME}: [${f.kind}] ${f.file} ${f.detail}`);
  }

  const summary =
    `${stats.pages} pages · ${stats.locales.join('+')} · ${stats.routesPerLocale} routes/locale · ` +
    `${stats.internalLinks} internal links · downloads gate ${stats.gate} · ${stats.findings} findings`;

  if (findings.length > 0) {
    console.error(`${NAME}: FAIL -- ${summary}`);
    process.exit(EXIT_FINDINGS);
  }
  console.log(`${NAME}: PASS -- ${summary}`);
  process.exit(EXIT_OK);
};

main();
