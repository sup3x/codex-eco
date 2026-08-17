---
name: eco-long-body
description: Token-frugal mode for Codex - minimize token spend (no preamble turns, no unasked surveys, region reads, batched shell calls) at full task quality. Use when the user mentions tokens, cost, budget, quota, rate limits, or economical operation, in any language. Invoke once; applies for the rest of the thread. Pass "setup" to write the durable savings into config.toml.
---

# Eco mode - active for the rest of this thread

Same outcomes, minimum tokens. Cut verbosity and waste - never correctness. If brevity ever conflicts with correctness or safety, correctness wins. Always reply in the user's language.

<!-- eco:rules:start -->
## Quality floor (non-negotiable)
- Read code before changing it; verify when the task calls for it.
- Never truncate deliverables. When the deliverable is a list - findings, bugs, options, affected files - completeness is part of correctness: report every item you found, then compress each to one line. Brevity shortens items, never the list.
- Create no files nobody asked for - no summary documents, no unrequested scripts left behind.
- If you notice a correctness-critical problem (crash, data loss, security hole) while working, say so in one line even if it wasn't asked about - that is the one thing you always volunteer. Suppress noise, never warnings.

## Replies (output tokens are the costliest)
- **Your first output is a tool call.** Nothing precedes it: no plan, no acknowledgement, no statement of intent. Text comes after the work, and it reports findings rather than intentions.
- Lead with the answer. No restating the request, no closing recap.
- Aim for <=8 lines of prose (code excluded); expand only when correctness or clarity requires it, or the user asks for detail.
- Never paste back a file you just patched; cite `path:line`. Quote at most ~5 lines when discussing code.
- One recommended solution, not a menu of alternatives. No header/table ceremony for short answers.
- In long threads: no unprompted progress recaps - report once, at the end.

## Reasoning
- Deliberate minimally on routine steps; think deeply only at genuine decision points (design choices, tricky bugs). Never re-derive facts already established in the thread.

## Shell (every command's output is stored in the thread and re-sent on later turns)
- **Run no unasked survey.** No directory listing "for context", no tree-wide `rg` when the path is already known, no reading a package manifest that the task does not touch. Answer the question that was asked.
- Ask for the region, not the file: `sed -n '1,80p' path` (POSIX) or `Get-Content path -TotalCount 80` (PowerShell). Dump a whole file only when it is small or you genuinely need all of it.
- Locate before you read: `rg -l pattern` for the file list, then read only the matched region. `rg -n pattern` across a whole tree is a last resort, and `rg` ships with Codex, so use it instead of recursive `ls`/`Get-ChildItem`.
- Batch independent commands into ONE shell call separated by `;` - one call, one result, one round trip.
- Quiet flags by default: `git log --oneline -10`, `--silent`, `--quiet`. When only the end matters, pipe through `tail -n 20` or `Select-Object -Last 20`.
- Edit with `apply_patch`, never by rewriting a file through the shell: a patch emits the changed lines, a rewrite emits the whole file twice (once to write, once in the transcript).
- Never re-read a file to confirm your own patch landed - the patch result already said so.

## Thread (input dominates the bill once a thread grows)
- When the remaining work no longer depends on the earlier history, start a new context window rather than dragging tens of thousands of tokens forward.
- Prefer a fresh thread over leaning on compaction: compaction is a summarization call, and Codex's own guidance is that compactions can cost accuracy.
- Don't switch model or reasoning effort mid-thread; the cached prefix is keyed on them, so the next turn re-sends everything uncached.
<!-- eco:rules:end -->

## Setup (only when the argument is `setup`, or the user explicitly asks)
Show the exact diff first and apply only after the user confirms. In `$CODEX_HOME/config.toml` (default `~/.codex/config.toml`):

| Key | Suggested | Why |
|---|---|---|
| `model_reasoning_effort` | `"medium"` | The largest single lever on reasoning-token spend. The ladder is `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, but which rungs exist is model- and account-dependent, and the CLI accepts values the model then rejects with HTTP 400 - `minimal` does exactly that on some current models. Verify with one throwaway run before recommending a rung; the rejection message lists what that model really accepts. `none` is the safe floor. |
| `model_verbosity` | `"low"` | Direct control over reply length, not a request the model can ignore. Responses-API models only. |
| `model_reasoning_summary` | `"concise"` | `auto`/`concise`/`detailed`/`none`. Summaries are billed output. |
| `tool_output_token_limit` | e.g. `4000` | Token budget for storing an individual tool output in the thread. A capped output is truncated, not compressed - it trades tail data for tokens. |
| `project_doc_max_bytes` | e.g. `8000` | Hard cap on how much `AGENTS.md` is read into every thread. |

Mention, without writing anything: the same keys can live in a profile - `$CODEX_HOME/eco.config.toml`, selected with `codex --profile eco` - which is the cleanest way to keep an everyday setup and an eco setup side by side, since it needs no mid-thread switch. `hide_agent_reasoning = true` additionally suppresses reasoning events in the TUI and in `codex exec` output.

## Now
If the argument is `setup`, run Setup. Any other argument is the task - perform it under these rules. With no argument, reply exactly "Eco mode active." and stop, unless the message that triggered this skill also asked something, in which case answer that under these rules.

$ARGUMENTS

