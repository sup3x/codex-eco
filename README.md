# codex-eco — eco mode for Codex

**Your Codex session costs ~5,000 tokens before you type a character. `codex-eco` measures that with a free offline audit, cuts 35–59% of it with settings verified against your own Codex build, and installs behavioural rules through the one channel that costs nothing to deliver — 16% cheaper threads, 37% fewer output tokens, no preamble turn, both planted bugs still found in every run.**

**The interesting part is the measurement that told us the obvious channel was the wrong one.** Two of this project's own studies are retracted in public, and the design changed because of it.

Works in **Codex CLI** and in **Codex inside the ChatGPT desktop app**. One install covers both.

[English](README.md) · [Türkçe](README.tr.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) [![Codex CLI](https://img.shields.io/badge/Codex%20CLI-0.147-black)](https://developers.openai.com/codex) [![Validated](https://img.shields.io/badge/validated%20by-Codex's%20own%20validators-brightgreen)](#how-every-claim-here-was-checked)

![codex-eco](https://raw.githubusercontent.com/sup3x/codex-eco/main/assets/social-preview.png)

## Quickstart

```bash
git clone https://github.com/sup3x/codex-eco && cd codex-eco && ./install.sh
```

Windows: `.\install.ps1`.

That is the whole setup. **There is nothing to invoke** — the rules go into `$CODEX_HOME/AGENTS.md`, which Codex loads into the prompt on every turn, at every reasoning effort, on every model, in the CLI and in the desktop app alike. Open a new session and it is on.

```
$ ./install.sh
codex-eco
  rules:      /home/you/.codex/AGENTS.md (global, short block)
  skills dir: /home/you/.agents/skills (default)
  rules: block appended to /home/you/.codex/AGENTS.md (short; previous file at .../.eco-backups/AGENTS.md-20260817-135234)
  eco: installed and verified (3 files)
  eco-max: installed and verified (2 files)
```

The block is delimited by `<!-- codex-eco:start -->` / `<!-- codex-eco:end -->`, so re-running replaces it in place instead of appending a second copy, `--uninstall` removes exactly it and leaves the rest of your file untouched, and anything about to change is copied to `.eco-backups/` first. Both installers produce byte-identical files.

| | What | When |
|---|---|---|
| `./install.sh` | rules globally + both skills | the default |
| `./install.sh --project` | rules into this repo's `AGENTS.md` | you want it per-project, or in a repo you share |
| `./install.sh --full` | the complete 3.6 kB rule block instead of the 1.1 kB one | you would rather have every rule than the cheapest block |
| `./install.sh --rules-only` / `--skills-only` | one half | you only want one |
| `./install.sh --uninstall` | removes the block and the skills | |

The skills stay available for two jobs the rules file cannot do:

| | Codex CLI | Codex in the ChatGPT desktop app |
|---|---|---|
| Configure your setup | `$eco setup` | `@eco setup` |
| Turn the mode on for one thread | `$eco <task>` | `@eco <task>` |

Invoking a skill costs one extra shell round trip, for a reason worth understanding before you rely on it — see [why the rules do not live in the skill](#why-the-rules-live-in-agentsmd-and-not-in-the-skill).

## Why the rules live in AGENTS.md and not in the skill

This is the project's main finding, and it cost a retraction to learn.

[![Cost of one three-turn thread, three ways of delivering the same rules](https://raw.githubusercontent.com/sup3x/codex-eco/main/assets/surfaces.png)](https://raw.githubusercontent.com/sup3x/codex-eco/main/assets/surfaces.svg)
Codex publishes a skill to the model as **one catalogue line** — name, description, and a path:

```
- eco: Token-frugal mode for Codex - fewer tokens per turn ... (file: ~/.agents/skills/eco/SKILL.md)
```

The body is not in the prompt. You can see this for yourself without spending a token, because
`codex debug prompt-input` renders the exact model-visible input list offline:

```bash
codex debug prompt-input '$eco review src/app.ts' > with.json
codex debug prompt-input 'review src/app.ts'      > without.json
diff with.json without.json      # they differ by five bytes: the literal "$eco "
```

Three consequences follow, and all three are measurable:

1. **The rules only apply after the agent reads the file.** That read is a shell command — a full extra
   round trip, and a round trip re-sends the entire prefix. Measured on `gpt-5.6-terra`, invoking `$eco`
   raised cached input from 28.2k to 43.7k tokens on a single-turn task.
2. **The one rule with the largest measured effect cannot work through a skill at all.** "Your first
   output is a tool call, not an announcement" is violated *before* the body is read: at the moment the
   model decides to invoke a skill, it has seen only the description. In 5/5 runs it announced the mode,
   then read the rule telling it not to. No wording fixes this; it is the invocation order.
3. **Whether the body gets read is a model decision, not a guarantee.** Re-scanning every run this
   project ever recorded for a command touching `SKILL.md` found 10/10 reads in some batches and **1/20
   in others**. Two whole studies had therefore compared a baseline against itself, and their results are
   retracted in `bench/preregistration/001-first-study.md` rather than quietly deleted.

`AGENTS.md` has none of these properties. Codex injects it verbatim, inside `<INSTRUCTIONS>`, with no
round trip and no decision to make — confirmed the same free offline way, by planting a marker string in
the file and finding it in the rendered prompt. That is why the installer's primary act is to write the
block, and why the skill is documented as the secondary path.

**What the skill is still for.** `$eco setup` — reading your config, proposing the levers, applying
nothing without confirmation — is a one-shot job where an extra round trip is irrelevant. And invoking
`$eco` mid-thread is the only way to turn the discipline on in a repository whose `AGENTS.md` you do not
control.

## Two costs, and only one of them needs statistics

Keeping these apart is the difference between an honest claim and a marketing number:

| | How it is measured | How stable it is |
|---|---|---|
| **The fixed prefix** — the skills catalogue, the plugin advert, the instruction prose sent before you type | `codex debug prompt-input`, offline, no model call | Deterministic. Run it twice, get the same bytes. Reported as exact character counts. |
| **The rules' effect on behaviour** | A live model, n=5 per arm, arms interleaved in one batch, deterministic grading | Noisy. On this task a single batch cannot settle a direction, so the bar is the direction repeating across independent batches and the published effect is a range. |

The audit is the part you can verify on your own machine in one second. The behavioural numbers are the
part this repository argues about at length, in the open, including where they came out against us.

## See where your tokens go — before spending any

The most useful thing in this repository costs nothing to run and makes no model call:

[![What a Codex session costs before you type a character](https://raw.githubusercontent.com/sup3x/codex-eco/main/assets/prefix.png)](https://raw.githubusercontent.com/sup3x/codex-eco/main/assets/prefix.svg)
```bash
node scripts/prefix-audit.mjs
```

<!-- codex-eco:audit:start -->
```
section                           chars   ~tokens
-------------------------------------------------
skills catalog                   15,211     3,803
recommended-plugins advert        2,371       593
core instruction prose            2,269       567
multi-agent mode note               271        68
-------------------------------------------------
TOTAL before you type            20,122     5,031

configuration                     chars   ~tokens      change
-------------------------------------------------------------
as configured now                20,122     5,031           -
eco profile (safe)               13,166     3,292      −34.6%
eco profile (aggressive)          8,250     2,063      −59.0%
```
<!-- codex-eco:audit:end -->

Those are real numbers from one machine, produced by `codex debug prompt-input` — the exact item list Codex will send. Run it in your own project and you get your own numbers, including what your `AGENTS.md` costs. Every key the audit suggests is validated against your Codex build with `codex mcp-server --strict-config` before it is offered, so a typo can never masquerade as a saving.

## What you get

| Component | What it does |
|---|---|
| **`AGENTS.eco.lean.md`** | The rules block the installer writes by default: 1.1 kB, hand-curated down to the lines that carried the measured effect. `AGENTS.md` is re-sent on every request, so this file's size is a per-turn cost — CI fails if it grows past 1,600 bytes. |
| **`AGENTS.eco.md`** | The complete rule block, 3.6 kB, generated from the `eco` skill body so the two cannot drift. `./install.sh --full` installs this instead. |
| **`eco` skill** | `$eco setup` reads your config, proposes the levers and applies nothing without confirmation. Invoking `$eco <task>` turns the discipline on inside one thread, at the cost of one round trip. |
| **`eco-max` skill** | The same rules at the tightest reply budget, for routine chores. Generated from `eco`. |
| **`profiles/eco.config.toml`** | The safe prefix tier: four verified settings plus two caps. `codex --profile eco`. |
| **`profiles/eco-max.config.toml`** | Adds a reasoning-effort floor and the aggressive prefix tier. |
| **`scripts/prefix-audit.mjs`** | The free, offline audit below. Validates every key it suggests against your own Codex build before offering it. |
| **`scripts/cost-report.mjs`** | Re-scores any recorded batch on what a turn actually bills, not just output tokens. |
| **`bench/`** | The harness, the deterministic grader, the provenance manifest, and the pre-registrations — including the retractions. |

## Measured results

<!-- codex-eco:results:start -->
### 1. The fixed prefix — deterministic, no statistics

On codex-cli 0.147.0, with 21 skills in the catalogue, the instruction prefix sent before you type is **20,122 characters** (~5,031 tokens). The safe profile takes it to **13,166** (**-34.6%**) and the aggressive one to **8,250** (**-59.0%**). Reproduce it on your own machine in one command: `node scripts/prefix-audit.mjs`.

### 2. Three ways to deliver the rules

`gpt-5.6-terra`, the model's default effort, n=5 per arm, arms interleaved in one batch. Each run is one three-turn thread — review, patch, open question — with usage summed over the thread.

| Arm | cost | vs baseline | output | cmds | preamble | both bugs |
|---|---:|---:|---:|---:|---:|---|
| `no rules` | 49,818 | — | 1,993 | 1.4 | 1.00 | 5/5 |
| `$eco skill` | 63,471 | **+27.4%** (95% CI 19.1% .. 37.7%, p = 0.008) | 2,462 | 2.0 | 1.00 | 5/5 |
| `AGENTS.md full` | 45,601 | **−8.5%** (95% CI −18.8% .. 3.7%, p = 0.222) | 1,328 | 2.0 | 0.00 | 5/5 |
| `AGENTS.md short` | 41,856 | **−16.0%** (95% CI −26.1% .. −5.6%, p = 0.032) | 1,248 | 1.4 | 0.00 | 5/5 |

Every arm found both planted bugs in every run, so cheapness decides. The short block wins; the `$eco` skill loses significantly — [why is above](#why-the-rules-live-in-agentsmd-and-not-in-the-skill).

### 3. Replicated at every reasoning effort

[![Replication across effort levels](https://raw.githubusercontent.com/sup3x/codex-eco/main/assets/efforts.png)](https://raw.githubusercontent.com/sup3x/codex-eco/main/assets/efforts.svg)

The shipped block was run against no rules in 7 independent batches on `gpt-5.6-terra` (n=3 per arm): **6/7 batches moved the same way**, two-sided sign test p = 0.125. Across the 5 levels whose batches agree, the effect ran from **−7.0% to −25.1%**; `none` is unresolved and is described below. Both planted bugs were found at every level in every run. The published number is that range, not any one batch.

The trend is clear and its mechanism is plausible: the higher the effort, the longer the baseline's output, so the more fat there is to cut.

| effort | cost | output | 95% CI | both bugs |
|---|---:|---:|---|---|
| `none #1` | **+34.1%** | −27.4% | −16.1% … 112.9% | yes |
| `none #2` | **−9.1%** | −23.1% | −45.5% … 47.2% | yes |
| `low` | **−7.0%** | −24.7% | −19.2% … 1.5% | yes |
| `medium` | **−14.8%** | −20.4% | −23.5% … −5.0% | yes |
| `high` | **−25.1%** | −35.3% | −37.9% … −17.4% | yes |
| `xhigh` | **−18.6%** | −18.0% | −47.3% … 29.5% | yes |
| `max` | **−24.1%** | −17.6% | −29.2% … −18.2% | yes |

**At `none`, total cost is unresolved.** The 2 independent batches disagree (+34.1%, −9.1%), and the difference sits entirely in the cached/uncached split: with the same block, one batch billed 53,155 uncached tokens and the other 24,865. So the positive figure in the first batch was cache warmth, not a treatment effect — and a single batch would have "shown" the block to be harmful there. Output tokens fell consistently in both (−27.4% and −23.1%), and both planted bugs were found in every run. The total-cost claim therefore covers `low` and above; for `none` the honest word is unresolved, not worse.

### 4. And on every model

[![Replication across models](https://raw.githubusercontent.com/sup3x/codex-eco/main/assets/models.png)](https://raw.githubusercontent.com/sup3x/codex-eco/main/assets/models.svg)

| Model | n | cost | output | cmds | preamble | both bugs |
|---|---:|---:|---:|---:|---:|---|
| `gpt-5.6-terra` | 5 | **−16.0%** | −37.4% | 1.4 → 1.4 | 1.00 → 0.00 | yes |
| `gpt-5.6-sol` | 3 | **−14.5%** | −34.4% | 3.0 → 2.0 | 1.00 → 0.00 | yes |
| `gpt-5.6-luna` | 3 | **−40.4%** | −27.9% | 2.0 → 1.0 | 1.00 → 0.00 | yes |
| `gpt-5.5` | 3 | **−23.3%** | −45.0% | 3.7 → 1.3 | 1.00 → 0.00 | yes |
| `gpt-5.4-mini` | 3 | **−18.0%** | −34.4% | 4.0 → 1.3 | 1.00 → 0.00 | yes |
| `gpt-5.4` | 3 | **−20.2%** | −26.6% | 4.0 → 1.0 | 1.00 → 0.00 | yes |

**6/6 models moved the same way**, two-sided sign test p = 0.03125, effect between **−14.5% and −40.4%**. The preamble turn went to zero on every model, and both planted bugs were found in every run of every model. Absolute counts are not comparable across models — different tokenizers — so what is compared is the percentage within a row.
<!-- codex-eco:results:end -->

## What the rules actually target

Every rule exists because the unarmed agent was observed doing the thing it forbids, in a real transcript:

1. **The preamble turn.** Codex opens with a message announcing what it is about to do — *"I'll inspect the test file and its nearby project context, then summarize"* — and only then runs a command. That is billed output that moves no work forward, and it is the single most reliable effect in this repository: **1.00 preambles per run without the block, 0.00 with it, in every batch measured**. An earlier attempt to pick the best wording for this rule by A/B-testing four phrasings is [retracted](bench/preregistration/001-first-study.md) — 19 of its 20 runs never loaded the rules at all — so the wording shipped is the one that was measured working, not one that won a comparison.
2. **The unasked survey.** Asked to review one file, the unarmed agent also ran `Get-ChildItem -Force` and a tree-wide `rg -n "orders" .` — a directory listing and a full-tree grep nobody requested. On the three-turn thread the block keeps the command count at the baseline's 1.4 while cutting output 37%, so it is removing waste rather than trading one cost for another.
3. **Whole-file dumps.** Codex has no editor tools; everything is a shell command. So the rules are about command hygiene — ask for the region (`sed -n`, `Get-Content -TotalCount`), `rg -l` before `rg -n`, batch independent commands into one call, `apply_patch` instead of rewriting a file through the shell.
4. **Thread growth.** Codex has a `new_context` tool the model itself can call, and its own guidance says compactions can cost accuracy. The rules say: start a fresh context when the history stops mattering, and never switch model or effort mid-thread — measured, that drops the cached-prefix ratio from 0.95 to 0.07.

## What does *not* work, measured

Published Codex guides recommend all of these. None of them saves anything on Codex 0.147:

| Recommendation | Reality |
|---|---|
| `model_reasoning_summary = "none"` | Every current model already defaults to `none`. Zero change. |
| `model_verbosity = "low"` | Already the default on every current model except `gpt-5.4-mini`. Zero change for almost everyone. |
| `hide_agent_reasoning` / `show_raw_agent_reasoning` | Display-only. Measured identical prompt, byte for byte. |
| `features.token_budget` | Under development, and enabling it **adds** ~1,858 characters of guidance to your prompt. |
| `model_supports_reasoning_summaries` | In the official sample config; **rejected as an unknown field** by the installed binary. |
| `minimal` reasoning effort | The CLI accepts any string silently, and the request then fails. Verified on `gpt-5.6-terra`, which answers with HTTP 400 and enumerates what it does take: *"Unsupported value: 'minimal' is not supported ... Supported values are: 'none', 'low', 'medium', 'high', 'xhigh', and 'max'."* So the real floor is **`none`**, not `low` — it runs, and it produces zero reasoning tokens. |
| Lowering `model_context_window` to shrink the skills block | It works (−1,883 chars at 100k) but also lowers the auto-compact trigger, and compaction is a total cache kill. Net negative. |

That table is the reason this project exists in the form it does: on Codex it is easy to publish a configuration that feels frugal and measurably is not.

## How every claim here was checked

- **Codex's own validators gate the repository.** Codex 0.147 ships `skill-creator` and `plugin-creator` as system skills on disk, with executable validators. `plugins/eco/skills/*` passes `quick_validate.py` and `plugins/eco` passes `validate_plugin.py`. That is how we learned `argument-hint` — copied from the Claude Code port — is not a Codex field at all.
- **Prompt sizes come from `codex debug prompt-input`**, not from an estimate. Token figures are marked as `~` because they are chars/4; character counts are exact.
- **Config keys are validated with `codex mcp-server --strict-config`** before being recommended. Codex silently ignores unknown keys, so this is the only way to know a setting is real.
- **Quality is graded deterministically.** `bench/lib/grade.mjs` scores each answer for the planted bugs with no model in the loop. It also has a documented false-negative it caused and how that was caught — see Amendment 2 in the [pre-registration](bench/preregistration/001-first-study.md).
- **Rule changes are pre-registered.** Endpoints and thresholds are written down before the runs, and the failures are published with the successes.
- **The experiment is checked before it is run.** `bench/lib/preflight.mjs` renders the batch's own prompt with `codex debug prompt-input` and refuses to start if a staged skill name does not resolve to exactly one file inside the staged workspace. It was written after that check would have failed *every* batch this project had run: a stale copy of `eco` in `$HOME/.agents/skills` had been appearing in the catalogue beside the copy under test.
- **A grading change is applied to every stored run at once.** `scripts/regrade.mjs` re-grades all recorded event streams and prints a per-arm before/after, so widening a criterion cannot quietly help one arm. CI fails if any committed summary disagrees with what the current rubric produces.
- **Charts and tables are generated, never written.** `scripts/build-charts.mjs` renders both languages from the recorded data, and `--check` fails CI if a committed SVG or results table drifts from it. The chart renderer throws when a label would be clipped rather than shipping a truncated number.
- **Nothing reaches a README without passing the headline gate.** `bench/headline.json` names the studies allowed to produce a claim. Two studies in this project were retracted after the fact; the gate is what kept them out of the numbers while they were still believed.
- **No dollar figures, ever.** The `codex exec` event stream contains no cost field. On a ChatGPT plan the currency is your rate limit, so this project reports tokens.

## Install in detail

### The rules — the part that does the work

```bash
./install.sh --rules-only              # $CODEX_HOME/AGENTS.md, or ~/.codex/AGENTS.md
./install.sh --rules-only --project    # ./AGENTS.md in the repo you are standing in
./install.sh --rules-only --full       # the 3.6 kB block instead of the 1.1 kB one
./install.sh --rules-only --uninstall
```

Codex loads `AGENTS.md` from the global `$CODEX_HOME` and from the project you are working in, both
into the same `<INSTRUCTIONS>` section of the prompt. The global one is the default here because the
saving should not depend on remembering to set up each repository.

Two things worth knowing before you install it:

- **The block is re-sent on every request.** That is why the default is 1.1 kB and why CI refuses to let
  it grow past 1,600 bytes. `--full` is there if you would rather have every rule than the cheapest block.
- **`project_doc_max_bytes` truncates silently**, at 32,768 bytes by default. If your `AGENTS.md` is
  already near that, adding to it can push your own instructions off the end. `node scripts/prefix-audit.mjs`
  run inside the project shows you what yours currently costs.

### The skills — for `setup`, and for repos you do not control

```bash
./install.sh --skills-only             # $HOME/.agents/skills
CODEX_SKILLS_DIR=... ./install.sh --skills-only
./install.sh --skills-only --uninstall
```

Codex reads standalone skills from three roots, most specific first:

```
$CWD/.agents/skills      # this project only
$HOME/.agents/skills     # you, everywhere
/etc/codex/skills        # the whole machine or container
```

It publishes a skill from **every** root it finds one in, so two copies of `eco` mean two catalogue
entries with one name: both descriptions billed every turn, and `$eco` no longer pointing at one body.
Keep one copy. `node scripts/prefix-audit.mjs` reports duplicates it finds.

### As a Codex plugin — CLI, one command

```bash
codex plugin marketplace add sup3x/codex-eco
codex plugin add eco@codex-eco
```

**Retracted claim.** An earlier version of this README said a plugin "supplies the body directly" and was therefore cheaper to invoke. That is wrong. Rendering the prompt with the plugin installed shows the same single catalogue line and no body — a plugin-installed skill is read from disk exactly like a standalone one. The 35-versus-131-token observation behind the claim was one unreplicated pair of runs, and its stated explanation did not survive checking.

**Installing both is worse than installing one.** Codex publishes every root it finds a skill in, so a standalone copy and a plugin copy appear as *two* catalogue entries with the same name: both descriptions are billed on every turn, and `$eco` no longer names one body. `node scripts/prefix-audit.mjs` reports duplicates it finds, and the benchmark harness now refuses to run a batch whose skill name is ambiguous — a defect it found in every batch this project had run until then.

Note that the aggressive profile turns the plugin subsystem off, so it pairs with the standalone install, not the plugin one.


### The profiles

```bash
cp profiles/eco.config.toml "$CODEX_HOME/eco.config.toml"    # ~/.codex by default
codex --profile eco
```

A profile is layered at launch, so it never invalidates a cached prefix the way changing model or effort mid-thread does, and uninstalling is deleting one file.

## Related work

| Project | Layer | Honest comparison |
|---|---|---|
| [RTK](https://github.com/rtk-ai/rtk) | Shell-output compression proxy | The giant in this space and complementary: it shrinks command output before it reaches context. Its Codex integration is its weakest — on Codex it degrades to instructions — which is the gap the rules here fill. |
| token-diet | Terse ruleset | Advertises Codex support with numbers ported from another agent. This project measures on Codex itself, which is the whole difference. |
| [agent-token-saver](https://github.com/Supersynergy/agent-token-saver) | Controlled A/B on Codex | The prior art for measuring this on Codex at all. We cite it and try to beat it on protocol: pre-registration, n per arm, bootstrap CI, exact Mann-Whitney, deterministic grading, and published negative results. |
| ccusage-style dashboards | Monitoring | Measure spend after the fact; reduce nothing. |

## Contributing

Benchmark results from other models, plans and platforms are the most valuable contribution — especially ones where eco loses. `node bench/bench.mjs ab --task "..." --n 5 --rubric orders-review` writes every run's event stream for you. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © 2026 Kerim
