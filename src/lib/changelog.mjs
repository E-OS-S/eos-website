/**
 * Keep a Changelog parser for the E-OS `CHANGELOG.md`.
 *
 * The source file is pinned to CRLF in the E-OS repository (.gitattributes;
 * ci-integrity check 8). This parser therefore reads bytes, records whether
 * the file really is CRLF, and normalises only for its own line splitting.
 *
 * Source resolution -- two candidates, never a hardcoded machine:
 *   $EOS_REPO/CHANGELOG.md            -- when set, the ONLY candidate
 *   <site root>/vendor/CHANGELOG.md   -- otherwise, the copy this repo carries
 *
 * The vendored copy is the DEFAULT on every machine, including the owner's.
 * An earlier version put the owner's working tree first, which meant the
 * default build read a file no runner and no contributor could see: the
 * ordinary build was the non-reproducible one, and the drift check that would
 * have noticed only fired where both files existed -- never on CI. Reading the
 * live tree is now something you ask for with EOS_REPO, and the summary line
 * of check-changelog says which source it used.
 *
 * If neither exists the build FAILS. Rendering an empty changelog
 * page would be a silent lie about a project whose whole discipline is that a
 * check must be able to fail. The escape is explicit and says what it did:
 *   EOS_ALLOW_MISSING_CHANGELOG=1
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The site root, found by walking up for the directory that holds both
 * `package.json` and `src/`.
 *
 * `join(HERE, '..', '..')` was wrong and had never been noticed, because at
 * build time this module is not read from src/lib: Astro bundles it into
 * `public/.prerender/chunks/`, two levels under `public/`, so the vendored
 * candidate resolved to `public/vendor/CHANGELOG.md` -- a path that has never
 * existed. Nothing failed only because the resolution order put a hardcoded
 * path on the owner's laptop first, and that path was always there. Measured
 * 2026-09-03, the first build after the reference-host entry was removed:
 *   [ERROR] changelog: no source found (tried vendored=<root>/public/vendor/CHANGELOG.md)
 * A fallback nobody ever reaches is not a fallback (E-OS CLAUDE.md 5.4).
 */
function resolveSiteRoot(start) {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'src'))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return join(start, '..', '..');
}

export const SITE_ROOT = resolveSiteRoot(HERE);

/**
 * Every candidate path, in resolution order, with a label.
 *
 * EOS_REPO is exclusive on purpose. If somebody names a checkout and that
 * checkout has no changelog, falling back to another source is how a
 * measurement ends up describing a tree nobody meant to measure (E-OS
 * CLAUDE.md 20.1). An explicit source that is not there is an error, not an
 * invitation to guess.
 *
 * Without EOS_REPO there is exactly one candidate, and it is the one every
 * machine has. No absolute path of any particular host appears here.
 */
export function candidatePaths(root = SITE_ROOT) {
  if (process.env.EOS_REPO) {
    return [{ label: 'EOS_REPO', path: join(process.env.EOS_REPO, 'CHANGELOG.md') }];
  }
  return [{ label: 'vendored', path: join(root, 'vendor', 'CHANGELOG.md') }];
}

/** Reads the changelog source and records where it came from. */
export function readChangelogSource(root = SITE_ROOT) {
  for (const candidate of candidatePaths(root)) {
    if (!existsSync(candidate.path)) continue;
    if (!statSync(candidate.path).isFile()) continue;
    const bytes = readFileSync(candidate.path);
    const text = bytes.toString('utf8');
    return {
      origin: candidate.label,
      path: candidate.path,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      crlf: text.includes('\r\n'),
      text,
      missing: false,
    };
  }
  if (process.env.EOS_ALLOW_MISSING_CHANGELOG === '1') {
    return {
      origin: 'none (EOS_ALLOW_MISSING_CHANGELOG=1)',
      path: '',
      bytes: 0,
      sha256: '',
      crlf: false,
      text: '',
      missing: true,
    };
  }
  const tried = candidatePaths(root).map((c) => `${c.label}=${c.path}`).join(', ');
  throw new Error(
    `changelog: no source found (tried ${tried}). ` +
      'Set EOS_REPO, vendor a copy, or set EOS_ALLOW_MISSING_CHANGELOG=1 to build without it.',
  );
}

const RELEASE_BRACKET = /^##\s+\[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?\s*$/;
const RELEASE_PLAIN = /^##\s+(?!#)(.+?)\s*$/;
const SECTION = /^###\s+(.+?)\s*$/;
const BULLET = /^-\s+(.*)$/;

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[`*_[\]()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';
}

/**
 * Parses Keep a Changelog markdown into releases -> sections -> items.
 * Nothing in the source is dropped: prose that is not a bullet becomes a
 * `notes` paragraph, so a parser bug shows up as misplaced text rather than as
 * missing text.
 */
export function parseChangelog(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const preamble = [];
  const releases = [];

  let release = null;
  let section = null;
  let buffer = null; // { target: 'item' | 'note', lines: [] }

  const flush = () => {
    if (!buffer) return;
    const text = buffer.lines.join('\n').trim();
    if (text) {
      let bucket;
      if (section) bucket = buffer.target === 'item' ? section.items : section.notes;
      else if (release) bucket = buffer.target === 'item' ? release.items : release.notes;
      else bucket = preamble;
      bucket.push(text);
    }
    buffer = null;
  };

  for (const line of lines) {
    const bracket = line.match(RELEASE_BRACKET);
    const sect = line.match(SECTION);
    const plain = !bracket && !sect && line.startsWith('## ') ? line.match(RELEASE_PLAIN) : null;

    if (bracket || plain) {
      flush();
      const version = bracket ? bracket[1] : plain[1];
      release = {
        version,
        date: bracket ? (bracket[2] ?? null) : null,
        unreleased: /unreleased/i.test(version),
        id: slug(version),
        notes: [],
        items: [],
        sections: [],
      };
      releases.push(release);
      section = null;
      continue;
    }

    if (sect && release) {
      flush();
      section = { title: sect[1], id: `${release.id}-${slug(sect[1])}`, items: [], notes: [] };
      release.sections.push(section);
      continue;
    }

    const bullet = line.match(BULLET);
    if (bullet) {
      flush();
      buffer = { target: 'item', lines: [bullet[1]] };
      continue;
    }

    if (line.trim() === '') {
      flush();
      continue;
    }

    if (buffer) {
      buffer.lines.push(line.replace(/^\s{2,}/, ''));
    } else {
      buffer = { target: 'note', lines: [line] };
    }
  }
  flush();

  const counts = {
    releases: releases.length,
    sections: releases.reduce((n, r) => n + r.sections.length, 0),
    items: releases.reduce(
      (n, r) => n + r.items.length + r.sections.reduce((m, s) => m + s.items.length, 0),
      0,
    ),
  };

  return { preamble, releases, counts };
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

const SAFE_HREF = /^(https?:\/\/|mailto:|\/|#)/i;
const CODE_SLOT = 'CODESLOT';

/**
 * Renders the small inline subset the changelog actually uses:
 * `code`, **strong**, *em*, [text](url). Everything is escaped first, so a
 * changelog entry cannot inject markup into the page.
 */
export function renderInline(markdown) {
  const codes = [];
  let text = markdown.replace(/`([^`]+)`/g, (_m, code) => {
    codes.push(code);
    return `@@${CODE_SLOT}${codes.length - 1}@@`;
  });

  text = escapeHtml(text);

  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) => {
    if (!SAFE_HREF.test(href)) return label;
    const external = /^https?:/i.test(href);
    const rel = external ? ' rel="noopener noreferrer"' : '';
    return `<a href="${escapeHtml(href)}"${rel}>${label}</a>`;
  });
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');

  const slotRe = new RegExp(`@@${CODE_SLOT}(\\d+)@@`, 'g');
  text = text.replace(slotRe, (_m, i) => `<code>${escapeHtml(codes[Number(i)])}</code>`);
  return text;
}

/** Read plus parse in one call, provenance included. */
export function loadChangelog(root = SITE_ROOT) {
  const source = readChangelogSource(root);
  const parsed = source.missing
    ? { preamble: [], releases: [], counts: { releases: 0, sections: 0, items: 0 } }
    : parseChangelog(source.text);
  return { source, ...parsed };
}
