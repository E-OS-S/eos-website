---
title: Ticket system — flow and limits
status: in force
last-reviewed: 2026-09-03
owner: Gh0s777tt
roadmap: WS-009 (decision), WS-005, WS-008, CS-003, CS-008
---

# Ticket system

The owner's decision on 2026-09-03 (roadmap `WS-009`): **a ticket system exists
now.** Not after accounts, not after a database, not after mail — now.

The site is static files on GitLab Pages. GitLab Pages serves files and runs
nothing: no form handler, no database, no mail. So "now" and "a backend" are
mutually exclusive, and the honest resolution is to use the ticket store that
already exists and already has authentication, notification, search and an API:
**GitLab issues** in the project `e-os/eos-support`.

---

## 1. The flow

```
person fills the form on /support/
        │  (all of this happens in their browser; nothing is sent)
        ▼
the page composes a URL:
  https://gitlab.com/e-os/eos-support/-/issues/new
      ?issuable_template=<bug|question|hardware|documentation>
      &issue[title]=<url-encoded summary>
      &issue[description]=<url-encoded, assembled from the fields>
        │
        ▼
person follows the link  →  GitLab renders the new-issue form, prefilled
        │
        ▼
person reviews it and presses GitLab's own Submit
        │
        ▼
the issue exists; GitLab assigns the number and sends the notifications
```

Three properties of that diagram are the whole design:

1. **Nothing is transmitted by this site.** The composed URL exists only in the
   reader's browser until they follow it. There is no request from the page to
   anywhere, so there is nothing to log, store or leak.
2. **The person submits, not the page.** The last action is theirs, on GitLab,
   after seeing exactly what will be posted. A page that submitted on their
   behalf would be posting public text they had not read.
3. **The state lives where the work happens.** A ticket is an issue: the
   maintainer already reads that queue, it already has labels, search and an
   API, and there is no second system to keep in step with the first.

### 1.1 What the query parameters are

GitLab's new-issue form reads three parameters, and this is the whole contract
the site depends on:

| Parameter | Effect |
|---|---|
| `issuable_template` | Selects a description template from `.gitlab/issue_templates/` in the project. If the named template does not exist, GitLab shows an empty description — a silent degradation, which §3 covers |
| `issue[title]` | Prefills the title |
| `issue[description]` | Prefills the description; a template named at the same time is overridden by this text |

The site's build fails if a category in the catalogue names a template that is
not listed in `site.config.mjs` (`support.templates`). That is a build-time
assertion in `src/components/TicketForm.astro`, not a comment.

### 1.2 Categories

Four, each mapping to one template that must exist in the GitLab project:

| Category | Template | For |
|---|---|---|
| Bug | `bug` | Behaviour that differs from what is documented |
| Question | `question` | The documentation did not answer it |
| Hardware report | `hardware` | It booted, or did not, on a specific machine |
| Documentation | `documentation` | Something on the site or in the documents is wrong or missing |

The hardware category exists because nothing has been booted on physical
hardware yet (ROADMAP `R-607b`, band E: *blocked on one desktop computer*).
Reports from other people's machines are the only hardware evidence this project
can get right now, which makes that category the most valuable of the four.

### 1.3 Without JavaScript

The support page also renders four plain links, one per category, carrying
`issuable_template` only. They work with scripting disabled; the reader types
the rest on GitLab. The composer is an enhancement over a working page, not a
requirement for one.

---

## 2. Limits — what this arrangement cannot do

Stated on the support page too, in the reader's language, because a limit
documented only for maintainers is a limit the user discovers by being bitten.

| Limit | Why | What would remove it |
|---|---|---|
| **Tickets are public** | Issues in a public project are public from the moment they are submitted | A private support queue needs accounts (`WS-008`) and therefore a database (`CS-003`) |
| **A GitLab account is required** | GitLab authenticates the submitter; this site cannot | `WS-008` |
| **No anonymous reports** | Same reason | `WS-008` |
| **No ticket number until GitLab creates one** | The number is assigned on submission | Nothing; this is inherent and fine |
| **No email from this site** | There is no mail service anywhere in the project | `CS-008` |
| **Long descriptions do not survive a URL** | Browsers and servers cap URL length. The composer counts and warns above 7000 characters | Nothing static can fix it; the composer tells the person to paste the rest after the issue opens |
| **Nothing is saved while typing** | No storage, deliberately (see the privacy policy) | A backend, which is the thing that does not exist |
| **Security reports must not use it** | Public by construction | Already solved: `SECURITY.md` names two private channels, and both the support and security pages say so first, above the form |
| **No status, no SLA display** | The response targets are in `SECURITY.md` and are targets from one maintainer | `WS-008` plus a real support process |

### 2.1 The limit that is easy to miss

If someone renames or deletes a template in the GitLab project, the prefilled
link keeps working and quietly produces an **empty description**. The site does
not fail, the person does not notice, and the maintainer gets a ticket with no
structure. This site's build cannot see into the GitLab project, so it cannot
catch that.

The mitigation is stated rather than pretended away: `support.templates` in
`site.config.mjs` is the list the project promises to keep, the build fails if a
category names something outside it, and changing a template in GitLab is a
change that has to come with a change here. **[UNVERIFIED]** — no automated check
confirms the templates exist on GitLab; doing that needs a network call from CI
and an API token, and a token is a human's to hold (E-OS CLAUDE.md §5.7).

---

## 3. Where this goes next

The roadmap already sequences it, and this design does not shortcut any of it:

- `WS-008` **accounts** — register, log in, delete, with the same credential
  rules as the OS. Needs `CS-003` (a database on the server edition) and
  `CS-004` (identity). Until then, GitLab is the account system.
- `CS-008` **mail** — an MTA exists only as an unbuilt recipe, and no IMAP
  server exists on Redox at all. Until then, GitLab sends the notifications.
- `WS-009` **the native ticket system** — the row this document implements the
  interim of. When it arrives, the migration is issues → the new store, which is
  a straightforward export because the source has an API.

Until those exist, a prefilled link to a real issue tracker is the version of a
ticket system that can be true today. The alternative — a form that looks like
it works and quietly discards what people type — is the failure mode this
project writes gates against.
