---
title: Support assistant — design for an own model on E-OS
status: design only, nothing built
last-reviewed: 2026-09-03
owner: Gh0s777tt
roadmap: WS-010 (decision), CS-001, CS-009, CS-010, CS-205, WS-006, WS-008
---

# Support assistant — design

**Nothing in this document exists.** There is no endpoint, no model file, no
index and no code. The support page says the same thing in the same words, and
`site.config.mjs` carries `support.aiChat.built = false`, which the support page
asserts at build time: flipping that flag without rewriting the panel fails the
build.

The decision it implements (owner, 2026-09-03, roadmap `WS-010`): if E-OS ever
has a support assistant, it runs **its own model on its own machine**. Calling
somebody else's hosted API to answer questions about a system whose entire
selling point is a verifiable trust chain would contradict the premise. That
decision has a price, and this document is mostly about the price.

---

## 1. What the platform actually provides today

Measured against the E-OS tree and roadmap on 2026-09-03, not assumed.

| Thing the design needs | State on E-OS today | Evidence |
|---|---|---|
| A server edition to run on | **Does not exist as a built artefact.** Upstream ships `config/server.toml` and `config/x86_64/server-demo.toml`, and the desktop image already pulls the server package set — but CI and `eos-build.sh` build only `CONFIG_NAME=eos`, so no headless image has ever been built or booted here | `CS-001` |
| A GPU stack | **None.** No GPU driver, and no linear-algebra library in the image | `CS-205`, ROADMAP §8 |
| A database | **None outside `wip/`.** `sqlite3` and `postgresql16` are unbuilt recipes; SQLite is built *inside* an application (`eos-notes`) rather than as a service | `CS-003`, `CS-008` |
| TLS termination | `openssh` and `nginx` are in the image; `rustls` with the redox-os `ring` fork links on Redox through the installer's `reqwest` path. A TLS-terminating **service** has not been proven on E-OS | `PR-012` inventory |
| Proof that a `wip/` recipe builds at all | **A gate that does not exist yet**, and whose honest answer may be "it does not build" | `CS-009` |
| A headless smoke test | Planned, not written | `CS-010` |

Everything below is therefore sequenced behind `CS-001`, and the first two
phases are deliberately designed to be useful **before** it exists.

---

## 2. Model class that fits a CPU-only Rust host

### 2.1 The constraint, stated plainly

No GPU driver means CPU inference. Redox means the whole stack has to build for
`x86_64-unknown-redox` through the cookbook, against `relibc`. That rules out
the usual answer (`llama.cpp` and its C++ toolchain plus platform back-ends) not
because it is C++ — the tree builds plenty of C — but because its build system,
its threading assumptions and its `mmap` use are the parts most likely to be the
ones Redox has not finished. **[UNVERIFIED]** — nobody has tried.

The Rust candidates, in the order they are worth trying:

| Candidate | Why | Risk on Redox |
|---|---|---|
| `candle` (CPU back-end) | Pure Rust, its CPU matmul goes through the `gemm` crate, no C toolchain | SIMD via `std::arch`; needs threads. **[UNVERIFIED]** |
| `burn` with the `ndarray` back-end | Pure Rust, portable by design | Heavier dependency graph, more surface to fail |
| A hand-written GGUF loader plus `gemm` | Smallest dependency surface, and the format is documented | The most work; only worth it if the two above fail to build |

**The first task of phase 2 is not to make it fast. It is `CS-009` applied to
this stack: does it build, and does a forward pass produce the same logits as
the same weights on a Linux host?** A different answer on the two hosts is a
defect in the port, and it is the kind that produces plausible text rather than
an error — which is exactly why it needs a fixture, not a smell test.

### 2.2 Size, because size is the whole argument

Rough figures for a decoder-only instruction-tuned model, weights quantised to
roughly 4 bits per parameter, plus KV cache for a short context:

| Parameters | Weights on disk | Resident memory, 4k context | Verdict for this use |
|---|---|---|---|
| ~0.5 B | ~0.4 GB | ~0.8 GB | Fits anywhere; too weak to be trusted to paraphrase a security caveat |
| **1–3 B** | **0.8–2.0 GB** | **1.5–3.5 GB** | **The target.** Adequate *when it is only rephrasing retrieved text* |
| 7–8 B | ~4.5 GB | ~6 GB | Better answers, but the throughput below stops being usable |
| 13 B and up | ≥8 GB | ≥10 GB | Out of scope on CPU |

Throughput: on ordinary x86_64 server cores, published figures for a 3 B model
at 4-bit on CPU sit in the single digits to low tens of tokens per second.
**Nothing has been measured on Redox, or on any E-OS build — [UNVERIFIED].**
A 200-token answer at 8 tokens/s is 25 seconds. That is tolerable for a support
page with a visible progress state and intolerable as an interactive chat, and
the interface has to be designed for the former.

The design therefore **does not** promise a chat. It promises *one question, one
cited answer*, with the retrieved sources shown before the model finishes.

### 2.3 The model file is a supply-chain artefact

A model is a several-gigabyte binary blob that determines what the project says
to its users. It gets the same treatment as any other artefact in this project,
not an exemption for being big:

- pinned by digest, exactly like a tarball in a recipe (`blake3`, the same as
  `eos-check-tar-pins.py` enforces);
- distributed through the signed channel, not fetched at runtime from a
  third-party host;
- the licence of the weights recorded next to the pin, because "open weights"
  and "open source" are not the same thing and several popular families forbid
  exactly this use;
- reproducible quantisation: the recipe records the source checkpoint and the
  quantisation command, so the blob can be rebuilt rather than trusted.

If a candidate model cannot satisfy those four, it is not a candidate.

---

## 3. Retrieval, because the model is not the knowledge

The model's job is to **rephrase retrieved text**, never to recall. Everything
the assistant is allowed to say comes from a corpus built at site-build time.

### 3.1 Corpus

In: `README.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `CHANGELOG.md`, `SECURITY.md`,
`HARDWARE.md`, `CLAUDE.md`, everything under `docs/`, and this website's own
pages in both languages.

Out, deliberately:

- **Tickets and issues.** They are written by other people; putting third-party
  text into a corpus a model paraphrases is an injection channel, and a support
  answer that quotes an unverified bug report is worse than no answer.
- **Source code.** The assistant is not a code explainer, and code out of
  context is the easiest way to produce a confident wrong answer.
- **Anything not committed.** If it is not in the repository, it cannot be cited,
  and an answer that cannot be cited is not shipped.

### 3.2 Index

Two stages, both built offline on the machine that builds the site, and shipped
as data:

1. **Lexical (BM25) over chunks of ~400 tokens**, one chunk never crossing a
   heading boundary. This alone answers most questions on a documentation site,
   and it is the whole of phase 0.
2. **Dense retrieval** with a small sentence-embedding model (tens of millions
   of parameters, quantised — under 100 MB), reranking the lexical top 50.

The index is a file. The server reads it; it never writes it. That keeps the
runtime read-only, which is the property that makes the whole thing safe to run
next to a system whose selling point is integrity.

**Bilingual, and honestly so:** the corpus is mixed Polish and English, and the
changelog is largely Polish. Chunks carry their language; a question in Polish
retrieves Polish chunks first and falls back to English with the answer saying
so. Machine-translating the corpus is out — it would silently paraphrase
measurements, which is the one thing this project does not do.

---

## 4. Guardrails

Written as refusals, because a guardrail phrased as a preference is a
suggestion.

1. **No tools.** No shell, no filesystem beyond the index, no network, no
   package operations, no ticket creation. The process runs with the smallest
   scheme set that lets it read its index and answer a socket — E-OS already has
   the mechanism for that in `login_schemes.toml`.
2. **No answer without a citation.** Every sentence is grounded in a retrieved
   chunk, and the chunk's file and heading are shown next to the answer. If
   retrieval returns nothing above the threshold, the assistant says it does not
   know and offers the ticket form. That refusal path is the most important
   feature in this document.
3. **Security questions are refused by category, not by judgement.** Anything
   matching the vulnerability-report topic gets a fixed response pointing at
   `SECURITY.md` and the private channels. A model must never be the first
   responder on a disclosure.
4. **Retrieved text is data.** The prompt separates instructions from retrieved
   content, and the retrieved content is never allowed to change the system
   instruction. Since the corpus is committed project text, this is defence in
   depth rather than the primary control — the primary control is corpus
   selection (§3.1).
5. **Nothing is stored per user.** No conversation history, no account binding,
   no IP logging beyond what the web server already does. Aggregate counters
   only: questions asked, refusal rate, the retrieval-miss list. That last one
   is the useful output — it is a queue of documentation gaps.
6. **A visible, stable disclaimer.** Not "AI can make mistakes", which people
   have learned to skip, but the specific true statement: *this answers only
   from the project's own documents, and it can be wrong about anything not in
   them.*
7. **A kill switch that is a configuration flag, not a deployment.** The same
   pattern as the downloads gate: when it is off, the endpoint is not published.

---

## 5. What is not possible today

Listed so that the phases below are read as a cost, not a schedule.

- **Running it on E-OS.** There is no built server edition (`CS-001`), no
  headless smoke test (`CS-010`), and no evidence that any Rust inference crate
  compiles under `redoxer` (`CS-009` is the gate that would answer this, and it
  is allowed to answer "no").
- **Any GPU acceleration.** No driver, no plan, and the roadmap keeps that
  behind its own programme (`CS-205`, ROADMAP §8).
- **Accounts, rate limits per user, or handing a conversation to a ticket.**
  Those need `WS-008` (accounts), which needs `CS-003` (a database) and `CS-008`
  (mail). None of the three exists.
- **Fine-tuning on the project's own documents.** It needs hardware the project
  does not have, and retrieval gets most of the benefit at none of the cost.
- **Answering questions about a user's own machine.** The assistant cannot read
  anything from the person asking, by design (§4.1).

---

## 6. Phases

Each phase is useful on its own and none of them blocks on the next one.
Sizes use the roadmap's scale: S ≈ days, M ≈ a week or two, L ≈ a month or more,
XL ≈ a programme.

| Phase | What ships | Depends on | Size |
|---|---|---|---|
| **0. Search, no model** | The BM25 index of §3.2 built at site-build time, and a client-side search page. Zero inference, zero server. Answers "where is this documented" for most questions, and produces the retrieval-miss list that the later phases need | `WS-006` | **S** |
| **1. Answer cards, still no model** | Curated question → answer pairs from the FAQ, each linking the document it came from, matched by the same index. Honest about being a lookup table. Kills the most-asked questions without any of the risk | phase 0 | **S** |
| **2. The pipeline, on a Linux host the project owns** | Retrieval plus a 1–3 B quantised model behind a small Rust HTTP service, with §4's guardrails, a fixture suite and a measured tokens-per-second figure. Runs **not** on E-OS — that is the point of the phase: prove the pipeline where the platform is not also the experiment | a machine; the model licence check of §2.3 | **L** |
| **3. The same service on E-OS** | `CS-009`-style build gate for the inference crate under `redoxer`; the logits fixture from §2.1 compared between hosts; TLS termination proven on E-OS; the service running on a `CS-001` image with `CS-010` covering it | `CS-001`, `CS-009`, `CS-010` | **XL** |
| **4. Support integration** | Rate limits, the ticket hand-off from a refusal, and the retrieval-miss queue turned into documentation issues | `WS-008`, `CS-003`, `CS-008` | **L** |

**Order that costs least:** 0 → 1 → 2 → 3 → 4. Phases 0 and 1 are worth doing
even if the answer to phase 3 turns out to be "the crate does not build on
Redox", which is a permitted outcome and would be recorded as one.

---

## 7. How this design gets falsified

The point of writing it down is that it can be shown to be wrong. It is wrong if
any of these turns out to be true, and each has a cheap test:

| Claim | Test that would falsify it |
|---|---|
| A Rust inference crate can build for `x86_64-unknown-redox` | `cook` the recipe; a failure is the answer, and `CS-009` is where it is recorded |
| The port produces the same output as on Linux | The logits fixture of §2.1, same weights, same prompt, both hosts |
| A 1–3 B model is good enough when it only rephrases retrieved text | A held-out set of real questions from the ticket project, graded by hand, before anything is published |
| Retrieval finds the right chunk often enough to be worth the model | Measure recall@5 on the same held-out set during phase 0, when there is no model to blame |
| CPU throughput is tolerable | Measure tokens per second on the phase-2 host and publish the number, not an adjective |

If phase 0 shows that plain search already answers the held-out set, this
document has done its job by not being built.
