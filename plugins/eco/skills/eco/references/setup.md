# eco setup — the durable savings

Read this only when the user asks to configure savings. Propose, show the diff, apply nothing until
they confirm. Prefer writing a **profile** over editing their `config.toml`: a profile layers at
launch, is undone by deleting one file, and never churns a cached prefix mid-thread.

```
$CODEX_HOME/eco.config.toml     # then: codex --profile eco
```

## First, the rules block — the largest lever, and the one that is not a setting

Before any config key, offer this. It is what measured an effect:

```
$CODEX_HOME/AGENTS.md     # append the codex-eco block; Codex loads it into every prompt
```

Codex injects `AGENTS.md` verbatim on every turn, so the rules apply with no extra round trip, at
every reasoning effort, on every model, in the CLI and the desktop app alike. Invoking a skill cannot
match that: the body has to be read with a shell command first, and measured on a three-turn thread
that made the skill path **27% more expensive** than no rules at all while the 1.1 kB `AGENTS.md`
block was **16% cheaper**.

If the repository is checked out, `./install.sh --rules-only` does it with a backup and an idempotent
marker block. If not, offer to append the block yourself, and keep it short — the file is re-sent on
every request, so its size is a per-turn cost, and `project_doc_max_bytes` truncates the excess in
silence.

Roughly two thirds of a thread's cost is fixed before the user types: the injected prefix, the model,
and the effort level. Attack them in that order.

## The prefix, measured largest first

Every key below is validated against `codex mcp-server --strict-config` and its effect measured with
`codex debug prompt-input` — free, offline, no model call. Suggest the ones whose cost the user is
willing to pay, not all of them by reflex.

| Key | Suggested | What it removes, and what it costs |
|---|---|---|
| `project_doc_max_bytes` | `8192` | Caps how much `AGENTS.md` is read into **every** thread. Default 32768; a large AGENTS.md is usually the single biggest number a user controls. This truncates rather than compresses, so the real fix is a shorter file and this is the guardrail. |
| `include_permissions_instructions` | `false` | Drops the escalation/permissions prose. **Has a real cost:** less guidance on when to stop and ask. Leave it on for anyone who relies on approval prompts. |
| `features.tool_suggest` | `false` | Drops the advert for plugins the user has not installed. No cost. |
| `include_environment_context` | `false` | Drops the cwd/OS/git block. The model no longer knows their platform unless told. |
| `include_apps_instructions` | `false` | Drops the apps block. No cost unless they use ChatGPT apps from Codex. |
| `tool_output_token_limit` | `4000` | Token budget for one stored tool result. Truncation again: trades the tail of long output for tokens. |

An aggressive tier also sets `features.apps = false` and `features.plugins = false`. Mention it only
if they installed eco as a standalone skill, because turning plugins off stops plugin-installed
skills from loading — including eco itself on that path.

## The model and the effort

Effort is the largest single lever and a skill cannot set it; only a profile or a flag can. Say that
plainly rather than pretending otherwise.

- Do **not** blanket-recommend `model_reasoning_effort = "medium"`. Check the user's model first:
  `gpt-5.6-sol` already defaults to `low`, so "medium" would raise their spend.
- The ladder is model- and account-dependent. The CLI accepts any string silently and an unsupported
  rung fails only when the request is sent, so verify with one throwaway run before recommending it.
  On `gpt-5.6-terra` the server enumerates its own ladder in the 400 it returns for a bad rung:
  `none`, `low`, `medium`, `high`, `xhigh`, `max` - and `minimal`, which several guides recommend, is
  not on it. So the floor is `none`, not `low`; it runs and produces zero reasoning tokens. Do not
  suggest `none` for anything with a correctness requirement without checking the work, and say that.
- Never `ultra`: the CLI warns it may proactively spawn multiple agents, so spend stops being a
  linear step above `max`.
- `codex --profile eco-max` is the ready-made floor for routine chores.

## Say what does not work

Published guides recommend all of these; none of them saves anything on current Codex builds, and
telling the user so is more useful than one more setting:

- `model_reasoning_summary = "none"` — every current model already defaults to `none`.
- `model_verbosity = "low"` — already the default on every current model except `gpt-5.4-mini`.
- `hide_agent_reasoning`, `show_raw_agent_reasoning` — display-only; measured byte-identical prompts.
- `features.token_budget` — under development, and enabling it *adds* roughly 1,858 characters.
- `model_supports_reasoning_summaries` — appears in the official sample config and is rejected as an
  unknown field by the installed binary.
- Lowering `model_context_window` to shrink the skills catalog — it works, but it also lowers the
  auto-compact trigger, and compaction is a total cache kill. Net negative.

## Cache hygiene, worth one line each

- Never `/compact` as a savings measure: measured, it turns a ~95%-cached prefix into a 0%-cached one.
- Choose model and effort before the first message; changing either mid-thread dropped the median
  cached ratio from 0.95 to 0.07.
- Prefer a fresh thread over a long one. The usable window is 258,400 tokens, not 272,000 (Codex
  applies a 95% effective-window factor).

## Finally

If the repository is available, point them at `node scripts/prefix-audit.mjs`: it prints their own
before/after numbers and validates every key against their own Codex build. One command, no spend.
