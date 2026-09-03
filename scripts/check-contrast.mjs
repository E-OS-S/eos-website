#!/usr/bin/env node
/**
 * check-contrast -- measures the claims the accessibility statement makes.
 *
 * Usage: node scripts/check-contrast.mjs [--root <dir>] [--table]
 *
 * Reads the token blocks out of src/styles/tokens.css and computes the WCAG 2.x
 * relative-luminance contrast ratio for every pair declared in
 * a11y.contrast.json, in every theme. A pair below its declared minimum is a
 * finding, not a warning: the accessibility page states these numbers, so the
 * page becomes false the moment a colour is nudged.
 *
 * It also fails when the two copies of the light palette (explicit toggle and
 * prefers-color-scheme) drift apart -- CSS cannot share them, so a gate does.
 *
 * Negative test: change --muted in tokens.css to #8a6f6f (the desktop's own
 * muted colour) and this exits 1 naming the pair and the ratio.
 *
 * Exit 0 pass, 1 findings, 2 the check could not run.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const NAME = 'check-contrast';

let root = join(HERE, '..');
let table = false;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--root') { root = argv[i + 1]; i += 1; }
  else if (argv[i] === '--table') table = true;
  else if (argv[i] === '--help' || argv[i] === '-h') {
    console.log('usage: node scripts/check-contrast.mjs [--root <dir>] [--table]');
    process.exit(0);
  } else {
    console.error(`${NAME}: FAIL (instrument) -- unknown argument "${argv[i]}"`);
    process.exit(2);
  }
}

const tokensPath = join(root, 'src', 'styles', 'tokens.css');
const pairsPath = join(root, 'a11y.contrast.json');
for (const p of [tokensPath, pairsPath]) {
  if (!existsSync(p)) {
    console.error(`${NAME}: FAIL (instrument) -- ${p} not found`);
    process.exit(2);
  }
}

const css = readFileSync(tokensPath, 'utf8');
const spec = JSON.parse(readFileSync(pairsPath, 'utf8'));

/** Pulls `--name: #rrggbb;` declarations out of the block that follows a `@theme <id>` marker. */
function themeBlocks(source) {
  const themes = new Map();
  const marker = /\/\*\s*@theme\s+([a-z-]+)\s*\*\//g;
  for (const m of source.matchAll(marker)) {
    const open = source.indexOf('{', m.index);
    if (open === -1) continue;
    let depth = 0;
    let end = open;
    for (; end < source.length; end += 1) {
      if (source[end] === '{') depth += 1;
      else if (source[end] === '}') { depth -= 1; if (depth === 0) break; }
    }
    const body = source.slice(open + 1, end);
    const tokens = new Map();
    for (const d of body.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
      tokens.set(d[1], d[2].toLowerCase());
    }
    themes.set(m[1], tokens);
  }
  return themes;
}

const themes = themeBlocks(css);
if (themes.size < 2) {
  console.error(`${NAME}: FAIL (instrument) -- expected at least 2 @theme blocks in tokens.css, found ${themes.size}`);
  process.exit(2);
}

function channel(value) {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function luminance(hex) {
  const r = channel(parseInt(hex.slice(1, 3), 16));
  const g = channel(parseInt(hex.slice(3, 5), 16));
  const b = channel(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const findings = [];
const rows = [];

// duplicated light palette must stay identical
const light = themes.get('light');
const lightAuto = themes.get('light-auto');
if (!light || !lightAuto) {
  console.error(`${NAME}: FAIL (instrument) -- tokens.css must carry both a "light" and a "light-auto" @theme block`);
  process.exit(2);
}
for (const [name, value] of light) {
  if (lightAuto.get(name) !== value) {
    findings.push(`[theme-drift] --${name}: light=${value} light-auto=${lightAuto.get(name) ?? 'absent'}`);
  }
}
for (const name of lightAuto.keys()) {
  if (!light.has(name)) findings.push(`[theme-drift] --${name} exists only in light-auto`);
}

for (const [themeName, tokens] of themes) {
  if (themeName === 'light-auto') continue; // identical to light, already gated
  for (const pair of spec.pairs) {
    const fg = tokens.get(pair.fg);
    const bg = tokens.get(pair.bg);
    if (!fg || !bg) {
      findings.push(`[token-missing] ${themeName}: --${!fg ? pair.fg : pair.bg} is not defined`);
      continue;
    }
    const value = ratio(fg, bg);
    rows.push({ theme: themeName, pair: `${pair.fg}/${pair.bg}`, value, min: pair.min, where: pair.where });
    if (value + 1e-9 < pair.min) {
      findings.push(
        `[contrast] ${themeName}: --${pair.fg} (${fg}) on --${pair.bg} (${bg}) is ` +
          `${value.toFixed(2)}:1, below the declared ${pair.min}:1 -- ${pair.where}`,
      );
    }
  }
}

if (table) {
  for (const r of rows) {
    console.log(`${r.theme.padEnd(6)} ${r.pair.padEnd(26)} ${r.value.toFixed(2).padStart(6)}:1  (min ${r.min})`);
  }
}

const worst = rows.reduce((m, r) => (r.value / r.min < m.value / m.min ? r : m), rows[0]);
const summary =
  `${themes.size} themes · ${rows.length} pairs measured · tightest ${worst.theme} ${worst.pair} ` +
  `${worst.value.toFixed(2)}:1 vs ${worst.min}:1 · ${findings.length} findings`;

for (const f of findings) console.error(`${NAME}: ${f}`);
if (findings.length > 0) {
  console.error(`${NAME}: FAIL -- ${summary}`);
  process.exit(1);
}
console.log(`${NAME}: PASS -- ${summary}`);
process.exit(0);
