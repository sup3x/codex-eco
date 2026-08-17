# Security

## What this project touches on your machine

Scoped honestly, because "eco mode" sounds harmless and two of these are not nothing:

- **It reads and proposes edits to your Codex configuration.** `eco setup` shows a diff of
  `$CODEX_HOME/config.toml` and writes nothing until you confirm. The shipped profiles under
  `profiles/` are files you copy yourself; nothing installs them for you.
- **The installers copy skill files into your skills directory** (`$HOME/.agents/skills` by default,
  or `$CODEX_SKILLS_DIR`). An existing directory of the same name is moved to a timestamped backup
  first, never overwritten in place. `--uninstall` / `-Uninstall` removes only the directories this
  project installed.
- **The skills instruct the agent, they do not execute anything themselves.** `eco` and `eco-max` are
  Markdown instruction files with no bundled scripts and no network access.
- **The benchmark harness runs `codex exec` on a throwaway fixture** in a temporary git repository it
  creates, and writes results under `bench/results/`. It never touches your working tree. It uses a
  separate `CODEX_HOME` when you pass `--codex-home`, which is how the published studies were run.

No telemetry, no network calls of its own, no dependencies: `package.json` declares zero, and CI
asserts that.

## What it deliberately does not do

- It does not write to `config.toml` without an explicit confirmation.
- It does not install hooks. Codex hooks are configured in your own `config.toml`; this project
  documents them but ships none, because a hook runs a process on every matching tool call and that
  is not a cost anyone should inherit from an install.
- It does not report a dollar figure. The Codex event stream contains no cost field, and inventing
  one from a price table would be a fabrication.

## Reporting an issue

Open a GitHub issue for anything non-sensitive. For something you would rather not post publicly,
use GitHub's private vulnerability reporting on this repository.
