# codex-eco — eco mode for Codex

**Your Codex session already costs you ~5,500 tokens before you type a character. `codex-eco` measures that, cuts a third of it with settings that are real, and ships behavioural rules whose effect on a live model was benchmarked rather than assumed — including the models where the rules make things worse.**

Works in **Codex CLI** and in **Codex inside the ChatGPT desktop app**. One install covers both.

[English](README.md) · [Türkçe](README.tr.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) [![Codex CLI](https://img.shields.io/badge/Codex%20CLI-0.147-black)](https://developers.openai.com/codex) [![Validated](https://img.shields.io/badge/validated%20by-Codex's%20own%20validators-brightgreen)](#how-every-claim-here-was-checked)

![codex-eco](assets/social-preview.png)

## Quickstart

```bash
git clone https://github.com/sup3x/codex-eco && cd codex-eco && ./install.sh
```

Then, in a new Codex session:

| | Codex CLI | Codex in the ChatGPT desktop app |
|---|---|---|
| Turn it on | `$eco` | `@eco` |
| With a task | `$eco fix the failing test in orders.js` | `@eco fix the failing test in orders.js` |
| Configure your setup | `$eco setup` | `@eco setup` |

`$eco` on its own answers exactly `Eco mode active.` — if you see that string, it loaded.

Windows: `.\install.ps1`. Both installers back up anything they replace and support `--uninstall` / `-Uninstall`.

## See where your tokens go — before spending any

The most useful thing in this repository costs nothing to run and makes no model call:

```bash
node scripts/prefix-audit.mjs
```

```
section                           chars   ~tokens
-------------------------------------------------
skills catalog                   16,901     4,225
recommended-plugins advert        2,849       712
core instruction prose            2,269       567
multi-agent mode note               271        68
-------------------------------------------------
TOTAL before you type            22,290     5,573

configuration                     chars   ~tokens      change
-------------------------------------------------------------
as configured now                22,290     5,573           -
eco profile (safe)               14,684     3,671      -34.1%
eco profile (aggressive)          9,768     2,442      -56.2%
```

Those are real numbers from one machine, produced by `codex debug prompt-input` — the exact item list Codex will send. Run it in your own project and you get your own numbers, including what your `AGENTS.md` costs. Every key the audit suggests is validated against your Codex build with `codex mcp-server --strict-config` before it is offered, so a typo can never masquerade as a saving.

## What you get

| Component | What it does |
|---|---|
| **`eco` skill** | Behavioural rules with a non-negotiable correctness floor. One invocation covers the thread. `eco setup` proposes the config changes and applies nothing without confirmation. |
| **`eco-max` skill** | The same rules at the tightest reply budget, for routine chores. Generated from `eco`, so the two cannot drift. |
| **`profiles/eco.config.toml`** | The safe prefix tier: four verified settings plus two caps. `codex --profile eco`. |
| **`profiles/eco-max.config.toml`** | Adds a reasoning-effort floor and the aggressive prefix tier. |
| **`AGENTS.eco.md`** | The same discipline as a repo-level block, for when you want it always on without invoking a skill. |
| **`scripts/prefix-audit.mjs`** | The free, offline audit above. |
| **`bench/`** | The measurement harness, the deterministic grader, the provenance manifest and the pre-registrations behind every number here. |

## Measured results

<!-- codex-eco:results:start -->
_No headline study has been published yet. `node scripts/build-assets.mjs` fills this section from `bench/manifest.json` once runs are published._
<!-- codex-eco:results:end -->

## What the rules actually target

Every rule exists because the unarmed agent was observed doing the thing it forbids, in a real transcript:

1. **The preamble turn.** Codex opens with a message announcing what it is about to do — *"I'll inspect the test file and its nearby project context, then summarize"* — and only then runs a command. That is a billed turn that moves no work forward. The rule that suppresses it was chosen by measuring four candidate wordings against each other (see [Part A](bench/preregistration/001-first-study.md)).
2. **The unasked survey.** Asked to review one file, the unarmed agent also ran `Get-ChildItem -Force` and a tree-wide `rg -n "orders" .` — a directory listing and a full-tree grep nobody requested. The armed arms ran one command instead of 1.4.
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
| `minimal` reasoning effort | The CLI accepts any string silently; some current models reject `minimal` with HTTP 400 at request time. `low` is the safe floor. |
| Lowering `model_context_window` to shrink the skills block | It works (−1,883 chars at 100k) but also lowers the auto-compact trigger, and compaction is a total cache kill. Net negative. |

That table is the reason this project exists in the form it does: on Codex it is easy to publish a configuration that feels frugal and measurably is not.

## How every claim here was checked

- **Codex's own validators gate the repository.** Codex 0.147 ships `skill-creator` and `plugin-creator` as system skills on disk, with executable validators. `plugins/eco/skills/*` passes `quick_validate.py` and `plugins/eco` passes `validate_plugin.py`. That is how we learned `argument-hint` — copied from the Claude Code port — is not a Codex field at all.
- **Prompt sizes come from `codex debug prompt-input`**, not from an estimate. Token figures are marked as `~` because they are chars/4; character counts are exact.
- **Config keys are validated with `codex mcp-server --strict-config`** before being recommended. Codex silently ignores unknown keys, so this is the only way to know a setting is real.
- **Quality is graded deterministically.** `bench/lib/grade.mjs` scores each answer for the planted bugs with no model in the loop. It also has a documented false-negative it caused and how that was caught — see Amendment 2 in the [pre-registration](bench/preregistration/001-first-study.md).
- **Rule changes are pre-registered.** Endpoints and thresholds are written down before the runs, and the failures are published with the successes.
- **No dollar figures, ever.** The `codex exec` event stream contains no cost field. On a ChatGPT plan the currency is your rate limit, so this project reports tokens.

## Install in detail

### Standalone skills — CLI *and* the desktop app

```bash
./install.sh                 # $HOME/.agents/skills
CODEX_SKILLS_DIR=... ./install.sh
./install.sh --uninstall
```

Codex reads standalone skills from three roots, most specific first:

```
$CWD/.agents/skills      # this project only
$HOME/.agents/skills     # you, everywhere
/etc/codex/skills        # the whole machine or container
```

### As a Codex plugin — CLI, one command

```bash
codex plugin marketplace add sup3x/codex-eco
codex plugin add eco@codex-eco
```

Measured difference: invoking the plugin-installed skill cost 35 output tokens against 131 for the standalone copy, because on the standalone path the agent reads `SKILL.md` with a shell command while a plugin supplies the body directly. The plugin path is cheaper to activate; the standalone path is the one the desktop app reads. Installing both is fine.

Note that the aggressive profile turns the plugin subsystem off — pair it with the standalone install, not the plugin one.

### The profiles

```bash
cp profiles/eco.config.toml "$CODEX_HOME/eco.config.toml"    # ~/.codex by default
codex --profile eco
```

A profile is layered at launch, so it never invalidates a cached prefix the way changing model or effort mid-thread does, and uninstalling is deleting one file.

## Two things a Codex skill cannot do

1. **It cannot change reasoning effort.** Codex skill frontmatter accepts `name`, `description` and `metadata` only — there is no effort field, unlike the Claude Code sibling of this project. Effort comes from a profile or a flag, which is why `eco-max` ships as both a skill and a profile.
2. **A hook cannot rewrite shell output.** Codex hooks carry `permissionDecision`, `updatedInput`, `additionalContext` and `updatedMCPToolOutput`; there is no field for rewriting a shell result. `tool_output_token_limit` does that job natively, so this project ships no hooks at all.

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
