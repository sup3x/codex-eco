#!/usr/bin/env node
// Summarises several batches into one table, and applies the sign test across
// them.
//
// This exists because of a finding, not for convenience: on this task, at n=5,
// one batch cannot support a claim. The direction repeating across independent
// batches can, and that is what the sign test below asks. The bar is unanimity -
// 4/4 same-direction batches reach only p = 0.125 - so the effect size published
// is the range across batches, never one batch's number.
//
// The primary metric is weighted cost (see bench/lib/cost.mjs), not output tokens:
// output is under a third of what a Codex turn actually bills.
//
//   node scripts/sweep-report.mjs effort-low effort-medium effort-high effort-xhigh
//   node scripts/sweep-report.mjs --json <tags...>
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compareArms } from "../bench/lib/stats.mjs";
import { weightedCost } from "../bench/lib/cost.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RESULTS = join(REPO, "bench", "results");

/** Two-sided sign test: probability of this many same-direction results by chance. */
export function signTest(deltas) {
  const n = deltas.filter((d) => d !== 0).length;
  const neg = deltas.filter((d) => d < 0).length;
  const k = Math.max(neg, n - neg);
  // sum of binomial tail from k to n, doubled
  const choose = (a, b) => {
    let r = 1;
    for (let i = 1; i <= b; i++) r = (r * (a - b + i)) / i;
    return r;
  };
  let tail = 0;
  for (let i = k; i <= n; i++) tail += choose(n, i);
  const p = Math.min(1, (2 * tail) / 2 ** n);
  return { n, sameDirection: k, allOneWay: k === n, p };
}

function loadBatch(tag) {
  const file = join(RESULTS, tag, "summary.json");
  if (!existsSync(file)) return null;
  const s = JSON.parse(readFileSync(file, "utf8"));
  const arm = (name) => s.arms.find((a) => a.name === name);
  const base = arm("baseline");
  const eco = s.arms.find((a) => a.kind === "skill" || a.kind === "agents");
  if (!base || !eco) return null;
  // Weighted cost is the primary metric. Batches recorded before that was added
  // are re-weighted here from their stored per-run usage rather than dropped.
  const weighted = (a) =>
    a.weighted?.values ?? (a.runs ?? []).map((r) => weightedCost(r));
  const cmp = compareArms(weighted(base), weighted(eco));
  const outCmp = compareArms(base.tokens.values, eco.tokens.values);
  const gate = (a) =>
    a.grades ? ["crash-bug", "nan-bug"].every((c) => a.grades.criteria[c]?.hits === a.grades.criteria[c]?.runs) : null;
  return {
    tag,
    model: s.model,
    effort: s.effort,
    n: Math.min(base.tokens.n, eco.tokens.n),
    arm: eco.name,
    baseline: base.weighted?.mean ?? weighted(base).reduce((x, y) => x + y, 0) / weighted(base).length,
    eco: eco.weighted?.mean ?? weighted(eco).reduce((x, y) => x + y, 0) / weighted(eco).length,
    outputDelta: outCmp.pctChange,
    delta: cmp.pctChange,
    ci: cmp.ci95,
    p: cmp.mannWhitneyP,
    ecoReasoning: eco.reasoning?.mean ?? null,
    baseReasoning: base.reasoning?.mean ?? null,
    ecoPreamble: eco.preambles?.mean ?? null,
    basePreamble: base.preambles?.mean ?? null,
    ecoCmds: eco.commands?.mean ?? null,
    baseCmds: base.commands?.mean ?? null,
    ecoClean: gate(eco),
    baseClean: gate(base),
    grades: eco.grades,
    broken: s.broken?.length ?? 0,
  };
}

const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : "n/a");

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const tags = argv.filter((a) => !a.startsWith("--"));
  if (!tags.length) {
    console.error("usage: node scripts/sweep-report.mjs [--json] <result-tag> [...]");
    return 2;
  }
  const batches = tags.map(loadBatch).filter(Boolean);
  if (!batches.length) {
    console.error(`no usable summaries found under ${RESULTS}`);
    return 2;
  }

  const sign = signTest(batches.map((b) => b.delta));

  if (json) {
    console.log(JSON.stringify({ batches, sign }, null, 2));
    return 0;
  }

  const w = [10, 8, 4, 10, 10, 11, 22, 9, 9, 7];
  const head = ["effort", "model", "n", "base cost", "eco cost", "delta", "95% CI (bootstrap)", "MWU p", "out only", "clean"];
  const row = (cells) => cells.map((c, i) => String(c).padEnd(w[i])).join(" ");
  console.log(row(head));
  console.log("-".repeat(w.reduce((a, b) => a + b + 1, 0)));
  for (const b of batches) {
    console.log(
      row([
        b.effort,
        String(b.model).replace(/^gpt-/, ""),
        b.n,
        f1(b.baseline),
        f1(b.eco),
        `${b.delta <= 0 ? "" : "+"}${f1(b.delta)}%`,
        b.ci ? `${f1(b.ci.lowPct)}% .. ${f1(b.ci.highPct)}%` : "n=1",
        b.p == null ? "n/a" : b.p.toFixed(4),
        `${b.outputDelta <= 0 ? "" : "+"}${f1(b.outputDelta)}%`,
        b.ecoClean === null ? "-" : b.ecoClean ? "yes" : "NO",
      ]),
    );
  }

  console.log(
    `\nDirection across ${sign.n} independent batches: ${sign.sameDirection}/${sign.n} the same way, ` +
      `two-sided sign test p = ${sign.p.toFixed(4)}${sign.allOneWay ? "" : "  <- not unanimous"}`,
  );
  const dirty = batches.filter((b) => b.ecoClean === false);
  if (dirty.length) {
    console.log(`\nQuality gate FAILED in ${dirty.length} batch(es): ${dirty.map((b) => b.effort).join(", ")}`);
    for (const b of dirty) {
      const c = b.grades?.criteria ?? {};
      console.log(
        `  ${b.effort}: ` +
          Object.entries(c)
            .map(([k, v]) => `${k} ${v.hits}/${v.runs}`)
            .join(", "),
      );
    }
  } else {
    console.log(`\nQuality gate: every eco run in every batch found both planted bugs.`);
  }
  const range = batches.map((b) => b.delta);
  console.log(
    `\nEffect range across batches: ${f1(Math.min(...range))}% .. ${f1(Math.max(...range))}%. ` +
      `Publish the range, not one batch's number.`,
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
