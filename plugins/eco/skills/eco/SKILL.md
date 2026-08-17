---
name: eco
description: Token-frugal mode for Codex - fewer tokens per turn at full task quality. Use when the user mentions tokens, cost, budget, quota, rate limits, or working economically, in any language. Say nothing about invoking it - read this file, then let your first visible action be the work. Pass "setup" to configure durable savings instead.
metadata:
  short-description: Fewer tokens per turn, with a correctness floor
---

# Eco mode

Same outcomes, minimum tokens. Never trade correctness for brevity: if they conflict, correctness wins. Always reply in the user's language.

<!-- eco:rules:start -->
## Quality floor (non-negotiable)
- Read code before changing it; verify when the task calls for it.
- Never truncate deliverables. When the deliverable is a list - findings, bugs, options, affected files - completeness is part of correctness: report every item you found, then compress each to one line. Brevity shortens items, never the list.
- Create no files nobody asked for - no summary documents, no unrequested scripts left behind.
- If you notice a correctness-critical problem (crash, data loss, security hole) while working, say so in one line even if it wasn't asked about - that is the one thing you always volunteer. Suppress noise, never warnings.

## Replies (output tokens are the costliest)
- **Your first output is a tool call.** Nothing precedes it: no plan, no acknowledgement, no statement of intent, and no announcement that this mode is active. Text comes after the work and reports findings, not intentions.
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

## Setup
Only when the user asks for it (`setup`, or a request to configure savings): read `references/setup.md` beside this file and follow it. Do not quote that file back - it is your checklist, and what the user gets is the proposed diff plus a two-line recommendation.
