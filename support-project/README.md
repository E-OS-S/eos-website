# eos-support — the files the ticket flow depends on

The E-OS website has no backend. A ticket is an issue in the GitLab project
**`e-os/eos-support`**, opened from a prefilled new-issue URL that the support
page composes in the reader's browser (`docs/ticket-system.md`).

That URL names a description template by file name:

```
https://gitlab.com/e-os/eos-support/-/issues/new?issuable_template=bug
```

GitLab resolves `issuable_template=bug` against `.gitlab/issue_templates/bug.md`
**in the eos-support project**, not in this repository. The four files under
`.gitlab/issue_templates/` here are the copies to install there.

## Install

Copy the directory into the support project and commit it:

```bash
cp -R support-project/.gitlab /path/to/eos-support/
cd /path/to/eos-support && git add .gitlab && git commit -m "chore(support): issue templates for the website ticket flow"
```

## The failure this guards against

If a template is renamed or removed in `eos-support`, the prefilled link keeps
working and quietly produces an **empty description**: no error on either side,
and a ticket with no structure. This website's build cannot see into the GitLab
project, so it cannot catch that. What it does enforce is narrower and local:
`site.config.mjs` lists the four template names, and
`src/components/TicketForm.astro` throws at build time if a support-page
category names anything outside that list.

Verifying that the templates actually exist on GitLab would need a network call
from CI and an API token. A token is a human's to hold (E-OS `CLAUDE.md` §5.7),
so that check is not automated and the limit is written down instead —
`docs/ticket-system.md` §2.1, marked **[UNVERIFIED]**.

## Labels

Each template ends with a `/label ~…` quick action, so the four categories are
distinguishable in the queue without the submitter choosing a label. The labels
`bug`, `question`, `hardware` and `documentation` have to exist in the project;
GitLab silently drops a quick action naming a label that does not.
