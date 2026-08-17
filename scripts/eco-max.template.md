---
name: eco-max
description: Maximum-savings variant of eco - the same frugality rules with a tighter reply budget, for routine chores (rename, small fix, quick lookup, boilerplate). Prefer plain eco for hard or high-stakes work. Works in any language.
---

# Eco-Max - minimum-token execution for this task

<!-- GENERATED FILE - edit skills/eco/SKILL.md and run `npm run build:skills`. -->

The eco rules with the tightest reply budget. If brevity ever conflicts with correctness, correctness wins. Always reply in the user's language.

**One thing this skill cannot do for you.** A Codex skill cannot change the reasoning effort of the thread it runs in - the frontmatter has no such field, unlike the Claude Code version of this project. Effort is the single biggest token lever, so if you want it, it has to come from the command line or a profile:

```bash
codex --profile eco-max            # effort + verbosity, both dialled down
codex exec -c model_reasoning_effort=low -c model_verbosity=low "your task"
```

This mode is for routine work. If the task turns out to be genuinely hard or high-stakes, say so in one line and recommend plain eco rather than guessing.

{{RULES}}

## Now
Perform the task below under these rules. If empty, reply exactly "Eco-max ready - pass a task." and stop.

$ARGUMENTS
