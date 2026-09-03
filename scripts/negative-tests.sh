#!/usr/bin/env bash
#
# negative-tests.sh -- proves that this repository's gates can go red.
#
# Usage: bash scripts/negative-tests.sh [--keep]
#
# Every check here breaks something on purpose in a throwaway copy of the tree
# and asserts the exit code. A gate that only ever passes is not a gate
# (E-OS CLAUDE.md 5.4), and the only way to know a gate can fail is to have
# watched it fail -- on the right finding, not on any finding at all, so each
# case also asserts the message it expects.
#
# Exit codes asserted:
#   1  the gate found a defect
#   2  the gate could not run (missing catalogues, missing source)
#
# THIS SUITE'S OWN exit codes:
#   0  every one of EXPECTED_CASES cases ran and proved its gate red
#   1  a case did not behave as asserted -- a gate is broken
#   2  a case could NOT RUN, so the suite cannot tell "all gates proved red"
#      from "a fifth of the gates were never exercised". Escape, explicit and
#      visible in a diff: EOS_ALLOW_SKIPPED_CASES=1.
#
# EXPECTED_CASES below is the whole point of the exit-2 rule. Some cases need
# inputs the machine may not have (a build in public/, an E-OS checkout named
# by EOS_REPO). Counting only what ran and exiting 0 made the suite green while
# five of its cases silently evaporated -- the same shape as E-OS CLAUDE.md P-2
# ("Nothing to be done" over stale artefacts) and the `|| true` rule this
# project legislates against. A pipeline reads the verdict, not the log.
#
# The working tree is never modified: everything happens under a temporary
# directory that is removed on exit unless --keep is given.

set -euo pipefail

KEEP=0
if [ "${1:-}" = "--keep" ]; then
  KEEP=1
elif [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
elif [ -n "${1:-}" ]; then
  echo "negative-tests: FAIL (instrument) -- unknown argument \"$1\"" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="${NODE:-node}"
command -v "$NODE" >/dev/null 2>&1 || {
  echo "negative-tests: FAIL (instrument) -- no node on PATH" >&2
  exit 2
}

TMP="$(mktemp -d "${TMPDIR:-/tmp}/eos-website-negative.XXXXXX")"
cleanup() {
  if [ "$KEEP" -eq 1 ]; then
    echo "negative-tests: kept $TMP"
  else
    rm -rf "$TMP"
  fi
}
trap cleanup EXIT

# Every case defined below, counted by hand. Raise it in the same commit that
# adds a case: a suite that derives its own expectation from what it happened
# to run cannot notice a case going missing.
EXPECTED_CASES=27

PASSED=0
FAILED=0
SKIPPED=0

# skip_cases <how-many> <why>
skip_cases() {
  SKIPPED=$((SKIPPED + $1))
  printf 'negative-tests: SKIPPED %s case(s) -- %s\n' "$1" "$2"
}

# run_case <name> <expected-exit> <expected-substring> <command...>
run_case() {
  name="$1"; expected="$2"; needle="$3"; shift 3
  set +e
  output="$("$@" 2>&1)"
  code=$?
  set -e
  if [ "$code" -ne "$expected" ]; then
    printf 'negative-tests: FAIL %s -- exit %s, expected %s\n' "$name" "$code" "$expected" >&2
    printf '  output: %s\n' "$(printf '%s' "$output" | head -3)" >&2
    FAILED=$((FAILED + 1))
    return
  fi
  case "$output" in
    *"$needle"*) ;;
    *)
      printf 'negative-tests: FAIL %s -- exit %s as expected but message did not mention "%s"\n' \
        "$name" "$code" "$needle" >&2
      printf '  output: %s\n' "$(printf '%s' "$output" | head -3)" >&2
      FAILED=$((FAILED + 1))
      return
      ;;
  esac
  printf 'negative-tests: ok   %s -- exit %s, matched "%s"\n' "$name" "$code" "$needle"
  PASSED=$((PASSED + 1))
}

# A throwaway copy: sources only, no node_modules, no build output.
copy_tree() {
  target="$1"
  mkdir -p "$target"
  ( cd "$ROOT" && tar -cf - \
      --exclude=node_modules --exclude=public --exclude=dist --exclude=.git --exclude=.astro . ) \
    | ( cd "$target" && tar -xf - )
}

# ---------------------------------------------------------------------------
# 0. The control: an untouched copy has to pass. Without this line, every
#    "FAIL" below could simply mean the copy itself is broken.
# ---------------------------------------------------------------------------
CLEAN="$TMP/clean"
copy_tree "$CLEAN"
run_case "control/i18n"      0 "PASS" "$NODE" "$CLEAN/scripts/check-i18n.mjs" --root "$CLEAN"
run_case "control/contrast"  0 "PASS" "$NODE" "$CLEAN/scripts/check-contrast.mjs" --root "$CLEAN"
run_case "control/changelog" 0 "PASS" "$NODE" "$CLEAN/scripts/check-changelog.mjs" --root "$CLEAN"

# ---------------------------------------------------------------------------
# 1. check-i18n: a key removed from one catalogue only.
# ---------------------------------------------------------------------------
CASE="$TMP/missing-key"
copy_tree "$CASE"
"$NODE" -e '
  const fs = require("fs");
  const p = process.argv[1];
  const cat = JSON.parse(fs.readFileSync(p, "utf8"));
  delete cat.nav.downloads;
  fs.writeFileSync(p, JSON.stringify(cat, null, 2));
' "$CASE/src/i18n/pl.json"
run_case "i18n/key-missing" 1 "key-missing" "$NODE" "$CASE/scripts/check-i18n.mjs" --root "$CASE"

# ---------------------------------------------------------------------------
# 2. check-i18n: a bare string literal in a text position in a component.
# ---------------------------------------------------------------------------
CASE="$TMP/bare-literal"
copy_tree "$CASE"
"$NODE" -e '
  const fs = require("fs");
  const p = process.argv[1];
  const src = fs.readFileSync(p, "utf8");
  fs.writeFileSync(p, src.replace("<slot />", "<p>Download now and thank us later</p>\n      <slot />"));
' "$CASE/src/layouts/Base.astro"
run_case "i18n/literal-text" 1 "literal-text" "$NODE" "$CASE/scripts/check-i18n.mjs" --root "$CASE"

# ---------------------------------------------------------------------------
# 3. check-i18n: a hardcoded accessible name in an attribute.
# ---------------------------------------------------------------------------
CASE="$TMP/bare-attr"
copy_tree "$CASE"
"$NODE" -e '
  const fs = require("fs");
  const p = process.argv[1];
  const src = fs.readFileSync(p, "utf8");
  fs.writeFileSync(p, src.replace("<main id=\"main\"", "<main aria-label=\"Main content\" id=\"main\""));
' "$CASE/src/layouts/Base.astro"
run_case "i18n/literal-attr" 1 "literal-attr" "$NODE" "$CASE/scripts/check-i18n.mjs" --root "$CASE"

# ---------------------------------------------------------------------------
# 3b. The SAME defect in single quotes. Astro accepts both quote styles, and
#     for a while this gate read only the double-quoted form: case 3 above
#     passed, so the suite certified a gate with a hole in it. Measured on
#     2026-09-03 -- `aria-label='Main content'` shipped onto the Polish page
#     with check-i18n, astro build and check-built all green.
# ---------------------------------------------------------------------------
CASE="$TMP/bare-attr-singlequote"
copy_tree "$CASE"
"$NODE" -e '
  const fs = require("fs");
  const p = process.argv[1];
  const src = fs.readFileSync(p, "utf8");
  fs.writeFileSync(p, src.replace("<main id=\"main\"", "<main aria-label=\x27Main content\x27 id=\"main\""));
' "$CASE/src/layouts/Base.astro"
run_case "i18n/literal-attr-singlequote" 1 "literal-attr" "$NODE" "$CASE/scripts/check-i18n.mjs" --root "$CASE"

# ---------------------------------------------------------------------------
# 3c. A literal inside an `{...}` expression. The gate used to delete every
#     expression before scanning, so a string in a ternary was never examined
#     -- the one place a hardcoded English phrase is easiest to write.
# ---------------------------------------------------------------------------
CASE="$TMP/literal-in-expression"
copy_tree "$CASE"
"$NODE" -e '
  const fs = require("fs");
  const p = process.argv[1];
  const src = fs.readFileSync(p, "utf8");
  fs.writeFileSync(p, src.replace("<slot />", "<p>{true ? \x27Download the image now\x27 : \x27Nope\x27}</p>\n      <slot />"));
' "$CASE/src/layouts/Base.astro"
run_case "i18n/literal-in-expression" 1 "literal-expr" "$NODE" "$CASE/scripts/check-i18n.mjs" --root "$CASE"

# ---------------------------------------------------------------------------
# 4. check-i18n: the instrument, not the tree. No catalogues at all.
# ---------------------------------------------------------------------------
CASE="$TMP/no-catalogues"
mkdir -p "$CASE/src/pages"
run_case "i18n/instrument" 2 "FAIL (instrument)" "$NODE" "$CLEAN/scripts/check-i18n.mjs" --root "$CASE"

# ---------------------------------------------------------------------------
# 5. check-contrast: the desktop's own muted colour, which is 4.0:1 on the
#    dark background and therefore below the 4.5:1 this site claims. This is
#    the exact value the tokens file says it rejected, so the gate is proved
#    against the real historical choice rather than against a random colour.
# ---------------------------------------------------------------------------
CASE="$TMP/low-contrast"
copy_tree "$CASE"
"$NODE" -e '
  const fs = require("fs");
  const p = process.argv[1];
  const src = fs.readFileSync(p, "utf8");
  fs.writeFileSync(p, src.replace("--muted: #b79a9a;", "--muted: #8a6f6f;"));
' "$CASE/src/styles/tokens.css"
run_case "contrast/below-minimum" 1 "contrast" "$NODE" "$CASE/scripts/check-contrast.mjs" --root "$CASE"

# ---------------------------------------------------------------------------
# 6. check-contrast: the two copies of the light palette drifting apart.
# ---------------------------------------------------------------------------
CASE="$TMP/theme-drift"
copy_tree "$CASE"
"$NODE" -e '
  const fs = require("fs");
  const p = process.argv[1];
  const src = fs.readFileSync(p, "utf8");
  const i = src.lastIndexOf("--text: #1a0d0d;");
  fs.writeFileSync(p, src.slice(0, i) + "--text: #222222;" + src.slice(i + "--text: #1a0d0d;".length));
' "$CASE/src/styles/tokens.css"
run_case "contrast/theme-drift" 1 "theme-drift" "$NODE" "$CASE/scripts/check-contrast.mjs" --root "$CASE"

# ---------------------------------------------------------------------------
# 7. check-changelog: a source that parses but is not the E-OS changelog.
#    EOS_REPO takes precedence over every other candidate, so this also proves
#    the resolution order works.
# ---------------------------------------------------------------------------
CASE="$TMP/thin-changelog"
copy_tree "$CASE"
mkdir -p "$TMP/fake-repo"
printf '# Changelog\r\n\r\n## [Unreleased]\r\n\r\n### Added\r\n- one entry\r\n' > "$TMP/fake-repo/CHANGELOG.md"
run_case "changelog/invariant" 1 "invariant" \
  env EOS_REPO="$TMP/fake-repo" "$NODE" "$CASE/scripts/check-changelog.mjs" --root "$CASE"

# ---------------------------------------------------------------------------
# 8. check-changelog: the CRLF pin. A source normalised to LF is a finding,
#    because that is how the pin gets lost silently (E-OS CLAUDE.md P-8).
# ---------------------------------------------------------------------------
CASE="$TMP/lf-changelog"
copy_tree "$CASE"
mkdir -p "$TMP/lf-repo"
"$NODE" -e '
  const fs = require("fs");
  const src = fs.readFileSync(process.argv[1], "utf8").replace(/\r\n/g, "\n");
  fs.writeFileSync(process.argv[2], src);
' "$CLEAN/vendor/CHANGELOG.md" "$TMP/lf-repo/CHANGELOG.md"
run_case "changelog/crlf" 1 "CRLF" \
  env EOS_REPO="$TMP/lf-repo" "$NODE" "$CASE/scripts/check-changelog.mjs" --root "$CASE"

# ---------------------------------------------------------------------------
# 9. check-changelog: no source anywhere is an instrument failure, not a pass.
# ---------------------------------------------------------------------------
CASE="$TMP/no-changelog"
copy_tree "$CASE"
rm -f "$CASE/vendor/CHANGELOG.md"
run_case "changelog/instrument" 2 "FAIL (instrument)" \
  env EOS_REPO="$TMP/definitely-not-a-repo" EOS_ALLOW_MISSING_CHANGELOG=1 \
  "$NODE" "$CASE/scripts/check-changelog.mjs" --root "$CASE"

# ---------------------------------------------------------------------------
# 10. gen-products with no EOS_REPO must refuse rather than guess a path. This
#     one needs no E-OS checkout, so it always runs.
# ---------------------------------------------------------------------------
run_case "products/instrument" 2 "EOS_REPO is not set" \
  env -u EOS_REPO "$NODE" "$CLEAN/scripts/gen-products.mjs" --root "$CLEAN" --check

# ---------------------------------------------------------------------------
# 11-12. gen-products against a real E-OS tree. EOS_REPO names it; there is no
#     default, because a default path belongs to one laptop and nobody else.
#     Skipped, loudly and counted, when EOS_REPO is unset or does not point at
#     a checkout -- see EXPECTED_CASES at the top for what a skip costs.
# ---------------------------------------------------------------------------
EOS_TREE="${EOS_REPO:-}"
if [ -n "$EOS_TREE" ] && [ -f "$EOS_TREE/repos.toml" ]; then
  # 11. A pin changed in the manifest must not pass unnoticed.
  CASE="$TMP/stale-products"
  copy_tree "$CASE"
  "$NODE" -e '
    const fs = require("fs");
    const p = process.argv[1];
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    data.products[0].repository.pinnedRev = "0000000000000000000000000000000000000000";
    fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
  ' "$CASE/src/data/products.json"
  run_case "products/stale" 1 "differs from the configuration" \
    env EOS_REPO="$EOS_TREE" "$NODE" "$CASE/scripts/gen-products.mjs" --root "$CASE" --check

  # 12. The portability property itself, gated rather than asserted in prose:
  #     the SAME configuration reached by a DIFFERENT path must still match.
  #     products.json used to embed the absolute path it was generated from, so
  #     a second checkout -- any contributor, any runner with EOS_REPO set --
  #     got exit 1 on byte-identical configuration, and the message named a pin
  #     drift that did not exist (E-OS CLAUDE.md 13, U-177: red must say what is
  #     actually broken).
  ALIAS="$TMP/eos-tree-by-another-name"
  ln -sfn "$EOS_TREE" "$ALIAS"
  run_case "products/portable" 0 "PASS" \
    env EOS_REPO="$ALIAS" "$NODE" "$CLEAN/scripts/gen-products.mjs" --root "$CLEAN" --check
else
  skip_cases 2 "products/stale and products/portable: EOS_REPO does not name an E-OS checkout"
fi

# ---------------------------------------------------------------------------
# 16-19. check-ci: the pipeline definition itself. The runner tag is an owner
#     decision with a measured reason behind it (shared runners run out; GitHub
#     Actions has never produced a run), so losing it in an edit has to be a
#     red pipeline rather than a job that quietly never executes.
#
#     These cases run the INSTALLED script against a mutated copy of the
#     pipeline file, not a copied script: check-ci imports the `yaml` package,
#     and the throwaway copy deliberately has no node_modules. The mutation is
#     in the input either way, which is what is being measured.
# ---------------------------------------------------------------------------
run_case "control/ci" 0 "PASS" "$NODE" "$ROOT/scripts/check-ci.mjs" --file "$ROOT/.gitlab-ci.yml"

CASE="$TMP/ci-runner"
copy_tree "$CASE"
"$NODE" -e '
  const fs = require("fs");
  const p = process.argv[1];
  const src = fs.readFileSync(p, "utf8");
  fs.writeFileSync(p, src.replace(/\n  tags: \[eos-heavy\]/g, ""));
' "$CASE/.gitlab-ci.yml"
run_case "ci/runner" 1 "runner" "$NODE" "$ROOT/scripts/check-ci.mjs" --file "$CASE/.gitlab-ci.yml"

CASE="$TMP/ci-swallowed"
copy_tree "$CASE"
"$NODE" -e '
  const fs = require("fs");
  const p = process.argv[1];
  const src = fs.readFileSync(p, "utf8");
  fs.writeFileSync(p, src.replace("    - npm run check:i18n", "    - npm run check:i18n || true"));
' "$CASE/.gitlab-ci.yml"
run_case "ci/swallowed" 1 "swallowed" "$NODE" "$ROOT/scripts/check-ci.mjs" --file "$CASE/.gitlab-ci.yml"

CASE="$TMP/ci-pages"
copy_tree "$CASE"
"$NODE" -e '
  const fs = require("fs");
  const p = process.argv[1];
  const src = fs.readFileSync(p, "utf8");
  fs.writeFileSync(p, src.replace("      - public\n", "      - dist\n"));
' "$CASE/.gitlab-ci.yml"
run_case "ci/pages" 1 "pages" "$NODE" "$ROOT/scripts/check-ci.mjs" --file "$CASE/.gitlab-ci.yml"

run_case "ci/instrument" 2 "FAIL (instrument)" \
  "$NODE" "$ROOT/scripts/check-ci.mjs" --file "$TMP/no-such-pipeline.yml"

# ---------------------------------------------------------------------------
# 23-27. check-built: the gate that reads the artefact. These cases mutate a
#     COPY of the build output rather than the sources, so they need a build to
#     exist. A missing build is reported as SKIPPED, loudly, AND counted, so
#     the suite ends in exit 2 rather than a green verdict a pipeline cannot
#     tell apart from one where all five proved their gate red. Measured
#     2026-09-03 before this was so: with public/ moved aside the suite printed
#     "18 passed, 0 failed" and exited 0 (E-OS CLAUDE.md 13.1).
# ---------------------------------------------------------------------------
if [ -f "$ROOT/public/index.html" ]; then
  copy_built() {
    mkdir -p "$1"
    ( cd "$ROOT/public" && tar -cf - . ) | ( cd "$1" && tar -xf - )
  }

  # 11. Control: the real output, unmutated, has to pass.
  BUILT="$TMP/built-control"
  copy_built "$BUILT"
  run_case "built/control" 0 "PASS" \
    "$NODE" "$CLEAN/scripts/check-built.mjs" --root "$CLEAN" --out "$BUILT"

  # 12. The download gate leaking: a link to an installer image while
  #     downloads.developerOnly is true. This is the failure that would turn
  #     the gate into a claim rather than a fact.
  BUILT="$TMP/built-leak"
  copy_built "$BUILT"
  "$NODE" -e '
    const fs = require("fs");
    const p = process.argv[1];
    const html = fs.readFileSync(p, "utf8");
    fs.writeFileSync(p, html.replace("</main>",
      "<p><a href=\"/eos-website/eos-0.2.0-x86_64-installer.img\">get it</a></p></main>"));
  ' "$BUILT/en/downloads/index.html"
  run_case "built/gate-leak" 1 "gate-leak" \
    "$NODE" "$CLEAN/scripts/check-built.mjs" --root "$CLEAN" --out "$BUILT"

  # 13. A landmark lost: the main region without its id, so the skip link
  #     lands nowhere. Caught on the HTML, not on the component.
  BUILT="$TMP/built-landmark"
  copy_built "$BUILT"
  "$NODE" -e '
    const fs = require("fs");
    const p = process.argv[1];
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("<main id=\"main\"", "<main"));
  ' "$BUILT/pl/support/index.html"
  run_case "built/landmark" 1 "landmark" \
    "$NODE" "$CLEAN/scripts/check-built.mjs" --root "$CLEAN" --out "$BUILT"

  # 14. An internal link with no file behind it.
  BUILT="$TMP/built-deadlink"
  copy_built "$BUILT"
  "$NODE" -e '
    const fs = require("fs");
    const p = process.argv[1];
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("/eos-website/en/products/", "/eos-website/en/produkty/"));
  ' "$BUILT/en/index.html"
  run_case "built/dead-link" 1 "dead-link" \
    "$NODE" "$CLEAN/scripts/check-built.mjs" --root "$CLEAN" --out "$BUILT"

  # 15. The instrument, not the artefact: an output directory with no HTML in
  #     it must not read as a clean site.
  BUILT="$TMP/built-empty"
  mkdir -p "$BUILT"
  run_case "built/instrument" 2 "FAIL (instrument)" \
    "$NODE" "$CLEAN/scripts/check-built.mjs" --root "$CLEAN" --out "$BUILT"
else
  skip_cases 5 "built/*: no build output at $ROOT/public; run npm run build first"
fi

# ---------------------------------------------------------------------------
# The verdict. A pipeline reads this and nothing else, so it has to distinguish
# "every gate proved red" from "some gates were never exercised".
# ---------------------------------------------------------------------------
RAN=$((PASSED + FAILED))
printf 'negative-tests: %s passed, %s failed, %s skipped (of %s cases)\n' \
  "$PASSED" "$FAILED" "$SKIPPED" "$EXPECTED_CASES"

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

if [ "$RAN" -gt "$EXPECTED_CASES" ]; then
  printf 'negative-tests: FAIL (instrument) -- %s cases ran but EXPECTED_CASES=%s; raise the constant\n' \
    "$RAN" "$EXPECTED_CASES" >&2
  exit 2
fi

if [ "$RAN" -lt "$EXPECTED_CASES" ]; then
  MISSING=$((EXPECTED_CASES - RAN))
  if [ "${EOS_ALLOW_SKIPPED_CASES:-0}" = "1" ]; then
    printf 'negative-tests: %s of %s case(s) did not run, allowed by EOS_ALLOW_SKIPPED_CASES=1\n' \
      "$MISSING" "$EXPECTED_CASES"
    exit 0
  fi
  printf 'negative-tests: FAIL (instrument) -- %s of %s case(s) could not run; set EOS_ALLOW_SKIPPED_CASES=1 to accept that\n' \
    "$MISSING" "$EXPECTED_CASES" >&2
  exit 2
fi
exit 0
