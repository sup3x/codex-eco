# Contributing to codex-eco

This project sells one thing: that its numbers are true and that anyone can recheck them. Every rule
below protects that, which is why the bar for changing a *rule* is much higher than the bar for
changing the tooling around it.

## What you need

- **Node.js 24 or newer.** Nothing else. Zero runtime dependencies, zero dev dependencies, no
  lockfile, no build step. `npm install` has nothing to install.
- **Codex CLI**, authenticated, but only if you intend to run benchmarks. Every CI check runs offline.
- **Headless Chrome**, only to rasterise the charts and the social card. Optional; CI does without it.

Everything is ESM (`.mjs`); paths are joined with `node:path`, never with a hardcoded separator,
because the maintainer's machine is Windows and CI is not.

## Running the checks

```bash
npm test                 # unit tests (node:test)
npm run check:skills     # eco-max and AGENTS.eco.md are generated from eco and must be in sync
npm run check:repo       # manifests, frontmatter, profiles and README image urls
npm run check:charts     # every chart and both README results blocks match the published data
npm run check:assets     # the social card matches the published data
npm run check:grades     # every published run still grades the same under the current rubric
```

None of these costs anything, and none of them needs `bench/results/` — see below. CI runs exactly
these plus repository hygiene: skill frontmatter must carry `name` and `description` and the name must
match the directory; every rule variant must differ from the shipped body in exactly one line;
`install.sh` must be committed executable; every `.ps1` must be **pure ASCII** and parse under Windows
PowerShell 5.1.

That last one is not pedantry. A single non-ASCII character in a BOM-less `.ps1` makes PowerShell 5.1
decode the file as the system ANSI codepage, the string terminator is lost, and the parser gives up.
The sibling project shipped that bug for five releases. Use `-`, `'` and `...`, never their
typographic cousins.

## The two data locations, and why it matters

- **`bench/results/<tag>/`** is a working directory. It is **gitignored**. Batches land here.
- **`bench/manifest.json` + `bench/raw/`** is the **published record**. It is committed.

Every generated artifact — both READMEs' results blocks, all eight charts, the social card — is
computed from the *published record*, never from the working directory. That is not a style
preference: generating from `bench/results/` meant a clean checkout could not reproduce a single
chart, and CI proved it by regenerating them empty and correctly calling the committed ones stale.

So a batch is not part of this project until it is published:

```bash
node bench/bench.mjs publish <result-tag> --study <study-id> --prefix <file-prefix>
```

`bench/headline.json` then decides which *study ids* may produce a README claim. Everything published
stays published, including retractions and results that went the wrong way; the gate only controls
what is allowed to become a headline.

## Changing the rules

`plugins/eco/skills/eco/SKILL.md` is the single source. `eco-max`, `AGENTS.eco.md` and the rule
variants are **generated** from its `<!-- eco:rules:start -->` block — never edit them by hand:

```bash
npm run build:skills      # regenerate eco-max and AGENTS.eco.md
npm run build:variants    # regenerate bench/candidates/*
```

`AGENTS.eco.lean.md` is the exception: it is hand-curated, it is what `./install.sh` writes by
default, and CI caps its rule block at 1,600 bytes. That cap is the point of the file — the block is
re-sent on every request, so its size is a per-turn cost.

A change to the rules ships only with a **pre-registered study**: write the endpoints and the
thresholds down first, in `bench/preregistration/`, then run it. See
[`bench/preregistration/001-first-study.md`](bench/preregistration/001-first-study.md), which is the
format in use and also the record of two retracted studies of our own.

Four rules about rules, all learned the hard way:

1. **Never name a mechanism you have not verified exists.** Codex has one shell tool, `apply_patch`,
   `new_context`, and ripgrep on PATH — it has no editor tools, so a rule about "Edit over Write"
   would be advice about a tool that is not there. Check the binary or the docs first.
2. **A rule that instructs the agent to repeat output the user can already see is not frugality.**
3. **Prefer varying the AGENTS.md block over varying a SKILL body.** Codex publishes a skill as one
   catalogue line; whether the body is ever read is a model decision. Two studies here compared arms
   that had never loaded their rules. If you do use `--variants`, check the SKILL.md-read count the
   harness prints before believing the result.
4. **One batch settles nothing on this task.** The bar is the direction repeating across independent
   batches, and the effect published is the range across them, never one batch's number.

## Contributing a benchmark result

Very welcome, especially from other models, plans and platforms:

```bash
node bench/bench.mjs study review-thread --n 5 --model <model> \
  --agents-file "lean=AGENTS.eco.lean.md" --codex-home <an isolated CODEX_HOME>
```

Use an isolated `--codex-home`. The harness will refuse to start if a staged skill name does not
resolve to exactly one file inside its workspace — that check exists because a stale copy of `eco` in
`$HOME/.agents/skills` had been appearing in the catalogue beside the copy under test, in every batch
this project ran before it was added.

Attach the `bench/results/<tag>/` directory — it contains every run's event stream — and say which
model, effort, verbosity and Codex version you ran. **Results where eco loses are as publishable as
results where it wins**, and there are several in here.

## Changing the grader

Grading is deterministic and every raw stream is committed, so a rubric change can and must be applied
retroactively to every arm of every batch at once:

```bash
npm run regrade -- --write
```

It prints a per-arm before/after. Read it before believing the change: a widening that only ever moves
the treatment arm is a widening that was chosen rather than fixed. Both widenings in this project's
history are recorded in the pre-registration with their full effect, including the argument for why no
baseline could have moved. CI re-grades the published record on every push and fails if a committed
grade moves.

## Style

Comments explain *why*, not *what*. No emoji in code. Plain ASCII in every file that a Windows
toolchain might read. Keep the rule blocks short — they are the product, and every line in them is
billed on every turn.

One more, specific to this repository: **never print a measurement without its sign**. A `Math.abs()`
in front of a hardcoded minus once rendered a result that went the wrong way as one that went the
right way, in the image most likely to be quoted without any surrounding text. Bar *lengths* may be
magnitudes; every number a reader sees carries its sign.
