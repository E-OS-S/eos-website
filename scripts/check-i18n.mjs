#!/usr/bin/env node
/**
 * check-i18n — the gate that keeps every visible string in a catalogue.
 *
 * Usage:
 *   node scripts/check-i18n.mjs [--root <dir>] [--json] [--help]
 *
 * It fails (exit 1) on any of:
 *   [key-missing]     a key present in one catalogue and absent from another
 *   [key-empty]       a key whose value is an empty string / empty array
 *   [key-unknown]     t('x') / list('x') in source, no such key in the catalogues
 *   [key-unused]      a catalogue key nothing references
 *   [literal-text]    a bare string literal in a text position in a component
 *   [literal-attr]    a bare string in aria-label / alt / title / placeholder,
 *                     in either quote style and in `attr={…}` expression form
 *   [literal-expr]    a string literal inside an `{…}` expression that renders
 *                     as visible text, e.g. `<p>{cond ? 'Yes' : 'No'}</p>`
 *
 * It exits 2 — a different code on purpose — when it could not run at all:
 *   no catalogues, no pages, unreadable root. Exit 1 means "the tree is
 *   broken"; exit 2 means "the instrument is broken". Reacting to them the
 *   same way is how a silent gate happens (CLAUDE.md 13, U-177).
 *
 * Escapes, all explicit and all visible in a diff:
 *   - `data-i18n-literal` on an element exempts that element's own text
 *     (used for code samples and for the wordmark).
 *   - `/* i18n-literal *\/` immediately before a string literal inside an
 *     expression exempts that one literal.
 *   - a literal inside a `t()` / `list()` / `entries()` call that carries no
 *     whitespace is a catalogue key or a single identifier fed into a
 *     translated sentence, and is exempt. A MULTI-WORD value in the same
 *     position is still reported: a phrase belongs in the catalogue.
 *   - `// i18n-dynamic: some.prefix.` in any scanned source file marks a key
 *     prefix as referenced dynamically, so [key-unused] does not fire on it.
 *
 * MEASURED LIMITS — what this gate does NOT read, stated because a gate that
 * is believed to cover more than it does is worse than a narrow one:
 *   - string literals in expressions that are neither a text node nor one of
 *     TEXT_ATTRS: a custom component prop (`<Card body={'Hello'} />`) is not
 *     scanned, because a prop name carries no promise of being visible text;
 *   - anything a `<script>` block writes into the DOM at runtime: script
 *     blocks are blanked before scanning;
 *   - a brace or a quote inside a string that unbalances the crude `{…}` and
 *     quote scanners (`{t('a', { x: '}' })}`).
 * Nothing else in this repository covers those. check-built.mjs reads the
 * produced HTML, but only for structure -- the download gate, `lang`, the
 * landmarks, the internal links, the locale coverage -- and measures no
 * language at all: an English string reaching the Polish page by one of the
 * routes above passes it. Measured 2026-09-03, an injected
 * `aria-label='Main content'` gave `check-built: PASS ... 0 findings`. This
 * gate is the only one that reads text, so a hole here is a hole, not a
 * second-level catch (CLAUDE.md 5.9).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const NAME = 'check-i18n';

const EXIT_OK = 0;
const EXIT_FINDINGS = 1;
const EXIT_INSTRUMENT = 2;

function die(code, message) {
  const label = code === EXIT_INSTRUMENT ? 'FAIL (instrument)' : 'FAIL';
  console.error(`${NAME}: ${label} -- ${message}`);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = { root: join(HERE, '..'), json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8')
        .split('\n')
        .filter((l) => l.startsWith(' *') || l.startsWith('/**'))
        .map((l) => l.replace(/^\/?\*+ ?/, ''))
        .join('\n'));
      process.exit(EXIT_OK);
    } else if (arg === '--root') {
      opts.root = argv[i + 1];
      i += 1;
      if (!opts.root) die(EXIT_INSTRUMENT, '--root needs a directory');
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
    if (entry === 'node_modules' || entry === 'dist' || entry === '.astro' || entry === '.git') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, accept, out);
    else if (accept(full)) out.push(full);
  }
  return out;
}

/**
 * Flattens nested JSON into dotted keys. Only strings are leaves; arrays
 * recurse through their indices, so `home.facts` becomes `home.facts.0.t`.
 * That is deliberate: it makes "the Polish list has one row fewer than the
 * English one" a [key-missing] finding instead of a shorter page.
 */
function flatten(node, prefix, out) {
  if (typeof node === 'string') {
    out.set(prefix, node);
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => flatten(v, prefix ? `${prefix}.${i}` : String(i), out));
    return out;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
  }
  return out;
}

/** Removes the Astro frontmatter fence, <style>/<script> blocks and comments. */
function stripNonTemplate(source) {
  let text = source;
  // Frontmatter: only when the file starts with it.
  if (text.startsWith('---')) {
    const end = text.indexOf('\n---', 3);
    if (end !== -1) {
      const head = text.slice(0, end + 4);
      text = head.replace(/[^\n]/g, ' ') + text.slice(end + 4);
    }
  }
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  text = text.replace(/<style[\s\S]*?<\/style>/g, blank);
  text = text.replace(/<script[\s\S]*?<\/script>/g, blank);
  text = text.replace(/<!--[\s\S]*?-->/g, blank);
  text = text.replace(/\{\/\*[\s\S]*?\*\/\}/g, blank);
  return text;
}

/** Removes balanced {...} expressions so only literal text remains. */
function stripExpressions(text) {
  let out = '';
  let depth = 0;
  for (const ch of text) {
    if (ch === '{') depth += 1;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out;
}

/**
 * Balanced `{...}` spans in a fragment, as `[openIndex, closeIndex]` pairs.
 * Nested braces are swallowed by the outermost span on purpose: the scanners
 * below want one whole expression source, not its pieces.
 */
function expressionSpans(fragment) {
  const spans = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < fragment.length; i += 1) {
    const ch = fragment[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        spans.push([start, i]);
        start = -1;
      }
    }
  }
  return spans;
}

/**
 * Quoted string literals inside a fragment of JavaScript, with their offsets.
 * Comments are skipped, so an apostrophe in `// don't` cannot open a string,
 * and a `/* i18n-literal *\/` comment standing immediately before a literal
 * (whitespace allowed between them, nothing else) marks it exempt.
 */
function scanLiterals(src) {
  const out = [];
  let exemptNext = false;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const body = src.slice(i + 2, end === -1 ? src.length : end);
      if (/\bi18n-literal\b/.test(body)) exemptNext = true;
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const start = i;
      i += 1;
      let value = '';
      while (i < src.length && src[i] !== ch) {
        if (src[i] === '\\') {
          value += src[i + 1] ?? '';
          i += 2;
          continue;
        }
        value += src[i];
        i += 1;
      }
      out.push({ value, index: start, exempt: exemptNext });
      exemptNext = false;
      i += 1;
      continue;
    }
    if (!/\s/.test(ch)) exemptNext = false;
    i += 1;
  }
  return out;
}

/**
 * Offsets covered by a `t()` / `list()` / `entries()` call in a fragment, as
 * `[startIndex, endIndex)` pairs. Strings are skipped while looking for the
 * closing parenthesis, so a bracket inside a message cannot end a span early.
 */
function catalogueCallSpans(src) {
  const spans = [];
  for (const m of src.matchAll(/\b(?:t|list|entries)\s*\(/g)) {
    let i = m.index + m[0].length;
    let depth = 1;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === "'" || ch === '"' || ch === '`') {
        i += 1;
        while (i < src.length && src[i] !== ch) i += src[i] === '\\' ? 2 : 1;
        i += 1;
        continue;
      }
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      i += 1;
    }
    spans.push([m.index, i]);
  }
  return spans;
}

const HAS_LETTER = /\p{L}/u;
const HAS_SPACE = /\s/;

/**
 * String literals inside one expression source that would reach the reader as
 * text. See the header for the three exemptions; the whitespace rule is the
 * one that does the work — `t('legal.header', { owner: 'Gh0s777tt' })` is an
 * identifier fed into a translated sentence, `{ label: 'Download now' }` is a
 * phrase and belongs in the catalogue.
 */
function expressionFindings(expr) {
  const calls = catalogueCallSpans(expr);
  const out = [];
  for (const lit of scanLiterals(expr)) {
    if (lit.exempt) continue;
    const value = lit.value.trim();
    if (!value || !HAS_LETTER.test(value)) continue;
    const inCatalogueCall = calls.some(([a, b]) => lit.index > a && lit.index < b);
    if (inCatalogueCall && !HAS_SPACE.test(value)) continue;
    out.push({ index: lit.index, value });
  }
  return out;
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

function main() {
  const { root, json } = parseArgs(process.argv.slice(2));

  if (!existsSync(root)) die(EXIT_INSTRUMENT, `root "${root}" does not exist`);
  const i18nDir = join(root, 'src', 'i18n');
  const srcDir = join(root, 'src');
  if (!existsSync(i18nDir)) die(EXIT_INSTRUMENT, `no catalogue directory at ${relative(root, i18nDir)}`);
  if (!existsSync(srcDir)) die(EXIT_INSTRUMENT, `no source directory at ${relative(root, srcDir)}`);

  const catalogueFiles = readdirSync(i18nDir).filter((f) => extname(f) === '.json').sort();
  if (catalogueFiles.length < 2) {
    die(EXIT_INSTRUMENT, `expected at least 2 catalogues in src/i18n, found ${catalogueFiles.length}`);
  }

  const catalogues = new Map();
  for (const file of catalogueFiles) {
    const locale = file.replace(/\.json$/, '');
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(join(i18nDir, file), 'utf8'));
    } catch (err) {
      die(EXIT_INSTRUMENT, `catalogue ${file} is not valid JSON: ${err.message}`);
    }
    catalogues.set(locale, flatten(parsed, '', new Map()));
  }

  const sourceFiles = walk(srcDir, (f) => ['.astro', '.ts', '.mjs', '.js'].includes(extname(f)))
    .filter((f) => !f.startsWith(i18nDir + '/'))
    .sort();
  const astroFiles = sourceFiles.filter((f) => extname(f) === '.astro');
  if (astroFiles.length === 0) die(EXIT_INSTRUMENT, 'no .astro components found under src/');

  const findings = [];
  const add = (kind, file, line, detail) =>
    findings.push({ kind, file: relative(root, file), line, detail });

  // ---- 1. catalogue symmetry ------------------------------------------------
  const union = new Set();
  for (const keys of catalogues.values()) for (const k of keys.keys()) union.add(k);

  for (const [locale, keys] of catalogues) {
    for (const key of union) {
      if (!keys.has(key)) {
        add('key-missing', join(i18nDir, `${locale}.json`), 0, `key "${key}" is absent`);
        continue;
      }
      if (String(keys.get(key)).trim() === '') {
        add('key-empty', join(i18nDir, `${locale}.json`), 0, `key "${key}" is empty`);
      }
    }
  }

  // ---- 2. keys referenced by the source ------------------------------------
  const used = new Set();
  const dynamicPrefixes = [];
  const REF = /\b(?:t|list|entries)\(\s*['"`]([A-Za-z0-9_.-]+)['"`]/g;
  const DYNAMIC = /i18n-dynamic:\s*([A-Za-z0-9_.-]+)/g;

  for (const file of sourceFiles) {
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(REF)) used.add(m[1]);
    for (const m of source.matchAll(DYNAMIC)) dynamicPrefixes.push(m[1]);
  }

  // A reference to `home.facts` covers every leaf under it (list/entries calls).
  const unionList = [...union];
  for (const key of used) {
    const covers = union.has(key) || unionList.some((k) => k.startsWith(`${key}.`));
    if (!covers) {
      const where = sourceFiles.find((f) => readFileSync(f, 'utf8').includes(key));
      add('key-unknown', where ?? srcDir, 0, `t("${key}") has no entry in any catalogue`);
    }
  }
  const usedList = [...used];
  for (const key of union) {
    if (used.has(key)) continue;
    if (usedList.some((u) => key.startsWith(`${u}.`))) continue;
    if (dynamicPrefixes.some((p) => key.startsWith(p))) continue;
    add('key-unused', join(i18nDir, `${catalogueFiles[0]}`), 0, `key "${key}" is referenced nowhere`);
  }

  // ---- 3. bare literals in components --------------------------------------
  const TEXT_ATTRS = ['aria-label', 'alt', 'title', 'placeholder', 'aria-description'];
  for (const file of astroFiles) {
    const raw = readFileSync(file, 'utf8');
    const template = stripNonTemplate(raw);

    // text nodes: >...<
    const TEXT = />([^<]*)</g;
    for (const m of template.matchAll(TEXT)) {
      // the opening tag immediately before this text node
      const before = template.lastIndexOf('<', m.index);
      const openTag = before === -1 ? '' : template.slice(before, m.index + 1);
      if (openTag.includes('data-i18n-literal')) continue;

      const literal = stripExpressions(m[1]).replace(/&[a-z]+;|&#\d+;/gi, ' ').trim();
      if (literal && HAS_LETTER.test(literal)) {
        add('literal-text', file, lineOf(template, m.index), `bare text ${JSON.stringify(literal.slice(0, 60))}`);
      }

      // the same text position, reached from inside an expression. Without
      // this, stripExpressions() above hid every literal in a ternary from the
      // gate that exists to find them.
      for (const [open, close] of expressionSpans(m[1])) {
        const exprAt = m.index + 1 + open + 1;
        for (const hit of expressionFindings(m[1].slice(open + 1, close))) {
          add('literal-expr', file, lineOf(template, exprAt + hit.index),
            `text from an expression ${JSON.stringify(hit.value.slice(0, 60))}`);
        }
      }
    }

    // text-bearing attributes with a literal value, in EITHER quote style.
    // Astro accepts both; a gate that read only one of them let
    // aria-label='Main content' onto the Polish page with every check green.
    for (const attr of TEXT_ATTRS) {
      const ATTR = new RegExp(`\\b${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'g');
      for (const m of template.matchAll(ATTR)) {
        const value = (m[1] ?? m[2]).trim();
        if (!value || !HAS_LETTER.test(value)) continue;
        add('literal-attr', file, lineOf(template, m.index), `${attr}="${value.slice(0, 60)}"`);
      }

      // ...and the same attribute written as an expression.
      const ATTR_EXPR = new RegExp(`\\b${attr}\\s*=\\s*\\{`, 'g');
      for (const m of template.matchAll(ATTR_EXPR)) {
        const openIdx = m.index + m[0].length - 1;
        const [, close] = expressionSpans(template.slice(openIdx))[0] ?? [];
        if (close === undefined) continue;
        for (const hit of expressionFindings(template.slice(openIdx + 1, openIdx + close))) {
          add('literal-attr', file, lineOf(template, openIdx + 1 + hit.index),
            `${attr}={… ${JSON.stringify(hit.value.slice(0, 60))}}`);
        }
      }
    }
  }

  // ---- report ---------------------------------------------------------------
  const stats = {
    locales: [...catalogues.keys()],
    keys: union.size,
    referenced: used.size,
    components: astroFiles.length,
    sources: sourceFiles.length,
    findings: findings.length,
  };

  if (json) {
    console.log(JSON.stringify({ stats, findings }, null, 2));
  } else {
    for (const f of findings) {
      console.error(`${NAME}: [${f.kind}] ${f.file}:${f.line} ${f.detail}`);
    }
  }

  const summary =
    `${stats.locales.join('+')} · ${stats.keys} keys · ${stats.referenced} referenced · ` +
    `${stats.components} components · ${stats.findings} findings`;

  if (findings.length > 0) {
    console.error(`${NAME}: FAIL -- ${summary}`);
    process.exit(EXIT_FINDINGS);
  }
  console.log(`${NAME}: PASS -- ${summary}`);
  process.exit(EXIT_OK);
}

main();
