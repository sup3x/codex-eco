#!/usr/bin/env node
// Re-reads recorded runs and reports what they actually COST, not just how many
// output tokens they emitted.
//
// Why this exists: the first studies scored `output_tokens` because that is the
// number a token-frugality skill obviously targets. Reading the raw streams
// showed output is the small half. A single-command review turn on 5.6-terra
// billed 31,286 input tokens against 392 output. Every extra shell round trip
// re-sends the whole prefix, so a round trip costs more input than the entire
// answer costs output.
//
// So the metric that decides a design question here is a weighted total. Codex
// bills uncached input, cached input and output at different rates; the weights
// below are the published GPT-5-class ratios, normalised to uncached input = 1.
// They are an assumption, stated here, and `--weights` overrides them.
//
//   node scripts/cost-report.mjs effort-low effort-medium
//   node scripts/cost-report.mjs --weights 1,0.1,8 <tag...>
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { summarizeRun, parseEvents } from "../bench/lib/codex.mjs";
import { describe, compareArms } from "../bench/lib/stats.mjs";
import { COST_WEIGHTS, weightedCost, uncachedInput, parseWeights } from "../bench/lib/cost.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RESULTS = join(REPO, "bench", "results");

// The cost model itself lives in bench/lib/cost.mjs so the harness and this
// reporter cannot drift apart.
export const DEFAULT_WEIGHTS = COST_WEIGHTS;

export function runCost(s, w = COST_WEIGHTS) {
  return {
    input: s?.inputTokens ?? 0,
    cached: s?.cachedInputTokens ?? 0,
    uncached: uncachedInput(s),
    output: s?.outputTokens ?? 0,
    reasoning: s?.reasoningTokens ?? 0,
    commands: s?.commandCount ?? 0,
    preambles: s?.preambleCount ?? 0,
    weighted: weightedCost(s, w),
  };
}

export function loadArms(tag, w = COST_WEIGHTS) {
  const rawDir = join(RESULTS, tag, "raw");
  if (!existsSync(rawDir)) return null;
  // Only score runs the harness accepted, so a rejected run cannot sneak back in.
  const accepted = new Set();
  const summaryFile = join(RESULTS, tag, "summary.json");
  let meta = {};
  if (existsSync(summaryFile)) {
    const j = JSON.parse(readFileSync(summaryFile, "utf8"));
    meta = { model: j.model, effort: j.effort, task: j.task };
    for (const a of j.arms ?? []) for (const r of a.runs ?? []) accepted.add(basename(String(r.file ?? "")));
  }
  const arms = new Map();
  for (const f of readdirSync(rawDir).filter((x) => x.endsWith(".jsonl"))) {
    if (accepted.size && !accepted.has(f)) continue;
    const armName = f.replace(/_\d+\.jsonl$/, "");
    const s = summarizeRun(parseEvents(readFileSync(join(rawDir, f), "utf8")), f);
    if (s.outputTokens == null) continue;
    if (!arms.has(armName)) arms.set(armName, []);
    arms.get(armName).push(runCost(s, w));
  }
  const field = (rows, k) => describe(rows.map((r) => r[k]));
  return {
    tag,
    ...meta,
    arms: [...arms.entries()].map(([name, rows]) => ({
      name,
      n: rows.length,
      uncached: field(rows, "uncached"),
      cached: field(rows, "cached"),
      input: field(rows, "input"),
      output: field(rows, "output"),
      commands: field(rows, "commands"),
      weighted: field(rows, "weighted"),
    })),
  };
}

const k = (x) => (Number.isFinite(x) ? (x >= 1000 ? `${(x / 1000).toFixed(1)}k` : x.toFixed(0)) : "n/a");
const pct = (d) => `${d <= 0 ? "" : "+"}${d.toFixed(1)}%`;

function main() {
  const argv = process.argv.slice(2);
  let w = COST_WEIGHTS;
  const wi = argv.indexOf("--weights");
  if (wi !== -1) {
    w = parseWeights(argv[wi + 1]);
    argv.splice(wi, 2);
  }
  const tags = argv.filter((x) => !x.startsWith("--"));
  if (!tags.length) {
    console.error("usage: node scripts/cost-report.mjs [--weights u,c,o] <result-tag> [...]");
    return 2;
  }

  console.log(
    `weights: uncached input ${w.uncachedInput} : cached input ${w.cachedInput} : output ${w.output} ` +
      `(GPT-5-class list price, normalised)\n`,
  );

  for (const tag of tags) {
    const batch = loadArms(tag, w);
    if (!batch) {
      console.error(`no raw runs under ${join(RESULTS, tag)}`);
      continue;
    }
    console.log(`### ${tag}  ${batch.model ?? ""} effort=${batch.effort ?? "?"}`);
    const base = batch.arms.find((a) => a.name === "baseline");
    const head = ["arm", "n", "uncached in", "cached in", "output", "cmds", "weighted", "vs base"];
    const wid = [12, 3, 12, 10, 8, 5, 10, 9];
    const row = (c) => c.map((x, i) => String(x).padEnd(wid[i])).join(" ");
    console.log(row(head));
    console.log("-".repeat(wid.reduce((a, b) => a + b + 1, 0)));
    for (const a of batch.arms.sort((x, y) => (x.name === "baseline" ? -1 : y.name === "baseline" ? 1 : 0))) {
      const cmp = base && a !== base ? compareArms(base.weighted.values, a.weighted.values) : null;
      console.log(
        row([
          a.name,
          a.n,
          k(a.uncached.mean),
          k(a.cached.mean),
          k(a.output.mean),
          a.commands.mean.toFixed(1),
          k(a.weighted.mean),
          cmp ? pct(cmp.pctChange) : "-",
        ]),
      );
    }
    if (base) {
      const outShare = (100 * (base.output.mean * w.output)) / base.weighted.mean;
      console.log(
        `  output is ${outShare.toFixed(1)}% of the baseline's weighted cost; ` +
          `input is the other ${(100 - outShare).toFixed(1)}%.`,
      );
    }
    console.log("");
  }
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
