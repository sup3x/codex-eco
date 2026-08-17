import test from "node:test";
import assert from "node:assert/strict";
import { weightedCost, COST_WEIGHTS } from "../lib/cost.mjs";
import { signTest } from "../../scripts/sweep-report.mjs";
import { runCost, DEFAULT_WEIGHTS } from "../../scripts/cost-report.mjs";

// The numbers below are lifted from a recorded run, bench/results/effort-low/raw/
// skill_01.jsonl, so the arithmetic is checked against real usage rather than a
// hypothetical.
const RECORDED = {
  inputTokens: 48926,
  cachedInputTokens: 33024,
  cacheWriteTokens: 0,
  outputTokens: 544,
  reasoningTokens: 156,
};

test("cached input is treated as a subset of input, not an addition", () => {
  // 48,926 total input of which 33,024 was cached leaves 15,902 billed at full rate.
  const uncached = RECORDED.inputTokens - RECORDED.cachedInputTokens;
  const expected = uncached * 1 + RECORDED.cachedInputTokens * 0.1 + RECORDED.outputTokens * 8;
  assert.equal(weightedCost(RECORDED), expected);
  assert.equal(Math.round(weightedCost(RECORDED)), 23556); // 15,902 + 3,302.4 + 4,352
});

test("the two implementations of the cost model agree", () => {
  assert.deepEqual(COST_WEIGHTS, DEFAULT_WEIGHTS);
  assert.equal(runCost(RECORDED).weighted, weightedCost(RECORDED));
  assert.equal(runCost(RECORDED).uncached, 15902);
});

test("a run missing usage fields costs zero rather than NaN", () => {
  assert.equal(weightedCost({}), 0);
  assert.equal(runCost({}).weighted, 0);
});

test("cached exceeding input cannot produce a negative uncached figure", () => {
  // Defensive: the API contract says cached is a subset, but a clamp beats a
  // negative cost silently making an arm look cheap.
  assert.equal(runCost({ inputTokens: 100, cachedInputTokens: 400, outputTokens: 0 }).uncached, 0);
});

test("output is the minority of a real turn's bill", () => {
  const c = runCost(RECORDED);
  const outputShare = (c.output * DEFAULT_WEIGHTS.output) / c.weighted;
  assert.ok(outputShare < 0.25, `output share was ${outputShare}`);
});

test("sign test needs unanimity before it means anything at n=4", () => {
  assert.deepEqual(signTest([-1, -2, -3, -4]), { n: 4, sameDirection: 4, allOneWay: true, p: 0.125 });
  assert.equal(signTest([-1, -2, -3, 4]).allOneWay, false);
  assert.equal(signTest([-1, -2, -3, 4]).p, 0.625); // 2*(C(4,3)+C(4,4))/16
});

test("sign test ignores exact zeros rather than counting them as a direction", () => {
  assert.equal(signTest([-1, -2, 0, 0]).n, 2);
});
