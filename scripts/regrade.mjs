#!/usr/bin/env node
// Re-grade every recorded run against the current rubric, and show what changed.
//
// Grading is deterministic and the raw event streams are on disk, so a rubric fix costs
// nothing to apply retroactively - and it MUST be applied retroactively, to every arm of
// every batch at once. Widening a criterion only for the batch that exposed the gap would
// be choosing the result. This prints a per-arm before/after so the effect of a rubric
// change on the baseline is as visible as its effect on the treatment.
//
//   node scripts/regrade.mjs            # report only
//   node scripts/regrade.mjs --write    # also rewrite summary.json / summary.md
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEvents, summarizeRun } from "../bench/lib/codex.mjs";
import { gradeAnswer, summarizeGrades } from "../bench/lib/grade.mjs";
import { renderSummary } from "../bench/bench.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RESULTS = join(REPO, "bench", "results");

/** The answer the rubric grades is turn 1's, in single- and multi-turn runs alike. */
function firstTurnAnswer(rawDir, run) {
  const files = run.files ?? [run.file];
  const first = files[0] ?? run.file;
  const path = join(rawDir, basename(String(first)));
  if (!existsSync(path)) return null;
  return summarizeRun(parseEvents(readFileSync(path, "utf8"))).result;
}

export function regradeBatch(tag, { write = false } = {}) {
  const dir = join(RESULTS, tag);
  const summaryFile = join(dir, "summary.json");
  if (!existsSync(summaryFile)) return null;
  const s = JSON.parse(readFileSync(summaryFile, "utf8"));
  if (!s.rubric) return null;

  const changes = [];
  for (const arm of s.arms) {
    const before = arm.grades;
    const regraded = [];
    for (const run of arm.runs) {
      const answer = firstTurnAnswer(join(dir, "raw"), run);
      if (answer == null) {
        regraded.push(run.grade);
        continue;
      }
      const grade = gradeAnswer(s.rubric, answer);
      if (write) run.grade = grade;
      regraded.push(grade);
    }
    const after = summarizeGrades(regraded);
    if (write) arm.grades = after;
    for (const id of Object.keys(after.criteria)) {
      const b = before?.criteria?.[id]?.hits;
      const a = after.criteria[id].hits;
      if (b !== a) changes.push({ arm: arm.name, criterion: id, before: b, after: a, runs: after.criteria[id].runs });
    }
  }

  if (write) {
    if (changes.length) {
      s.regradedAt = new Date().toISOString();
      writeFileSync(summaryFile, `${JSON.stringify(s, null, 2)}\n`, "utf8");
    }
    // summary.md is what a reader opens first, so it is re-rendered whenever it does not
    // already match the JSON - not only when grades moved. A batch summarised before a
    // grading or reporting fix would otherwise keep showing old text beside new data,
    // which is exactly the drift this project keeps trying to make impossible. It already
    // happened once: eff-high's markdown said "nan-bug 1/3" while its JSON said 3/3.
    const mdFile = join(dir, "summary.md");
    const md = `${renderSummary(s)}\n`;
    if ((existsSync(mdFile) ? readFileSync(mdFile, "utf8") : null) !== md) {
      writeFileSync(mdFile, md, "utf8");
      changes.push({ arm: "(report)", criterion: "summary.md re-rendered", before: "-", after: "-", runs: "-" });
    }
  }
  return { tag, changes, arms: s.arms.map((a) => ({ name: a.name, grades: a.grades })) };
}

function main() {
  const write = process.argv.includes("--write");
  if (!existsSync(RESULTS)) {
    console.error("no bench/results directory");
    return 2;
  }
  const tags = readdirSync(RESULTS).filter((t) => existsSync(join(RESULTS, t, "summary.json")));
  let total = 0;
  for (const tag of tags) {
    const res = regradeBatch(tag, { write });
    if (!res) continue;
    if (!res.changes.length) {
      console.log(`unchanged  ${tag}`);
      continue;
    }
    total += res.changes.length;
    console.log(`CHANGED    ${tag}`);
    for (const c of res.changes) {
      const dir = c.after > c.before ? "+" : "-";
      console.log(`    ${dir} ${c.arm.padEnd(10)} ${c.criterion.padEnd(11)} ${c.before}/${c.runs} -> ${c.after}/${c.runs}`);
    }
  }
  console.log(
    total
      ? `\n${total} criterion result(s) moved${write ? " and were written back" : " (report only; pass --write to apply)"}.` +
          `\nRead the per-arm lines above before believing any of them: a rubric change that only ever` +
          `\nmoves the treatment arm is a rubric change that was chosen rather than fixed.`
      : "\nNothing moved: every stored run grades the same under the current rubric.",
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
