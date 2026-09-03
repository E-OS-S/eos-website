# eos-website

The website for [E-OS](https://gitlab.com/e-os/e-os), a hardened downstream
distribution of Redox OS. Static output, two locales, no backend.

**Status:** skeleton, 2026-09-03 · **Owner:** Gh0s777tt ·
**Licence:** AGPL-3.0-or-later · **Roadmap:** `WS-001` … `WS-007`, `WS-009`, `WS-010`

---

## What this is

A separate repository from the orchestration repository, as decided on
2026-09-03 (`WS-001`). It builds 27 static pages — 13 per locale plus a root
language chooser — with Astro, and publishes them from GitLab Pages.

Three of its pages are generated from the E-OS repository rather than written
here, so that they cannot drift from it:

| Page | Built from |
|---|---|
| Products | `config/x86_64/eos.toml`, `config/desktop.toml`, `repos.toml` → `src/data/products.json` |
| Changelog | `CHANGELOG.md`, parsed at build time (the file is CRLF-pinned; the parser reads bytes and says so) |
| Accessibility | `a11y.contrast.json` and `src/styles/tokens.css`, the same files the contrast gate measures |

---

## Quick start

```bash
npm ci
npm run check:i18n        # every visible string is in both catalogues
npm run check:changelog   # parser fixtures + source invariants + vendored-copy drift
npm run check:contrast    # every colour pair the accessibility page claims
npm run check:ci          # the pipeline: eos-heavy on every job, nothing swallowed
npm run build             # writes public/
npm run check:built       # reads the HTML: download gate, landmarks, links, locales
bash scripts/negative-tests.sh   # proves all five gates above can go red
```

`npm run verify` runs the source checks, the build and the artefact check in one
go. Two more need the E-OS orchestration repository on the same machine, named
by `EOS_REPO`, and are therefore local-only, never CI jobs:

```bash
EOS_REPO=/path/to/E-OS npm run check:products   # products.json still matches eos.toml + repos.toml
EOS_REPO=/path/to/E-OS npm run sync:changelog   # refresh vendor/CHANGELOG.md, byte for byte
```

**No script has a default path to anybody's checkout.** `EOS_REPO` unset is
`FAIL (instrument)`, exit 2 — not a guess at where the repository might be. A
hardcoded absolute path is how a measurement ends up describing a tree nobody
meant to measure (E-OS `CLAUDE.md` §20.1), and it also breaks on the second
machine that tries it.

The same rule decides where the changelog comes from. `vendor/CHANGELOG.md` is
the source **by default, on every machine including the owner's**; `EOS_REPO`
opts into the live tree and is then the only candidate. So the ordinary build is
the reproducible one, and `check-changelog` says in its summary whether it
compared the two (`drift none`) or had nothing to compare against
(`drift not-compared (no EOS_REPO)`).

Measured on the reference host (macOS, node v26.4.0, npm 11.17.0) on 2026-09-03,
with `EOS_REPO` pointing at the E-OS orchestration checkout:

```
check-i18n: PASS -- en+pl · 578 keys · 280 referenced · 18 components · 0 findings
check-changelog: PASS -- EOS_REPO · 93714 B · sha256 64eae8586419 · crlf=true · 4 releases · 11 sections · 229 entries · drift none (EOS_REPO == vendored) · 0 findings
check-contrast: PASS -- 3 themes · 28 pairs measured · tightest light line/ink 1.41:1 vs 1.3:1 · 0 findings
check-ci: PASS -- 6 jobs · 6/6 on eos-heavy · 0 findings
gen-products: PASS -- products.json matches <EOS_REPO> (9 products, 26 packages seen)
[build] 27 page(s) built in 392ms
check-built: PASS -- 27 pages · pl+en · 13 routes/locale · 689 internal links · downloads gate closed · 0 findings
negative-tests: 27 passed, 0 failed, 0 skipped (of 27 cases)
```

Without `EOS_REPO` the same commands give
`check-changelog: PASS -- vendored · … · drift not-compared (no EOS_REPO)` and
`negative-tests: 25 passed, 0 failed, 2 skipped (of 27 cases)` followed by
`FAIL (instrument) … 2 of 27 case(s) could not run`, exit **2**. That is the
intended behaviour, not a regression: see *The suite counts its own cases* below.

Two of those lines are snapshots of a moving source, and both moved while they
were being measured. The E-OS repository took two merges that afternoon: the
changelog went from 86446 B / 226 entries to the numbers above, and the x86_64
package configuration went from 24 package entries to 26 — `eos-guard` shipping
as an application again (roadmap `PR-002`, owner decision of 2026-09-03) and
`libonig`, which is a runtime dependency of `cosmic-edit` and not a product.
Both gates went red on their own, before anybody looked. That is the drift check
doing its job, not a defect.

---

## Layout

```
astro.config.mjs        static output; publishes into public/, assets live in static/
site.config.mjs         locales, links, the downloads gate flag, the ticket project
a11y.contrast.json      the contrast pairs the accessibility statement claims
src/i18n/               pl.json, en.json and the runtime that throws on a missing key
src/lib/changelog.mjs   Keep a Changelog parser, CRLF-aware, with provenance
src/lib/routes.mjs      the one route table: navigation, footer, switcher, sitemap
src/data/products.json  GENERATED -- run scripts/gen-products.mjs, never hand-edit
src/styles/tokens.css   the Crimson palette, with the measured ratios in the header
scripts/                the gates and the generators:
                          check-i18n.mjs      catalogues and bare strings
                          check-changelog.mjs parser fixtures, invariants, drift
                          check-contrast.mjs  every claimed colour pair
                          check-ci.mjs        the pipeline's own invariants
                          check-built.mjs     the built HTML, not the exit code
                          gen-products.mjs    writes src/data/products.json (--check)
                          sync-changelog.mjs  refreshes vendor/CHANGELOG.md
                          negative-tests.sh   breaks each of them on purpose
docs/                   ai-chat-design.md, ticket-system.md
vendor/CHANGELOG.md     byte copy of the E-OS changelog, so CI can build without the tree
support-project/        the four GitLab issue templates the ticket flow needs,
                        to be installed in the e-os/eos-support project
```

---

## The rules this repository follows

From the E-OS working contract (`CLAUDE.md`), applied here rather than quoted:

**Every check can fail, and has been seen failing.** `scripts/negative-tests.sh`
breaks something on purpose in a throwaway copy of the tree — a deleted
catalogue key, a bare string in a component, the desktop's own muted colour that
measures 4.0:1, a changelog with the CRLF pin lost, a pipeline that lost its
runner tag, a download link smuggled into the built HTML — and asserts both the
exit code and the message. It also runs an untouched copy first, because without
that control a red result could just mean the copy is broken. Twenty-seven
cases, five of them controls.

**The suite counts its own cases.** `EXPECTED_CASES=27` is declared at the top,
and cases that cannot run — `built/*` without a build, `products/*` without
`EOS_REPO` — are counted as skipped and end the suite with exit **2**, not 0.
Measured before this was so: moving `public/` aside made five of the then
twenty-three cases vanish and the suite still printed `18 passed, 0 failed` and
exited 0, a verdict a pipeline cannot tell apart from a fully exercised run.
The escape is `EOS_ALLOW_SKIPPED_CASES=1`, and `.gitlab-ci.yml` sets it on the
`gates-negative` job with a comment naming the two cases CI cannot run. The
count also fails **upward**: 27 cases against a stale `EXPECTED_CASES=26` is
exit 2 as well, so the constant cannot quietly fall behind.

**The artefact is read, not the exit code.** `astro build` returning 0 says a
build ran. `check-built.mjs` opens the HTML it produced and measures the things
that would otherwise be claims: no artefact link while the download gate is
closed, `lang` on every document, one `h1`, the landmarks and the skip link,
every internal link resolving to a file that exists, and every route present in
both locales (E-OS `CLAUDE.md` §5.3).

**Exit 1 is a defect, exit 2 is a broken instrument.** A gate that cannot run
never reports a pass. `check-i18n` with no catalogues exits 2; `check-changelog`
with no source exits 2, and does so even when
`EOS_ALLOW_MISSING_CHANGELOG=1` lets the *site* build without one.

**Fail closed, with an explicit escape.** The build fails when the changelog
source cannot be found. `EOS_ALLOW_MISSING_CHANGELOG=1` is the way past it, and
the page then names the escape in its provenance line rather than rendering an
empty section that looks like a quiet week.

**Pages say what is measured, never what is hoped.** The home page carries the
verified properties and the unfinished ones on the same screen. The
accessibility statement lists what has *not* been checked — no screen-reader
pass, no automated audit — instead of leaving those out.

**Generated files are regenerated, not edited.** `src/data/products.json` says
so in its first key, and `npm run check:products` fails when it no longer
matches the configuration it claims to come from.

---

## i18n

Polish and English, from the first commit (`WS-002`). Two rules, both enforced:

1. `t('missing.key')` **throws**, so an untranslated key fails `astro build`
   instead of shipping an English word onto a Polish page.
2. `scripts/check-i18n.mjs` refuses a bare string literal in a text position, or
   in `aria-label`, `alt`, `title` or `placeholder` — **in either quote style,
   and in `attr={…}` expression form**. It also refuses a string literal inside
   an `{…}` expression that renders as visible text, a key that exists in one
   catalogue and not the other, an empty value, a `t()` call for a key nothing
   defines, and a catalogue key nothing references.

Both of those emphasised clauses are there because they were holes. Measured on
2026-09-03 against the previous version: `aria-label='Main content'` in single
quotes, and `<p>{true ? 'Download the image now' : 'Nope'}</p>`, each shipped
hardcoded English onto the Polish page with `check-i18n`, `astro build` and
`check-built` all green — the attribute pattern read only double quotes, and
every `{…}` expression was deleted before scanning. `negative-tests.sh` now
carries `i18n/literal-attr-singlequote` and `i18n/literal-in-expression`, so the
suite proves the gate against both forms rather than certifying one of them.

Three escapes, all explicit and all visible in a diff:

- `data-i18n-literal` on an element exempts that element's own text. It is used
  for the wordmark and for command samples.
- `/* i18n-literal */` immediately before a string literal inside an expression
  exempts that one literal.
- a literal inside a `t()` / `list()` / `entries()` call that contains **no
  whitespace** is a catalogue key or a single identifier being fed into a
  translated sentence — `t('legal.header', { owner: 'Gh0s777tt' })` — and is
  exempt. A multi-word value in the same position is still a finding, because a
  phrase belongs in the catalogue.
- `// i18n-dynamic: some.prefix.` in a source file marks a key prefix as
  referenced dynamically — for `products.item.<id>.summary` and the like.

**What this gate does not read.** Stated because a gate believed to cover more
than it does is worse than a narrow one: a literal in an expression that is
neither a text node nor one of the four text-bearing attributes is not scanned
(a custom component prop, `<Card body={'Hello'} />`); `<script>` blocks are
blanked before scanning, so anything a script writes into the DOM at runtime is
invisible to it; and a brace or quote inside a string can unbalance the crude
`{…}` scanner.

**Nothing else covers those.** `check-built.mjs` reads the produced HTML, but
only for structure — the download gate, `lang`, the landmarks, the internal
links, the locale coverage — and measures no language whatsoever. Measured
2026-09-03: with `aria-label='Main content'` injected, `check-built` reported
`PASS … 0 findings`. So a hole in `check-i18n` is a hole, not something a second
level catches; that is why the two forms above were worth fixing rather than
documenting, and why the remaining limits are listed here instead of implied
away.

Arrays are compared element by element, so a Polish list one row shorter than the
English one is a finding rather than a shorter page.

---

## The downloads gate

Developer-only for now (`WS-005`). On a static host that cannot mean a check —
GitLab Pages serves files and asks nothing — so it means the links are **not
written into the HTML at all**. `site.config.mjs` carries
`downloads.developerOnly: true`; while it is true, `downloads.artefacts` is
never rendered. The page says this in the reader's language, including the part
where a client-side toggle would be decoration rather than access control.

Flipping the flag to `false` and filling `downloads.artefacts` publishes them.
Nothing else changes.

---

## Tickets

There is no backend, and a ticket system exists anyway (`WS-009`): tickets are
issues in `e-os/eos-support`, opened from a prefilled GitLab new-issue URL that
the support page composes in the reader's browser. Nothing is sent from this
site; the reader reviews the text on GitLab and submits it there.

The flow, the four categories and — more importantly — the limits are in
[`docs/ticket-system.md`](docs/ticket-system.md).

---

## AI chat

Designed, not built (`WS-010`). No endpoint exists, nothing on this site reaches
a model, and `site.config.mjs` carries `support.aiChat.built = false` — a value
the support page asserts at build time, so flipping it without rewriting the
panel fails the build.

The design for an own model on a CPU-only Rust host, what it would cost, and
what is not possible today is in
[`docs/ai-chat-design.md`](docs/ai-chat-design.md).

---

## CI

`.gitlab-ci.yml` runs every job on the **`eos-heavy`** runner. That is not a
preference: GitLab shared runners for this account are quota-limited and run out
intermittently, and GitHub Actions has never produced a run for this
organisation. The self-hosted runner spends no shared minutes, which makes it
the only executor known in advance to run.

Six jobs: `i18n`, `changelog`, `contrast`, `pipeline`, `gates-negative` and
`pages`. The `pipeline` job checks the pipeline itself — every job carries the
`eos-heavy` tag, no script line ends in `|| true`, no `allow_failure: true`
without a reason on the same line, and the `pages` job publishes `public/` and
then reads what it published. A gate that loses its runner tag does not go red;
it goes nowhere, and nothing else in the file would notice.

`check:products` is deliberately **not** a job. It compares the generated
product data against `config/*/eos.toml` and `repos.toml` in the E-OS
orchestration repository, which is not checked out on the runner — there it
could only ever exit 2 (instrument). It runs on the machine that has both trees,
with `EOS_REPO` naming the second one.

Consequently `gates-negative` sets `EOS_ALLOW_SKIPPED_CASES: "1"`: two of the
suite's twenty-seven cases (`products/stale`, `products/portable`) need that
checkout. The escape is in the pipeline file, in the diff, naming what CI does
not measure — rather than a skip the script swallows on its own.

`|| true` appears nowhere in the pipeline, and `check-ci.mjs` is what keeps that
sentence true.

---

## Licence

AGPL-3.0-or-later, the same as E-OS. See [`LICENSE`](LICENSE).

Redox OS is a trademark of the Redox OS nonprofit. E-OS is an independent
downstream distribution, is not official Redox OS software, and is not endorsed
by or affiliated with the Redox OS project. The site's trademark page states
this in full.
