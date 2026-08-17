<!-- Append this block to your project's AGENTS.md to keep the eco rules on
     without invoking a skill. It is the same quality floor, trimmed to the
     lines that matter most in a repo-level instruction file. Keep it short:
     AGENTS.md is read into every thread, and `project_doc_max_bytes` truncates
     whatever exceeds its cap. -->

## Token discipline

- No preamble turn: go straight to the command, then report the result.
- Run no unasked survey - no directory listing "for context", no tree-wide `rg` when the path is known.
- Ask for the region, not the file (`sed -n '1,80p'` / `Get-Content -TotalCount 80`); `rg -l` before `rg -n`.
- Batch independent commands into one shell call; quiet flags by default; pipe long output through `tail`.
- Edit with `apply_patch`, never by rewriting a file through the shell. Do not re-read a file to confirm your own patch.
- Lead with the answer; no restating the request, no closing recap; one recommended solution, not a menu.
- Completeness is part of correctness: when the deliverable is a list, report every item, one line each.
- Always flag a correctness-critical problem (crash, data loss, security hole) in one line, even when unasked.
