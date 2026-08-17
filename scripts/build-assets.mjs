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
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// One source for every number this repository shows: the charts, both READMEs and this
// card all read headlineFacts(), which applies the bench/headline.json gate.
import { headlineFacts } from "./build-charts.mjs";
// The README results block moved to scripts/build-charts.mjs, which reads the same data
// and writes both languages from one code path. Two generators owning one block meant the
// second one to run silently reverted the first - it happened once, to a good block.

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(REPO, "bench", "manifest.json");
const ASSETS = join(REPO, "assets");
// One card per language. The Turkish README opened with the English card until someone
// pointed at it, which is the kind of thing only a reader notices.
const CARDS = [
  { lang: "en", html: join(ASSETS, "social-preview.html"), png: join(ASSETS, "social-preview.png") },
  { lang: "tr", html: join(ASSETS, "social-preview.tr.html"), png: join(ASSETS, "social-preview.tr.png") },
];

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * What the card is allowed to say. The per-model aggregation that used to live here was
 * dead once headlineFacts() became the single source: it keyed on arm names that no longer
 * exist, so it reported "0 model rows" while the charts drew six.
 */
export function readData() {
  const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8").replace(/^﻿/, "")) : { runs: {} };
  return { runs: Object.keys(manifest.runs ?? {}).length, facts: headlineFacts() };
}

// ------------------------------------------------------------------- the card

// Both languages from one code path, for the same reason the charts are: a card that says
// one thing in English and another in Turkish is two claims, and only one of them can be
// checked. The Turkish README opens with the Turkish card.
const CARD_STRINGS = {
  en: {
    locale: "en-US",
    tag: "Fewer tokens per Codex turn, with a correctness floor that is measured.",
    chip: "CLI &middot; ChatGPT desktop app",
    beforeYouType: (lo, hi) => `${lo} to ${hi} before you type`,
    unmeasuredHeadline: "Measured, or not claimed",
    sub: (chars) =>
      `the ${chars} characters of instructions Codex sends on every turn, cut by settings that are ` +
      `verified against your own build`,
    unmeasuredSub: "The mechanism is built and verified. The percentages wait for the study.",
    costPerThread: (d) => `${d} cost per thread`,
    costDetail: (model, n, p) => `rules on, ${model}, n=${n}, p=${p}`,
    outputTokens: (d) => `${d} output tokens`,
    outputDetail: "and the preamble turn goes to zero",
    effortUnit: "effort batches",
    modelUnit: "models",
    sameDirection: (lo, hi) => `same direction, ${lo} to ${hi}`,
    oneWentOtherWay: (lo, hi) => `one went the other way &mdash; ${lo} to ${hi}`,
    installLabel: "install",
    installNote:
      "Writes the rules into <b>$CODEX_HOME/AGENTS.md</b>. Nothing to invoke, on every model and every effort.",
    whyLabel: "why not a skill",
    whyNote:
      "Codex publishes a skill as one catalogue line. Its body is read with a shell command &mdash; " +
      "an extra round trip &mdash; and the measurement says that costs more than it saves. " +
      "<b>AGENTS.md arrives with the prompt.</b>",
    proof: (n) => `<b>${n} runs</b> published &mdash; retractions and negative results included`,
    unmeasuredProof: `<b>no runs</b> published yet &mdash; this card will not show a number nobody measured`,
  },
  tr: {
    locale: "tr-TR",
    tag: "Codex turu başına daha az token, ölçülmüş bir doğruluk tabanıyla.",
    chip: "CLI &middot; ChatGPT masaüstü",
    beforeYouType: (lo, hi) => `sen yazmadan önce ${lo} ile ${hi}`,
    unmeasuredHeadline: "Ölçülmediyse iddia edilmez",
    sub: (chars) =>
      `Codex'in her turda gönderdiği ${chars} karakterlik talimat, kendi sürümünüzde ` +
      `doğrulanmış ayarlarla kesiliyor`,
    unmeasuredSub: "Mekanizma kurulu ve doğrulanmış. Yüzdeler çalışmayı bekliyor.",
    // Kept to one line on the card: Turkish runs longer and a two-line title pushed the
    // footer off the bottom of the fixed 1280x640 canvas.
    costPerThread: (d) => `${d} konuşma maliyeti`,
    costDetail: (model, n, p) => `kurallar açık, ${model}, n=${n}, p=${p}`,
    outputTokens: (d) => `${d} çıktı token'ı`,
    outputDetail: "ve önsöz turu sıfıra iniyor",
    effortUnit: "effort partisi",
    modelUnit: "model",
    sameDirection: (lo, hi) => `aynı yön, ${lo} ile ${hi}`,
    oneWentOtherWay: (lo, hi) => `biri ters yöne gitti &mdash; ${lo} ile ${hi}`,
    installLabel: "kurulum",
    installNote:
      "Kuralları <b>$CODEX_HOME/AGENTS.md</b> dosyasına yazar. Çağıracak bir şey yok; her modelde, her effort'ta.",
    whyLabel: "neden skill değil",
    whyNote:
      "Codex bir skill'i tek katalog satırı olarak yayınlar. Gövdesi shell komutuyla okunur &mdash; " +
      "fazladan bir tur &mdash; ve ölçüm bunun kazandırdığından fazlasına mal olduğunu söylüyor. " +
      "<b>AGENTS.md prompt ile gelir.</b>",
    proof: (n) => `<b>${n} koşu</b> yayınlandı &mdash; geri çekmeler ve negatifler dahil`,
    unmeasuredProof: `<b>Henüz koşu yok</b> &mdash; bu kart kimsenin ölçmediği bir sayıyı göstermez`,
  },
};


export function renderCard(data, lang = "en") {
  const t = CARD_STRINGS[lang];
  // The card leads with the deterministic number, not the statistical one: the prefix
  // saving is reproducible offline on the reader's own machine in one command, while the
  // behavioural saving is a range across batches with a confidence interval. Putting the
  // stronger evidence first is the honest ordering, and it happens to be the better hook.
  //
  // Fixed 1280x640 with no scrolling, so every string that can grow with the data is
  // length-checked below rather than allowed to push content off the card.
  const f = data.facts ?? {};
  // Carry the sign. An earlier version wrote `&minus;` in front of Math.abs(), which
  // rendered the +34.1% batch - the one where the block came out WORSE - as "-34%" on the
  // card. A picture that turns a bad result into a good one is worse than no picture.
  const signed = (x) => `${x <= 0 ? "&minus;" : "+"}${Math.abs(x).toFixed(0)}%`;
  const measured = Boolean(f.prefix?.aggressive);

  const headline = measured
    ? t.beforeYouType(signed(f.prefix.safe.pct), signed(f.prefix.aggressive.pct))
    : t.unmeasuredHeadline;
  const sub = measured ? t.sub(f.prefix.baseline.toLocaleString(t.locale)) : t.unmeasuredSub;

  const facts = [];
  if (f.thread?.costDelta != null) {
    facts.push([
      t.costPerThread(signed(f.thread.costDelta)),
      t.costDetail(f.thread.model, f.thread.n, f.thread.p.toFixed(3)),
    ]);
  }
  if (f.thread?.outputDelta != null) {
    facts.push([t.outputTokens(signed(f.thread.outputDelta)), t.outputDetail]);
  }
  // "N/M ... same direction" is only true when N === M. When one batch disagreed, the card
  // says so rather than quietly rounding the story up.
  const spread = (g, unit) => {
    const unanimous = g.sign.sameDirection === g.sign.n;
    return [
      `${g.sign.sameDirection}/${g.sign.n} ${unit}`,
      unanimous
        ? t.sameDirection(signed(g.worst), signed(g.best))
        : t.oneWentOtherWay(signed(g.worst), signed(g.best)),
    ];
  };
  if (f.efforts) facts.push(spread(f.efforts, t.effortUnit));
  if (f.models) facts.push(spread(f.models, t.modelUnit));
  const factHtml = facts
    .map(([big, small]) => `<div class="fact"><b>${big}</b><span>${small}</span></div>`)
    .join("\n      ");

  const proof = f.publishedRuns
    ? t.proof(f.publishedRuns)
    : t.unmeasuredProof;

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
  .hero { margin: 22px 0 0; z-index: 1; }
  .hero .big {
    font-size: 62px; font-weight: 800; color: var(--green); letter-spacing: -2px; line-height: 1;
  }
  .hero .subline {
    font-size: 19px; color: var(--dim); margin-top: 11px; max-width: 820px; line-height: 1.4;
  }
  .facts { display: flex; gap: 14px; margin-top: 20px; z-index: 1; }
  .fact {
    flex: 1; background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
    padding: 15px 17px 14px;
  }
  .fact b { display: block; font-size: 21px; font-weight: 800; color: var(--ink); letter-spacing: -.6px; }
  .fact span { display: block; font-size: 13.5px; color: var(--dim); margin-top: 6px; line-height: 1.35; }
  .how {
    margin-top: 20px; display: flex; gap: 30px; align-items: flex-start; z-index: 1;
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
    font-size: 14.5px; color: var(--dim); z-index: 1; padding-top: 14px;
  }
  footer b { color: var(--ink); }
</style>
</head>
<body>
<div class="card">
  <header>
    <div>
      <div class="brand">codex<span class="eco">-eco</span></div>
      <div class="tag">${t.tag}</div>
    </div>
    <div class="chip">${t.chip}</div>
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
      <div class="lbl">${t.installLabel}</div>
      <code>git clone https://github.com/sup3x/codex-eco</code>
      <code>cd codex-eco &amp;&amp; ./install.sh</code>
      <div class="note">${t.installNote}</div>
    </div>
    <div class="col">
      <div class="lbl">${t.whyLabel}</div>
      <div class="note" style="margin-top:9px">${t.whyNote}</div>
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
    console.log("skipped PNG: no Chrome/Chromium found - the HTML cards are still generated");
    return false;
  }
  for (const card of CARDS) {
    execFileSync(
      chrome,
      [
        "--headless",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        "--window-size=1280,640",
        `--screenshot=${card.png}`,
        pathToFileURL(card.html).href,
      ],
      { stdio: "ignore" },
    );
    console.log(`wrote ${card.png}`);
    const overflow = cardOverflow(chrome, card.html);
    if (overflow) {
      throw new Error(
        `${card.html}: content overflows the fixed 1280x640 canvas by ${overflow}px, so the card is ` +
          `clipped. The longer language overflows first - tighten the layout rather than the text.`,
      );
    }
    if (overflow === null) console.log(`  (could not measure ${basename(card.html)} for overflow)`);
  }
  return true;
}

/**
 * How many pixels of card content do not fit the fixed 1280x640 canvas?
 *
 * The card has no scrolling, so anything past 640px is simply cut off - which is how the
 * Turkish footer went missing while the English one fitted, and text length is exactly the
 * thing that differs between languages. Measuring it needs layout, not markup, so a probe
 * copy of the card is rendered with a one-line script that reports the real scrollHeight,
 * and Chrome's --dump-dom hands it back. The committed HTML stays free of that script.
 *
 * Returns the overflow in pixels, or null when it cannot be measured.
 */
function cardOverflow(chrome, html) {
  const probe = join(tmpdir(), `codex-eco-card-probe-${basename(html)}`);
  const probeScript =
    `<script>document.body.setAttribute("data-overflow",` +
    `String(Math.max(0, document.querySelector(".card").scrollHeight - 640)))</` + `script>`;
  writeFileSync(probe, readFileSync(html, "utf8").replace("</body>", `${probeScript}</body>`), "utf8");
  try {
    const dom = execFileSync(chrome, ["--headless", "--disable-gpu", "--dump-dom", pathToFileURL(probe).href], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const m = dom.match(/data-overflow="(\d+)"/);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  } finally {
    rmSync(probe, { force: true });
  }
}


function main() {
  const check = process.argv.includes("--check");
  const png = process.argv.includes("--png");
  const data = readData();
  // assets/models.svg is generated by scripts/build-charts.mjs, together with every other
  // chart and both languages. This script owns the social card only.
  const artifacts = CARDS.map((c) => ({ file: c.html, content: renderCard(data, c.lang) }));

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
    console.log(`ok: assets match the data (${data.runs} published runs)`);
    return 0;
  }

  mkdirSync(ASSETS, { recursive: true });
  for (const a of artifacts) {
    writeFileSync(a.file, a.content, "utf8");
    console.log(`wrote ${a.file} (${a.content.length} bytes)`);
  }
  if (png) rasterise();
  const f = data.facts ?? {};
  console.log(
    `data: ${data.runs} published runs | ` +
      `${f.efforts ? `${f.efforts.n} effort batches` : "no effort batches"} | ` +
      `${f.models ? `${f.models.n} models` : "no model rows"}`,
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
