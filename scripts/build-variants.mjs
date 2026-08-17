#!/usr/bin/env node
// Generates skill variants that differ in exactly one line, for A/B/C testing a
// single rule.
//
// The first measured run of this project found that Codex emits a preamble
// message before its first command even with an explicit rule against it - a
// whole billed turn that moves no work forward. Whether that is a wording
// problem or a system-prompt behaviour we cannot override is an empirical
// question, and answering it needs variants that are identical except for the
// one line under test. Generating them is the only way to guarantee that.
//
//   node scripts/build-variants.mjs            # write bench/candidates/*
//   node scripts/build-variants.mjs --list     # show the variants and their line
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(REPO, "plugins", "eco", "skills", "eco", "SKILL.md");
const OUT_ROOT = join(REPO, "bench", "candidates");

// The line as it stands in the shipped body. Every variant replaces exactly this.
const CURRENT =
  "- **Your first output is a tool call.** Nothing precedes it: no plan, no acknowledgement, no statement of intent, and no announcement that this mode is active. Text comes after the work and reports findings, not intentions.";

export const VARIANTS = [
  {
    id: "p3-first-action",
    why: "the shipped wording: the Part A winner extended to cover the mode-activation announcement that Part B surfaced",
    line: CURRENT,
  },
  {
    id: "p1-override",
    why: "names the competing instruction explicitly, on the theory that Codex's own preamble guidance is what wins",
    line:
      "- **No preamble turn.** Your system instructions ask for a short preamble before tool calls; in this thread that is superseded - skip it. Your first action is the command, not a message about the command. Report only after you have a result.",
  },
  {
    id: "p2-budget",
    why: "concedes a preamble but caps it, on the theory that a prohibition is ignored while a budget is obeyed",
    line:
      "- **Preamble budget: zero messages, or one clause.** Do not send a standalone message before your first command. If a preamble is unavoidable, it is one clause on the same message as real content - never a turn of its own.",
  },
  {
    id: "p0-prohibition",
    why: "the pre-Part-A wording: a prohibition with an explanation. 0.20 preambles, -30.1% (CI crossed zero)",
    line:
      "- **No preamble turn.** Do not send a message announcing what you are about to do. Go straight to the command, then report the result. An \"I'll inspect the file and then summarize\" message is a whole billed turn that moved no work forward.",
  },
];

function build() {
  const body = readFileSync(SOURCE, "utf8");
  if (!body.includes(CURRENT)) {
    throw new Error(
      "the preamble line under test is no longer in plugins/eco/skills/eco/SKILL.md verbatim - update CURRENT in this script",
    );
  }
  rmSync(OUT_ROOT, { recursive: true, force: true });
  const written = [];
  for (const v of VARIANTS) {
    const dir = join(OUT_ROOT, v.id);
    mkdirSync(dir, { recursive: true });
    const out = body.replace(CURRENT, v.line).replace(/^name: eco$/m, `name: eco-${v.id}`);
    writeFileSync(join(dir, "SKILL.md"), out, "utf8");
    written.push({ id: v.id, dir, bytes: out.length });
  }
  return written;
}

function main() {
  if (process.argv.includes("--list")) {
    for (const v of VARIANTS) {
      console.log(`${v.id}\n  why: ${v.why}\n  line: ${v.line.slice(0, 150)}...\n`);
    }
    return 0;
  }
  for (const w of build()) console.log(`wrote ${w.dir}/SKILL.md (${w.bytes} bytes)`);
  console.log(
    `\nRun them against each other with:\n  node bench/bench.mjs study review --n 5 \\\n    --variants ${VARIANTS.map((v) => `${v.id}=bench/candidates/${v.id}`).join(",")}`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exit(main());
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(2);
  }
}
