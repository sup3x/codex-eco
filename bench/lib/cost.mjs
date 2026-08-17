// What a Codex turn actually costs.
//
// The first studies in this project scored `output_tokens`, because that is the
// number a token-frugality skill obviously targets. Re-reading the recorded event
// streams showed output is the smaller half by a wide margin: a one-command review
// turn on 5.6-terra billed 31,286 input tokens against 392 output. Every shell
// round trip re-sends the whole prefix, so a round trip costs more than a short
// answer does.
//
// Hence a weighted total. The weights are the GPT-5-class list-price ratios
// ($1.25 uncached / $0.125 cached / $10 output per million), normalised to
// uncached input = 1. They are an assumption; they are recorded in every
// summary.json as `costWeights` so a reader can re-weight the published runs.
//
// Contract note, verified against the event stream: `cached_input_tokens` is a
// SUBSET of `input_tokens`, not an addition. Adding them double-counts.

export const COST_WEIGHTS = Object.freeze({ uncachedInput: 1, cachedInput: 0.1, output: 8 });

export const uncachedInput = (r) => Math.max(0, (r?.inputTokens ?? 0) - (r?.cachedInputTokens ?? 0));

export function weightedCost(r, w = COST_WEIGHTS) {
  return (
    uncachedInput(r) * w.uncachedInput +
    (r?.cachedInputTokens ?? 0) * w.cachedInput +
    (r?.outputTokens ?? 0) * w.output
  );
}

/** Parse a "1,0.1,8" override into a weights object. */
export function parseWeights(text) {
  const [a, b, c] = String(text).split(",").map(Number);
  if (![a, b, c].every(Number.isFinite)) throw new Error("weights want three numbers: uncached,cached,output");
  return { uncachedInput: a, cachedInput: b, output: c };
}
