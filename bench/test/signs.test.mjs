import test from "node:test";
import assert from "node:assert/strict";
import { renderCard } from "../../scripts/build-assets.mjs";

// A number that lost its sign on the way to a picture is the most dangerous kind of bug in
// this repository: it turns a result that went the wrong way into one that went the right
// way, in the artifact most likely to be quoted without the surrounding text. It happened -
// the social card rendered the +34.1% `none` batch as "-34%" - so these lock the sign in.

const FACTS = {
  prefix: {
    codexVersion: "codex-cli 0.147.0",
    skills: 21,
    baseline: 20122,
    safe: { pct: -34.6, total: 13166 },
    aggressive: { pct: -59.0, total: 8250 },
  },
  thread: { model: "gpt-5.6-terra", n: 5, costDelta: -16.0, outputDelta: -37.4, p: 0.032 },
  // Deliberately not unanimous, with the worst batch POSITIVE.
  efforts: { sign: { sameDirection: 6, n: 7, p: 0.125 }, worst: 34.1, best: -25.1 },
  models: { sign: { sameDirection: 6, n: 6, p: 0.031 }, worst: -14.5, best: -40.4 },
  publishedRuns: 197,
};

const card = () => renderCard({ runs: FACTS.publishedRuns, facts: FACTS });

test("a positive delta is rendered with a plus, never as a minus", () => {
  const html = card();
  assert.ok(html.includes("+34%"), "the worst effort batch must show its real, positive sign");
  assert.ok(!html.includes("&minus;34%"), "a positive delta must never be printed as negative");
});

test("negative deltas keep their minus", () => {
  const html = card();
  for (const s of ["&minus;16%", "&minus;37%", "&minus;35%", "&minus;59%"]) {
    assert.ok(html.includes(s), `expected ${s} in the card`);
  }
});

test("a non-unanimous replication is not described as agreeing", () => {
  const html = card();
  assert.ok(html.includes("6/7 effort batches"));
  assert.ok(/one went the other way/.test(html), "7 batches with 6 agreeing is not 'same direction'");
  // The models group IS unanimous, so it may say so.
  assert.ok(/6\/6 models/.test(html));
  assert.ok(/same direction, &minus;15% to &minus;40%/.test(html));
});

test("with no measurements the card refuses to show a number", () => {
  const html = renderCard({ runs: 0, facts: {} });
  assert.ok(html.includes("Measured, or not claimed"));
  assert.ok(html.includes("will not show a number nobody measured"));
  assert.ok(!/[+−]\d+%/.test(html), "an unmeasured card must contain no percentages");
});
