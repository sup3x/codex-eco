# Contributing to codex-eco

This project sells one thing: that its numbers are true and that anyone can recheck them. Every rule
below protects that, which is why the bar for changing a *rule* is much higher than the bar for
changing the tooling around it.

## What you need

- **Node.js 24 or newer.** Nothing else. Zero runtime dependencies, zero dev dependencies, no
  lockfile, no build step. `npm install` has nothing to install.
- **Codex CLI**, authenticated, but only if you intend to run benchmarks. Every CI check runs offline.

Everything is ESM (`.mjs`); paths are joined with `node:path`, never with a hardcoded separator,
because the maintainer's machine is Windows and CI is not.

## Running the checks

```bash
npm test                 # unit tests (node:test)
npm run check:skills     # eco-max is generated from eco and must be in sync
node scripts/build-assets.mjs --check   # the README's images must match bench/manifest.json
```

None of these costs anything. CI runs exactly these plus repository hygiene: skill frontmatter must
carry `name` and `description` and the name must match the directory; every rule variant must differ
from the shipped body in exactly one line; `install.sh` must be committed executable; every `.ps1`
must be **pure ASCII** and parse under Windows PowerShell 5.1.

That last one is not pedantry. A single non-ASCII character in a BOM-less `.ps1` makes PowerShell 5.1
decode the file as the system ANSI codepage, the string terminator is lost, and the parser gives up.
The sibling project shipped that bug for five releases. Use `-`, `'` and `...`, never their
typographic cousins.

## Changing the skill rules

`plugins/eco/skills/eco/SKILL.md` is the single source. `eco-max` and the rule variants are
**generated** from it — never edit them by hand:

```bash
npm run build:skills      # regenerate eco-max
npm run build:variants    # regenerate bench/candidates/*
```

A change to the rules ships only with a **pre-registered study**: write the endpoints and the
thresholds down first, in `bench/preregistration/`, then run it. See
[`bench/preregistration/001-first-study.md`](bench/preregistration/001-first-study.md) for the format
that is actually in use. If the study fails its own bar, the change does not ship and the failure is
published — that is the whole point, and the sibling project has a release where exactly that
happened.

Two rules about rules, both learned the hard way:

1. **Never name a mechanism you have not verified exists.** Codex has one shell tool, `apply_patch`,
   `new_context`, and ripgrep on PATH — it has no editor tools, so a rule about "Edit over Write"
   would be advice about a tool that is not there. Check the binary or the docs before you write a
   rule that depends on a feature.
2. **A rule that instructs the agent to repeat output the user can already see is not frugality.**

## Contributing a benchmark result

Very welcome, especially from other models, plans and platforms:

```bash
node bench/bench.mjs ab --task "your task here" --n 5 --rubric orders-review
```

Attach the `bench/results/<tag>/` directory (it contains every run's event stream) and say which
model, effort, verbosity and Codex version you ran. Results where eco loses are as publishable as
results where it wins.

## Style

Comments explain *why*, not *what*. No emoji in code. Plain ASCII in every file that a Windows
toolchain might read. Keep the skill bodies short — they are the product, and every line in them is
billed on invocation.
