// Aggregate the PUBLISHED record - bench/manifest.json plus bench/raw/ - back into the
// per-study, per-arm shape the report and chart generators need.
//
// This exists because of a CI failure that was really a design flaw. The generators used
// to read `bench/results/`, which is a working directory and gitignored, so every chart
// and every README table was derived from data a reader could not see and a clean checkout
// did not have. CI, being a clean checkout, regenerated them empty and correctly called the
// committed versions stale.
//
// Reading the manifest instead has the property the project wanted all along: every
// published number is computed from committed data, so anyone can re-derive it, and CI can
// prove the committed artifacts match.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BENCH_DIR } from "./io.mjs";
import { describe, compareArms } from "./stats.mjs";
import { weightedCost, uncachedInput, COST_WEIGHTS } from "./cost.mjs";

const MANIFEST = join(BENCH_DIR, "manifest.json");

export function readManifest(file = MANIFEST) {
  if (!existsSync(file)) return { runs: {} };
  return JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, ""));
}

/** Fraction of runs where every listed criterion was hit, as the summaries recorded it. */
function summarizeGradesFromRuns(runs) {
  const graded = runs.filter((r) => r.grade);
  if (!graded.length) return null;
  // The stored shape is `criteria: { "crash-bug": true, ... }` - a map of id to hit, which
  // is what gradeAnswer returns. Counting it as an array of objects silently produced zero
  // criteria and a quality column that said nothing.
  const criteria = {};
  for (const r of graded) {
    for (const [id, hit] of Object.entries(r.grade.criteria ?? {})) {
      criteria[id] ??= { hits: 0, runs: 0 };
      criteria[id].runs++;
      if (hit) criteria[id].hits++;
    }
  }
  return { runs: graded.length, criteria };
}

/**
 * One study, aggregated by arm. Shape matches what the generators previously read from a
 * batch summary, so callers do not have to care which source they came from.
 */
export function studySummary(studyId, manifest = readManifest()) {
  const runs = Object.entries(manifest.runs ?? {})
    .map(([id, r]) => ({ id, ...r }))
    .filter((r) => r.study === studyId && !r.aborted && r.outputTokens != null);
  if (!runs.length) return null;

  const byArm = new Map();
  for (const r of runs) {
    if (!byArm.has(r.arm)) byArm.set(r.arm, []);
    byArm.get(r.arm).push(r);
  }

  const first = runs[0];
  const arms = [...byArm.entries()].map(([name, armRuns]) => ({
    name,
    kind: armRuns[0].armKind ?? (name === "baseline" ? "baseline" : "agents"),
    skill: armRuns[0].skill ?? null,
    agentsFile: armRuns[0].agentsFile ?? null,
    runs: armRuns,
    tokens: describe(armRuns.map((r) => r.outputTokens)),
    reasoning: describe(armRuns.map((r) => r.reasoningTokens ?? 0)),
    commands: describe(armRuns.map((r) => r.commandCount ?? 0)),
    preambles: describe(armRuns.map((r) => r.preambleCount ?? 0)),
    uncachedInput: describe(armRuns.map((r) => uncachedInput(r))),
    cachedInput: describe(armRuns.map((r) => r.cachedInputTokens ?? 0)),
    weighted: describe(armRuns.map((r) => weightedCost(r))),
    grades: summarizeGradesFromRuns(armRuns),
  }));

  const baseline = arms.find((a) => a.kind === "baseline");
  const comparisons = {};
  const weightedComparisons = {};
  if (baseline) {
    for (const arm of arms.filter((a) => a !== baseline)) {
      comparisons[arm.name] = compareArms(baseline.tokens.values, arm.tokens.values);
      weightedComparisons[arm.name] = compareArms(baseline.weighted.values, arm.weighted.values);
    }
  }

  return {
    study: studyId,
    model: first.model,
    effort: first.effort,
    task: first.task,
    turns: first.turns ?? [first.task],
    rubric: first.rubric,
    codexVersion: first.codexVersion,
    costWeights: first.costWeights ?? COST_WEIGHTS,
    arms,
    comparisons,
    weightedComparisons,
  };
}

/** Every study id present in the manifest, excluding aborted-only ones. */
export function studyIds(manifest = readManifest()) {
  const ids = new Set();
  for (const r of Object.values(manifest.runs ?? {})) if (!r.aborted) ids.add(r.study);
  return [...ids];
}
