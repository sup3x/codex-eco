<!-- The short block. Hand-curated, not generated: it is a deliberate subset of the
     full rules in AGENTS.eco.md, kept to the lines that carry the measured effect.

     Why a short version exists at all. AGENTS.md is re-sent on every request, so its
     size is a per-turn cost, and on the first turn it is uncached. Measured on
     gpt-5.6-terra, the full 4.6 kB block cut output tokens 37.0% (95% CI -47.7 to
     -26.8, p = 0.0079) but raised uncached input from 3,137 to 6,224, which at
     GPT-5-class price ratios made the turn 18.7% more expensive overall. The saving
     is real and the overhead is real; which one wins depends on how big this file is.

     Keep it under 1,600 bytes. CI enforces that, because a block that grows back to
     4 kB silently undoes the reason this file exists. -->

<!-- codex-eco:start -->
## Token discipline

Minimum tokens for the same outcome. If brevity and correctness ever conflict, correctness wins.
Reply in the user's language.

- **Your first output is a tool call.** No plan, no acknowledgement, no statement of intent before it.
  Text comes after the work and reports findings, not intentions.
- Lead with the answer: no restating the request, no closing recap, one recommended solution.
- Run no unasked survey - no directory listing "for context", no tree-wide `rg` when the path is known.
- Ask for the region, not the file (`sed -n '1,80p'` / `Get-Content -TotalCount 80`); `rg -l` before `rg -n`.
- Batch independent commands into ONE shell call separated by `;`.
- Edit with `apply_patch`, never by rewriting a file through the shell, and never re-read a file to
  confirm your own patch landed.
- Completeness is part of correctness: when the deliverable is a list, report every item, one line each.
  Brevity shortens items, never the list.
- Say so in one line if you notice a crash, data-loss or security problem, even when unasked. Suppress
  noise, never warnings.
<!-- codex-eco:end -->
