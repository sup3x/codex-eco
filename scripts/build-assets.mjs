#!/usr/bin/env node
// Generates the repository's images from the measured data.
//
// A picture in a README is a claim like any other. Both artifacts here are
// computed from bench/manifest.json, so the card cannot show a percentage that
// is not in the raw runs, and `--check` fails CI if either file drifts from the
// data. Before the first study lands the manifest is empty and both artifacts
// render in "pre-measurement" form, with no numbers at all - which is the point.
//
//   node scripts/build-assets.mjs           # write assets/*
//   node scripts/build-assets.mjs --check   # exit 1 if a committed asset is stale
//   node scripts/build-assets.mjs --png     # also rasterise the card via headless Chrome
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// One source for every number this repository shows: the charts, both READMEs and this
// card all read headlineFacts(), which applies the bench/headline.json gate.
import { headlineFacts } from "./build-charts.mjs";
// The README results block moved to scripts/build-charts.mjs, which reads the same data
// and writes both languages from one code path. Two generators owning one block meant the
// second one to run silently reverted the first - it happened once, to a good block.

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(REPO, "bench", "manifest.json");
const HEADLINE = join(REPO, "bench", "headline.json");
const ASSETS = join(REPO, "assets");
const CARD_HTML = join(ASSETS, "social-preview.html");
const CARD_PNG = join(ASSETS, "social-preview.png");

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Group published runs into { model -> { arm -> [outputTokens] } } plus grading counts. */
export function readData() {
  if (!existsSync(MANIFEST)) return { runs: 0, models: [], facts: headlineFacts() };
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8").replace(/^\ufeff/, ""));
  const allRows = Object.entries(manifest.runs ?? {}).map(([id, r]) => ({ id, ...r }));
  if (!allRows.length) return { runs: 0, models: [], facts: headlineFacts() };

  // Everything in bench/raw is published; only the studies listed in
  // bench/headline.json may drive the README table. One batch is not a headline:
  // the same configuration measured -49% in one batch and +24% in another.
  const headline = existsSync(HEADLINE) ? JSON.parse(readFileSync(HEADLINE, "utf8")) : { studies: [] };
  const allowed = new Set(headline.studies ?? []);
  const rows = allRows.filter((r) => allowed.has(r.study));

  const byModel = new Map();
  for (const r of rows) {
    if (!r.model || r.outputTokens == null) continue;
    if (r.arm !== "baseline" && r.arm !== "skill") continue;
    if (!byModel.has(r.model)) byModel.set(r.model, { model: r.model, arms: new Map() });
    const entry = byModel.get(r.model);
    const arm = r.arm === "baseline" ? "baseline" : "eco";
    if (!entry.arms.has(arm)) entry.arms.set(arm, []);
    entry.arms.get(arm).push(r.outputTokens);
  }

  const models = [];
  for (const { model, arms } of byModel.values()) {
    const base = arms.get("baseline") ?? [];
    const eco = arms.get("eco") ?? [];
    if (!base.length || !eco.length) continue;
    const b = mean(base);
    const e = mean(eco);
    models.push({ model, baseline: b, eco: e, n: Math.min(base.length, eco.length), delta: ((e - b) / b) * 100 });
  }
  models.sort((a, b) => a.delta - b.delta);
  return { runs: allRows.length, headlineRuns: rows.length, models, facts: headlineFacts() };
}


// ------------------------------------------------------------------- the card

export function renderCard(data) {
  // The card leads with the deterministic number, not the statistical one: the prefix
  // saving is reproducible offline on the reader's own machine in one command, while the
  // behavioural saving is a range across batches with a confidence interval. Putting the
  // stronger evidence first is the honest ordering, and it happens to be the better hook.
  //
  // Fixed 1280x640 with no scrolling, so every string that can grow with the data is
  // length-checked below rather than allowed to push content off the card.
  const f = data.facts ?? {};
  const minus = (x) => `&minus;${Math.abs(x).toFixed(0)}%`;
  const measured = Boolean(f.prefix?.aggressive);

  const headline = measured
    ? `${minus(f.prefix.safe.pct)} to ${minus(f.prefix.aggressive.pct)} before you type`
    : "Measured, or not claimed";
  const sub = measured
    ? `the ${f.prefix.baseline.toLocaleString("en-US")} characters of instructions Codex sends on every ` +
      `turn, cut by settings that are verified against your own build`
    : "The mechanism is built and verified. The percentages wait for the study.";

  const facts = [];
  if (f.thread?.costDelta != null) {
    facts.push([
      `${minus(f.thread.costDelta)} cost per thread`,
      `rules on, ${f.thread.model}, n=${f.thread.n}, p=${f.thread.p.toFixed(3)}`,
    ]);
  }
  if (f.thread?.outputDelta != null) {
    facts.push([`${minus(f.thread.outputDelta)} output tokens`, `and the preamble turn goes to zero`]);
  }
  if (f.efforts) {
    facts.push([
      `${f.efforts.sign.sameDirection}/${f.efforts.sign.n} effort levels`,
      `same direction, ${minus(f.efforts.worst)} to ${minus(f.efforts.best)}`,
    ]);
  }
  if (f.models) {
    facts.push([
      `${f.models.sign.sameDirection}/${f.models.sign.n} models`,
      `same direction, ${minus(f.models.worst)} to ${minus(f.models.best)}`,
    ]);
  }
  const factHtml = facts
    .map(([big, small]) => `<div class="fact"><b>${big}</b><span>${small}</span></div>`)
    .join("\n      ");

  const proof = f.publishedRuns
    ? `<b>${f.publishedRuns} runs</b> published &mdash; retractions and negative results included`
    : `<b>no runs</b> published yet &mdash; this card will not show a number nobody measured`;

  return `<!DOCTYPE html>
<!-- Social preview card, generated by scripts/build-assets.mjs. Every number comes from
     headlineFacts() in scripts/build-charts.mjs, which reads the recorded studies and
     applies the bench/headline.json gate. Do not edit by hand: run the generator.
     Render at 1280x640. -->
<html lang="en">
<head>
<meta charset="utf-8">
<title>codex-eco social preview</title>
<style>
  :root {
    --bg: #080b11; --bg2: #0e1420; --panel: #0c1320; --line: #1c2740;
    --ink: #e8ecf3; --dim: #8e99ac; --green: #34d399; --mono: "Cascadia Mono", Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: #05070b; font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif; }
  .card {
    width: 1280px; height: 640px; padding: 44px 56px 38px;
    background:
      radial-gradient(1100px 520px at 88% -14%, rgba(52, 211, 153, 0.14), transparent 62%),
      linear-gradient(140deg, var(--bg) 0%, var(--bg2) 100%);
    color: var(--ink); display: flex; flex-direction: column; position: relative; overflow: hidden;
  }
  .card::before {
    content: ""; position: absolute; inset: 0; pointer-events: none;
    background-image: linear-gradient(rgba(255,255,255,.028) 1px, transparent 1px),
                      linear-gradient(90deg, rgba(255,255,255,.028) 1px, transparent 1px);
    background-size: 64px 64px;
    mask-image: linear-gradient(180deg, rgba(0,0,0,.9), transparent 78%);
  }
  header { display: flex; align-items: flex-start; justify-content: space-between; z-index: 1; }
  .brand { font-size: 44px; font-weight: 800; letter-spacing: -1.4px; line-height: 1; }
  .brand .eco { color: var(--green); }
  .tag { font-size: 20px; color: var(--dim); margin-top: 9px; letter-spacing: -.2px; }
  .chip {
    font-size: 15px; font-weight: 700; color: var(--green); letter-spacing: .3px;
    border: 1px solid rgba(52,211,153,.42); border-radius: 999px; padding: 8px 16px;
    background: rgba(52,211,153,.09); white-space: nowrap;
  }
  .hero { margin: 30px 0 0; z-index: 1; }
  .hero .big {
    font-size: 62px; font-weight: 800; color: var(--green); letter-spacing: -2px; line-height: 1;
  }
  .hero .subline {
    font-size: 19px; color: var(--dim); margin-top: 13px; max-width: 780px; line-height: 1.45;
  }
  .facts { display: flex; gap: 14px; margin-top: 26px; z-index: 1; }
  .fact {
    flex: 1; background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
    padding: 15px 17px 14px;
  }
  .fact b { display: block; font-size: 23px; font-weight: 800; color: var(--ink); letter-spacing: -.6px; }
  .fact span { display: block; font-size: 13.5px; color: var(--dim); margin-top: 6px; line-height: 1.35; }
  .how {
    margin-top: 26px; display: flex; gap: 30px; align-items: flex-start; z-index: 1;
    border: 1px solid var(--line); border-radius: 12px; background: rgba(12,19,32,.72); padding: 17px 20px;
  }
  .how .col { flex: 1; }
  .how .lbl {
    font-size: 12px; font-weight: 700; color: var(--green); letter-spacing: .9px; text-transform: uppercase;
  }
  .how code { display: block; font-family: var(--mono); font-size: 15px; color: var(--ink); margin-top: 9px; }
  .how .note { font-size: 13px; color: var(--dim); margin-top: 9px; line-height: 1.4; }
  footer {
    margin-top: auto; display: flex; align-items: center; justify-content: space-between;
    font-size: 14.5px; color: var(--dim); z-index: 1; padding-top: 20px;
  }
  footer b { color: var(--ink); }
</style>
</head>
<body>
<div class="card">
  <header>
    <div>
      <div class="brand">codex<span class="eco">-eco</span></div>
      <div class="tag">Fewer tokens per Codex turn, with a correctness floor that is measured.</div>
    </div>
    <div class="chip">CLI &middot; ChatGPT desktop app</div>
  </header>

  <div class="hero">
    <div class="big">${headline}</div>
    <div class="subline">${sub}</div>
  </div>

  <div class="facts">
      ${factHtml}
  </div>

  <div class="how">
    <div class="col">
      <div class="lbl">install</div>
      <code>git clone https://github.com/sup3x/codex-eco</code>
      <code>cd codex-eco &amp;&amp; ./install.sh</code>
      <div class="note">Writes the rules into <b>$CODEX_HOME/AGENTS.md</b>. Nothing to invoke, on every model and every effort.</div>
    </div>
    <div class="col">
      <div class="lbl">why not a skill</div>
      <div class="note" style="margin-top:9px">
        Codex publishes a skill as one catalogue line. Its body is read with a shell command &mdash;
        an extra round trip &mdash; and the measurement says that costs more than it saves.
        <b>AGENTS.md arrives with the prompt.</b>
      </div>
    </div>
  </div>

  <footer>
    <div>${proof}</div>
    <div>MIT &middot; <b>github.com/sup3x/codex-eco</b></div>
  </footer>
</div>
</body>
</html>
`;
}

// ----------------------------------------------------------------- the driver

function findChrome() {
  for (const c of CHROME_CANDIDATES) if (existsSync(c)) return c;
  return null;
}

function rasterise() {
  const chrome = findChrome();
  if (!chrome) {
    console.log("skipped PNG: no Chrome/Chromium found - the HTML card is still generated");
    return false;
  }
  execFileSync(
    chrome,
    [
      "--headless",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--window-size=1280,640",
      `--screenshot=${CARD_PNG}`,
      pathToFileURL(CARD_HTML).href,
    ],
    { stdio: "ignore" },
  );
  console.log(`wrote ${CARD_PNG}`);
  return true;
}

function main() {
  const check = process.argv.includes("--check");
  const png = process.argv.includes("--png");
  const data = readData();
  // assets/models.svg is generated by scripts/build-charts.mjs, together with every other
  // chart and both languages. This script owns the social card only.
  const artifacts = [{ file: CARD_HTML, content: renderCard(data) }];

  if (check) {
    let stale = 0;
    for (const a of artifacts) {
      const current = existsSync(a.file) ? readFileSync(a.file, "utf8") : "";
      if (current.replace(/\r\n/g, "\n") !== a.content) {
        console.error(`stale: ${a.file} does not match bench/manifest.json`);
        stale++;
      }
    }
    if (stale) {
      console.error("run `node scripts/build-assets.mjs` and commit the result.");
      return 1;
    }
    console.log(`ok: assets match the data (${data.runs} published runs, ${data.models.length} model rows)`);
    return 0;
  }

  mkdirSync(ASSETS, { recursive: true });
  for (const a of artifacts) {
    writeFileSync(a.file, a.content, "utf8");
    console.log(`wrote ${a.file} (${a.content.length} bytes)`);
  }
  if (png) rasterise();
  console.log(`data: ${data.runs} published runs, ${data.models.length} model rows`);
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
