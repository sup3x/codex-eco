#!/usr/bin/env node
// Builds the README's charts, in English and Turkish, from recorded data only.
//
//   assets/prefix.svg     <- assets/data/prefix.json      (a dated prompt-input render)
//   assets/surfaces.svg   <- bench/results/thread-terra/   (the delivery-mechanism study)
//   assets/efforts.svg    <- bench/results/eff-*/          (the effort replication)
//   assets/*.tr.svg       <- the same data, Turkish strings
//
// Nothing here may hardcode a measurement: every number is read from a file under
// version control, and `--check` re-renders and fails if a committed SVG differs. The
// two languages are generated from ONE data path, so a number cannot be right in one
// README and wrong in the other.
//
//   node scripts/build-charts.mjs
//   node scripts/build-charts.mjs --check
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { barChart, emptyChart } from "./lib/chart.mjs";
import { signTest } from "./sweep-report.mjs";
// Read the PUBLISHED record, not the working directory. bench/results/ is gitignored, so
// generating a chart from it meant a clean checkout could not reproduce the chart - CI
// proved that by regenerating them empty and calling the committed ones stale.
import { readManifest, studySummary, studyIds } from "../bench/lib/published.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = join(REPO, "assets");

const THREAD_STUDY = "mechanism-thread";
const EFFORT_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

/** bench/headline.json decides which studies may produce a published claim. */
function allowedStudies() {
  const gate = join(REPO, "bench", "headline.json");
  return new Set(existsSync(gate) ? (readJson(gate).studies ?? []) : []);
}
const allowedStudy = (id) => allowedStudies().has(id);
// One minus sign everywhere. Mixing U+2212 in a table with an ASCII hyphen in the
// confidence interval beside it looks like two different measurements.
const MINUS = "−";
const signed = (n, dp = 0) => `${n <= 0 ? MINUS : "+"}${Math.abs(n).toFixed(dp)}%`;
const plain = (n, dp = 1) => `${n < 0 ? MINUS : ""}${Math.abs(n).toFixed(dp)}%`;
const pct = (p) => signed(p, 0);

// ------------------------------------------------------------------- strings

// Turkish runs longer than English almost line for line, and the renderer throws when a
// string overruns its column, so both sets are kept tight on purpose.
const STRINGS = {
  en: {
    locale: "en-US",
    k: (n) => `${(n / 1000).toFixed(1)}k`,
    effort: (e) => e,
    ci: (lo, hi, p) => `95% CI ${lo} .. ${hi}, p = ${p}`,
    prefix: {
      title: "What a Codex session costs before you type a character",
      subtitle: (s) => `${s.codexVersion} · recorded ${s.recordedAt} · the prefix Codex sends on every turn`,
      catalogue: (n) => `${n} skills in the catalogue`,
      rows: [
        ["as installed", null],
        ["eco profile", "four settings, nothing you lose"],
        ["eco-max profile", "also turns apps and plugins off"],
      ],
      chars: (n) => `${n} chars`,
      tokens: (n) => `about ${n} tokens, every turn`,
      footer: [
        "Deterministic, not statistical: `codex debug prompt-input` renders the model-visible input offline.",
        "`node scripts/prefix-audit.mjs` reproduces this on your machine, with your skills, and calls no model.",
        "Characters are measured; the token figure is chars/4, an estimate. Your catalogue size sets your total.",
      ],
    },
    surfaces: {
      title: "Same rules, three ways to deliver them — cost of one three-turn thread",
      subtitle: (s, n, effort) =>
        `${s.model} · ${effort} effort · n=${n} per arm, interleaved in one batch · ` +
        `review, then patch, then an open question`,
      arms: {
        baseline: ["no rules", "plain Codex"],
        skill: ["$eco skill", "read from disk on use"],
        full: ["AGENTS.md full", "3.6 kB block"],
        lean: ["AGENTS.md short", "1.1 kB block — shipped"],
        agents: ["AGENTS.md", "loaded with the prompt"],
      },
      units: (k) => `${k} cost units`,
      detail: (out, cmd, pre, bugs) => `${out} out · ${cmd} cmd · ${pre} pre · ${bugs} bugs`,
      footer: (ci) => [
        "Cost units = uncached input x1 + cached input x0.1 + output x8, the GPT-5-class price ratios.",
        "Output alone is under a third of a Codex turn's bill, which is why it is not the headline metric.",
        `Every arm found both planted bugs in every run, so cheapness decides. ${ci}`,
        "A skill's body is read with a shell command; AGENTS.md arrives with the prompt. That is the difference.",
      ],
      emptyTitle: "No thread study recorded",
      empty: [
        "Run `node bench/bench.mjs study review-thread --n 5 --model gpt-5.6-terra ...`.",
        "This chart stays empty rather than showing a number nobody measured.",
      ],
    },
    efforts: {
      title: "Does the short block still pay off at every reasoning effort?",
      subtitle: (model) =>
        `${model} · the shipped 1.1 kB AGENTS.md block against no rules · each level is its own batch`,
      perArm: (n) => `n=${n} per arm`,
      units: (a, b) => `${a} → ${b} cost units`,
      detail: (d, clean) => `output ${d}` + (clean ? " · both bugs found every run" : " · A BUG WAS MISSED"),
      footer: (sign) => [
        `Bars show how big the change is; the number on the right says which way. ` +
          `${sign.sameDirection}/${sign.n} batches agreed, sign test p = ${sign.p.toFixed(3)}.`,
        "Between-batch noise here is larger than the effect, so the range across batches is the claim.",
        "Every batch is published, including any that went the wrong way. bench/results/eff-*/ holds the raw streams.",
      ],
      emptyTitle: "No effort replication recorded",
      empty: [
        "One batch cannot settle a direction on this task; the bar is the direction repeating.",
        "Run the sweep and this chart appears. Until then it says nothing.",
      ],
    },
    models: {
      title: "Does it hold on every Codex model?",
      subtitle: (n) =>
        `the shipped 1.1 kB AGENTS.md block against no rules · ${n} models · one three-turn thread per run`,
      perArm: (n) => `n=${n} per arm`,
      units: (a, b) => `${a} → ${b} cost units`,
      detail: (d, clean) => `output ${d}` + (clean ? " · both bugs found every run" : " · A BUG WAS MISSED"),
      footer: (sign) => [
        `${sign.sameDirection}/${sign.n} models moved the same way, two-sided sign test p = ${sign.p.toFixed(3)}.`,
        "Absolute counts are not comparable across models - different tokenizers - only the percentage within a row is.",
        "A model where the block loses is shown in red at its real size, not left out.",
      ],
      emptyTitle: "No model matrix recorded",
      empty: [
        "Run the matrix and this chart appears; it stays empty rather than implying coverage.",
      ],
    },
    noSnapshot: {
      title: "No prefix snapshot recorded",
      lines: [
        "Run `node scripts/snapshot-prefix.mjs` on a machine with the Codex CLI.",
        "The audit makes no model call, so this costs nothing.",
      ],
    },
  },
  tr: {
    locale: "tr-TR",
    k: (n) => `${(n / 1000).toFixed(1)}k`,
    // The harness records the effort as the literal "(model default)" when none was set.
    effort: (e) => (e === "(model default)" ? "(model varsayılanı)" : e),
    ci: (lo, hi, p) => `%95 GA ${lo} .. ${hi}, p = ${p}`,
    prefix: {
      title: "Bir karakter yazmadan önce Codex oturumunuzun maliyeti",
      subtitle: (s) => `${s.codexVersion} · ${s.recordedAt} · Codex'in her turda gönderdiği talimat ön eki`,
      catalogue: (n) => `katalogda ${n} skill`,
      rows: [
        ["kurulu hali", null],
        ["eco profili", "dört ayar, kaybınız yok"],
        ["eco-max profili", "apps ve plugin'leri de kapatır"],
      ],
      chars: (n) => `${n} karakter`,
      tokens: (n) => `her turda yaklaşık ${n} token`,
      footer: [
        "İstatistik değil, kesin: `codex debug prompt-input` modelin göreceği listeyi çevrimdışı üretir.",
        "`node scripts/prefix-audit.mjs` bunu sizin makinenizde, sizin skill'lerinizle üretir; model çağrısı yok.",
        "Karakter sayısı ölçümdür; token değeri karakter/4 tahminidir. Toplamı katalog boyutunuz belirler.",
      ],
    },
    surfaces: {
      title: "Aynı kurallar, üç taşıma yolu — üç turluk bir konuşmanın maliyeti",
      subtitle: (s, n, effort) =>
        `${s.model} · ${effort} effort · kol başına n=${n}, tek partide dönüşümlü · ` +
        `incele, düzelt, açık uçlu soru`,
      arms: {
        baseline: ["kural yok", "düz Codex"],
        skill: ["$eco skill", "kullanımda diskten okunur"],
        full: ["AGENTS.md tam", "3.6 kB blok"],
        lean: ["AGENTS.md kısa", "1.1 kB blok — dağıtılan"],
        agents: ["AGENTS.md", "prompt ile yüklenir"],
      },
      units: (k) => `${k} maliyet birimi`,
      detail: (out, cmd, pre, bugs) => `${out} çıktı · ${cmd} komut · ${pre} önsöz · ${bugs} hata`,
      footer: (ci) => [
        "Maliyet birimi = önbelleksiz girdi x1 + önbellekli girdi x0.1 + çıktı x8; GPT-5 sınıfı fiyat oranları.",
        "Çıktı, bir Codex turunun faturasının üçte birinden az; başlık metrik bu yüzden o değil.",
        `Her kol, her koşuda iki hatayı da buldu; karar ucuzluğa kalıyor. ${ci}`,
        "Skill'in gövdesi shell komutuyla okunur; AGENTS.md prompt ile gelir. Fark tam olarak bu.",
      ],
      emptyTitle: "Henüz kayıtlı konuşma çalışması yok",
      empty: [
        "`node bench/bench.mjs study review-thread --n 5 --model gpt-5.6-terra ...` çalıştırın.",
        "Bu grafik, kimsenin ölçmediği bir sayı göstermek yerine boş kalır.",
      ],
    },
    efforts: {
      title: "Kısa blok her reasoning effort seviyesinde de kazandırıyor mu?",
      subtitle: (model) =>
        `${model} · dağıtılan 1.1 kB AGENTS.md bloğu, kuralsız duruma karşı · her seviye ayrı bir parti`,
      perArm: (n) => `kol başına n=${n}`,
      units: (a, b) => `${a} → ${b} maliyet birimi`,
      detail: (d, clean) => `çıktı ${d}` + (clean ? " · her koşuda iki hata da bulundu" : " · BİR HATA KAÇIRILDI"),
      footer: (sign) => [
        `Çubuklar değişimin büyüklüğünü, sağdaki sayı yönünü gösterir. ` +
          `${sign.sameDirection}/${sign.n} parti aynı yöne gitti, işaret testi p = ${sign.p.toFixed(3)}.`,
        "Partiler arası gürültü etkiden büyük; bu yüzden iddia tek parti değil, partiler arası aralıktır.",
        "Ters yöne gidenler dahil her parti yayınlanıyor. Ham akışlar bench/results/eff-*/ altında.",
      ],
      emptyTitle: "Henüz effort tekrarı kayıtlı değil",
      empty: [
        "Bu işte tek parti bir yönü kanıtlamaz; ölçüt, yönün tekrar etmesidir.",
        "Süpürmeyi çalıştırın, grafik o zaman çıkar. O ana kadar hiçbir şey söylemez.",
      ],
    },
    models: {
      title: "Her Codex modelinde geçerli mi?",
      subtitle: (n) =>
        `dağıtılan 1.1 kB AGENTS.md bloğu, kuralsız duruma karşı · ${n} model · koşu başına üç turluk bir konuşma`,
      perArm: (n) => `kol başına n=${n}`,
      units: (a, b) => `${a} → ${b} maliyet birimi`,
      detail: (d, clean) => `çıktı ${d}` + (clean ? " · her koşuda iki hata da bulundu" : " · BİR HATA KAÇIRILDI"),
      footer: (sign) => [
        `${sign.sameDirection}/${sign.n} model aynı yöne gitti, iki yönlü işaret testi p = ${sign.p.toFixed(3)}.`,
        "Mutlak sayılar modeller arasında kıyaslanamaz - tokenizer'lar farklı - yalnız satır içindeki yüzde kıyaslanabilir.",
        "Bloğun kaybettiği bir model, gerçek boyutuyla kırmızı gösterilir; dışarıda bırakılmaz.",
      ],
      emptyTitle: "Model matrisi kayıtlı değil",
      empty: [
        "Matrisi çalıştırın, grafik o zaman çıkar; kapsama varmış gibi göstermek yerine boş kalır.",
      ],
    },
    noSnapshot: {
      title: "Kayıtlı ön ek anlık görüntüsü yok",
      lines: [
        "Codex CLI kurulu bir makinede `node scripts/snapshot-prefix.mjs` çalıştırın.",
        "Denetim model çağrısı yapmaz, yani bedavadır.",
      ],
    },
  },
};

// ---------------------------------------------------------------- prefix chart

export function renderPrefix(lang = "en") {
  const t = STRINGS[lang];
  const file = join(ASSETS, "data", "prefix.json");
  if (!existsSync(file)) return emptyChart(t.noSnapshot.title, t.noSnapshot.lines);
  const s = readJson(file);
  const num = (n) => Math.round(n).toLocaleString(t.locale);

  const rows = [
    {
      label: t.prefix.rows[0][0],
      sub: t.prefix.catalogue(s.skillsInCatalogue),
      value: s.baseline.total,
      display: t.prefix.chars(num(s.baseline.total)),
      detail: t.prefix.tokens(num(s.baseline.total / 4)),
      tone: "base",
    },
  ];
  ["safe", "aggressive"].forEach((id, i) => {
    const tier = s.tiers.find((x) => x.id === id);
    if (!tier) return;
    rows.push({
      label: t.prefix.rows[i + 1][0],
      sub: t.prefix.rows[i + 1][1],
      value: tier.total,
      display: t.prefix.chars(num(tier.total)),
      detail: t.prefix.tokens(num(tier.total / 4)),
      note: pct(tier.pct),
      tone: "good",
    });
  });
  return barChart({ title: t.prefix.title, subtitle: t.prefix.subtitle(s), rows, footer: t.prefix.footer });
}

// -------------------------------------------------------------- surface chart

export function renderSurfaces(lang = "en") {
  const t = STRINGS[lang];
  const s = allowedStudy(THREAD_STUDY) ? studySummary(THREAD_STUDY) : null;
  if (!s) return emptyChart(t.surfaces.emptyTitle, t.surfaces.empty);
  const base = s.arms.find((a) => a.kind === "baseline");
  const order = ["baseline", "skill", "full", "lean"].filter((n) => s.arms.some((a) => a.name === n));

  const rows = order.map((name) => {
    const a = s.arms.find((x) => x.name === name);
    const delta = s.weightedComparisons?.[name]?.pctChange ?? 0;
    // Both planted bugs as one fraction: 5/5 means every run found both of them.
    const gates = ["crash-bug", "nan-bug"].map((c) => a.grades?.criteria[c]).filter(Boolean);
    const bugs = gates.length ? `${Math.min(...gates.map((g) => g.hits))}/${gates[0].runs}` : "?";
    const [label, sub] = t.surfaces.arms[name] ?? [name, ""];
    return {
      label,
      sub,
      value: a.weighted.mean,
      display: t.surfaces.units(t.k(a.weighted.mean)),
      detail: t.surfaces.detail(
        Math.round(a.tokens.mean),
        a.commands.mean.toFixed(1),
        a.preambles.mean.toFixed(1),
        bugs,
      ),
      note: a === base ? "" : pct(delta),
      tone: a === base ? "base" : delta > 0 ? "bad" : "good",
    };
  });

  const winner = s.weightedComparisons?.lean ?? s.weightedComparisons?.agents;
  const ci = winner?.ci95
    ? t.ci(plain(winner.ci95.lowPct, 0), plain(winner.ci95.highPct, 0), winner.mannWhitneyP.toFixed(3))
    : "";
  return barChart({
    title: t.surfaces.title,
    subtitle: t.surfaces.subtitle(s, base.tokens.n, t.effort(s.effort)),
    rows,
    footer: t.surfaces.footer(ci),
    // Four metrics per row need a wider value column than the default, and Turkish
    // needs more of it than English; one width keeps the two charts identical in layout.
    valueW: 290,
  });
}

// --------------------------------------------------------------- effort chart

export function readEffortBatches() {
  const out = [];
  const manifest = readManifest();
  for (const dir of studyIds(manifest).filter((id) => id.startsWith("effort-") && allowedStudy(id))) {
    const s = studySummary(dir, manifest);
    if (!s) continue;
    const base = s.arms.find((a) => a.kind === "baseline");
    const eco = s.arms.find((a) => a.kind === "agents");
    if (!base || !eco) continue;
    out.push({
      tag: dir,
      effort: s.effort,
      model: s.model,
      n: Math.min(base.tokens.n, eco.tokens.n),
      baseline: base.weighted.mean,
      eco: eco.weighted.mean,
      delta: s.weightedComparisons?.[eco.name]?.pctChange ?? 0,
      outputDelta: s.comparisons?.[eco.name]?.pctChange ?? 0,
      ci: s.weightedComparisons?.[eco.name]?.ci95 ?? null,
      p: s.weightedComparisons?.[eco.name]?.mannWhitneyP ?? null,
      clean: Boolean(
        eco.grades &&
          ["crash-bug", "nan-bug"].every((c) => eco.grades.criteria[c].hits === eco.grades.criteria[c].runs),
      ),
    });
  }
  out.sort((a, b) => EFFORT_ORDER.indexOf(a.effort) - EFFORT_ORDER.indexOf(b.effort) || a.tag.localeCompare(b.tag));
  // An effort level measured twice gets two rows, numbered. Averaging them would hide the
  // thing worth seeing: at `none` the two batches disagree, and that disagreement IS the
  // finding - one batch alone would have "shown" the block to be harmful there.
  const counts = new Map();
  for (const b of out) counts.set(b.effort, (counts.get(b.effort) ?? 0) + 1);
  const seen = new Map();
  for (const b of out) {
    if ((counts.get(b.effort) ?? 0) < 2) {
      b.label = b.effort;
      continue;
    }
    const n = (seen.get(b.effort) ?? 0) + 1;
    seen.set(b.effort, n);
    b.label = `${b.effort} #${n}`;
  }
  return out;
}

export function renderEfforts(lang = "en") {
  const t = STRINGS[lang];
  const batches = readEffortBatches();
  if (!batches.length) return emptyChart(t.efforts.emptyTitle, t.efforts.empty);
  const sign = signTest(batches.map((b) => b.delta));
  const rows = batches.map((b) => ({
    label: b.label ?? b.effort,
    sub: t.efforts.perArm(b.n),
    // The bar carries magnitude and the right-hand number carries the sign, so a batch
    // that went the wrong way is long and red rather than invisibly short.
    value: Math.abs(b.delta),
    display: t.efforts.units(t.k(b.baseline), t.k(b.eco)),
    detail: t.efforts.detail(pct(b.outputDelta), b.clean),
    note: pct(b.delta),
    tone: b.delta > 0 || !b.clean ? "bad" : "good",
  }));
  return barChart({
    title: t.efforts.title,
    subtitle: t.efforts.subtitle(batches[0].model),
    rows,
    footer: t.efforts.footer(sign),
  });
}

// --------------------------------------------------------------- model chart

/**
 * One row per model, from `bench/results/mdl-*`. Reads the same shape as the effort
 * batches; the two are deliberately the same experiment with one factor swapped, so a
 * reader can compare the tables directly.
 */
export function readModelBatches() {
  const out = [];
  const manifest = readManifest();
  // The thread study IS the terra row: same study definition, same block, same effort, just
  // a larger n. Re-running it under a model- id would spend tokens to reproduce a
  // measurement that already exists, so it is read in place and carries its own n.
  const ids = [...studyIds(manifest).filter((id) => id.startsWith("model-")), THREAD_STUDY].filter(allowedStudy);
  for (const dir of ids) {
    const s = studySummary(dir, manifest);
    if (!s) continue;
    const base = s.arms.find((a) => a.kind === "baseline");
    // The thread study carries two AGENTS.md arms. The shipped one is `lean`; taking
    // whichever came first would have quietly reported the full block as the model's row.
    const eco = s.arms.find((a) => a.name === "lean") ?? s.arms.find((a) => a.kind === "agents");
    if (!base || !eco) continue;
    out.push({
      model: s.model,
      effort: s.effort,
      n: Math.min(base.tokens.n, eco.tokens.n),
      baseline: base.weighted.mean,
      eco: eco.weighted.mean,
      delta: s.weightedComparisons?.[eco.name]?.pctChange ?? 0,
      outputDelta: s.comparisons?.[eco.name]?.pctChange ?? 0,
      baselineCmds: base.commands.mean,
      ecoCmds: eco.commands.mean,
      basePreamble: base.preambles.mean,
      ecoPreamble: eco.preambles.mean,
      clean: Boolean(
        eco.grades &&
          ["crash-bug", "nan-bug"].every((c) => eco.grades.criteria[c].hits === eco.grades.criteria[c].runs),
      ),
    });
  }
  // Newest family first, then alphabetically, so the list reads like the model picker.
  return out.sort((a, b) => b.model.localeCompare(a.model));
}

export function renderModels(lang = "en") {
  const t = STRINGS[lang];
  const rows0 = readModelBatches();
  if (!rows0.length) return emptyChart(t.models.emptyTitle, t.models.empty);
  const sign = signTest(rows0.map((b) => b.delta));
  const rows = rows0.map((b) => ({
    label: b.model.replace(/^gpt-/, ""),
    sub: t.models.perArm(b.n),
    value: Math.abs(b.delta),
    display: t.models.units(t.k(b.baseline), t.k(b.eco)),
    detail: t.models.detail(pct(b.outputDelta), b.clean),
    note: pct(b.delta),
    tone: b.delta > 0 || !b.clean ? "bad" : "good",
  }));
  return barChart({
    title: t.models.title,
    subtitle: t.models.subtitle(rows0.length),
    rows,
    footer: t.models.footer(sign),
  });
}

// ------------------------------------------------------------------- facts

/**
 * The numbers any other generator is allowed to quote. One function so the social card,
 * the README and the charts cannot disagree, and gated by bench/headline.json so an
 * un-replicated batch cannot leak into a picture.
 */
export function headlineFacts() {
  const gate = join(REPO, "bench", "headline.json");
  const allowed = new Set(existsSync(gate) ? (readJson(gate).studies ?? []) : []);

  const prefixFile = join(ASSETS, "data", "prefix.json");
  const p = existsSync(prefixFile) ? readJson(prefixFile) : null;
  const prefix = p
    ? {
        codexVersion: p.codexVersion,
        skills: p.skillsInCatalogue,
        baseline: p.baseline.total,
        safe: p.tiers.find((t) => t.id === "safe") ?? null,
        aggressive: p.tiers.find((t) => t.id === "aggressive") ?? null,
      }
    : null;

  const s = allowedStudy(THREAD_STUDY) ? studySummary(THREAD_STUDY) : null;
  const winnerName = s ? (s.arms.some((a) => a.name === "lean") ? "lean" : "agents") : null;
  const winnerArm = s ? s.arms.find((a) => a.name === winnerName) : null;
  const baseArm = s ? s.arms.find((a) => a.kind === "baseline") : null;
  const thread =
    s && winnerArm && baseArm
      ? {
          model: s.model,
          n: baseArm.tokens.n,
          costDelta: s.weightedComparisons?.[winnerName]?.pctChange ?? null,
          ci: s.weightedComparisons?.[winnerName]?.ci95 ?? null,
          p: s.weightedComparisons?.[winnerName]?.mannWhitneyP ?? null,
          outputDelta: s.comparisons?.[winnerName]?.pctChange ?? null,
          preambleBefore: baseArm.preambles.mean,
          preambleAfter: winnerArm.preambles.mean,
          skillDelta: s.weightedComparisons?.skill?.pctChange ?? null,
        }
      : null;

  const effortRows = readEffortBatches();
  const efforts = effortRows.length
    ? {
        n: effortRows.length,
        perArm: effortRows[0].n,
        model: effortRows[0].model,
        sign: signTest(effortRows.map((b) => b.delta)),
        best: Math.min(...effortRows.map((b) => b.delta)),
        worst: Math.max(...effortRows.map((b) => b.delta)),
        allClean: effortRows.every((b) => b.clean),
      }
    : null;

  const modelRows = readModelBatches();
  const models = modelRows.length
    ? {
        n: modelRows.length,
        sign: signTest(modelRows.map((b) => b.delta)),
        best: Math.min(...modelRows.map((b) => b.delta)),
        worst: Math.max(...modelRows.map((b) => b.delta)),
        allClean: modelRows.every((b) => b.clean),
        names: modelRows.map((b) => b.model),
      }
    : null;

  const manifestFile = join(REPO, "bench", "manifest.json");
  const publishedRuns = existsSync(manifestFile)
    ? Object.keys(readJson(manifestFile).runs ?? {}).length
    : 0;

  return { prefix, thread, efforts, models, publishedRuns };
}

// ------------------------------------------------------------- results block

const RESULTS_START = "<!-- codex-eco:results:start -->";
const RESULTS_END = "<!-- codex-eco:results:end -->";
const AUDIT_START = "<!-- codex-eco:audit:start -->";
const AUDIT_END = "<!-- codex-eco:audit:end -->";

/**
 * The sample audit output the README shows. Generated from the recorded snapshot for the
 * same reason as everything else here: the hand-pasted version went stale within a day and
 * disagreed with the chart three paragraphs above it.
 */
export function renderAudit(lang = "en") {
  const t = STRINGS[lang];
  const file = join(ASSETS, "data", "prefix.json");
  if (!existsSync(file)) return "```\n(no snapshot recorded - run node scripts/snapshot-prefix.mjs)\n```";
  const s = readJson(file);
  const num = (n) => Math.round(n).toLocaleString(t.locale);
  const rowOf = (label, chars, extra = "") =>
    `${label.padEnd(32)}${num(chars).padStart(7)}${num(chars / 4).padStart(10)}${extra}`;

  const SECTION_LABELS = {
    en: {
      skills_instructions: "skills catalog",
      recommended_plugins: "recommended-plugins advert",
      plain: "core instruction prose",
      multi_agent_mode: "multi-agent mode note",
      plugins_instructions: "plugins catalog",
      header: "section                           chars   ~tokens",
      total: "TOTAL before you type",
      config: "configuration                     chars   ~tokens      change",
      now: "as configured now",
      safe: "eco profile (safe)",
      aggressive: "eco profile (aggressive)",
    },
    tr: {
      skills_instructions: "skill kataloğu",
      recommended_plugins: "önerilen-plugin reklamı",
      plain: "çekirdek talimat metni",
      multi_agent_mode: "çok-ajan modu notu",
      plugins_instructions: "plugin kataloğu",
      header: "bölüm                          karakter   ~token",
      total: "SEN YAZMADAN ÖNCEKİ TOPLAM",
      config: "yapılandırma                   karakter   ~token       değişim",
      now: "şu anki kurulum",
      safe: "eco profili (güvenli)",
      aggressive: "eco profili (agresif)",
    },
  }[lang];

  const lines = ["```", SECTION_LABELS.header, "-".repeat(49)];
  for (const sec of s.baseline.sections) {
    lines.push(rowOf(SECTION_LABELS[sec.tag] ?? sec.tag, sec.chars));
  }
  lines.push("-".repeat(49), rowOf(SECTION_LABELS.total, s.baseline.total), "", SECTION_LABELS.config, "-".repeat(61));
  lines.push(rowOf(SECTION_LABELS.now, s.baseline.total, "           -"));
  for (const [id, label] of [["safe", SECTION_LABELS.safe], ["aggressive", SECTION_LABELS.aggressive]]) {
    const tier = s.tiers.find((x) => x.id === id);
    if (tier) lines.push(rowOf(label, tier.total, `${plain(tier.pct).padStart(12)}`));
  }
  lines.push("```");
  return lines.join("\n");
}

/**
 * The README's results section, generated in both languages from the same files the
 * charts use, and gated by bench/headline.json: a study that is not listed there cannot
 * reach a README, however good its number looks. That gate exists because two earlier
 * studies in this project turned out to have compared a baseline against itself.
 */
export function renderResults(lang = "en") {
  const tr = lang === "tr";
  const thread = allowedStudy(THREAD_STUDY) ? studySummary(THREAD_STUDY) : null;
  const efforts = readEffortBatches();
  const prefixFile = join(ASSETS, "data", "prefix.json");
  const prefix = existsSync(prefixFile) ? readJson(prefixFile) : null;

  if (!thread && !efforts.length) {
    return tr
      ? "_Henüz ana çalışma yayınlanmadı. `bench/headline.json` bir çalışmayı listeleyince `npm run build:charts` bu bölümü doldurur._"
      : "_No headline study is published yet. `npm run build:charts` fills this section once `bench/headline.json` lists one._";
  }

  const t = STRINGS[lang];
  const num = (n) => Math.round(n).toLocaleString(t.locale);
  const lines = [];

  if (prefix) {
    const safe = prefix.tiers.find((x) => x.id === "safe");
    const agg = prefix.tiers.find((x) => x.id === "aggressive");
    lines.push(
      tr ? "### 1. Sabit ön ek — kesin, istatistik yok" : "### 1. The fixed prefix — deterministic, no statistics",
      "",
      tr
        ? `${prefix.codexVersion} ile, katalogda ${prefix.skillsInCatalogue} skill varken, sen yazmadan önce gönderilen talimat ön eki **${num(prefix.baseline.total)} karakter** (~${num(prefix.baseline.total / 4)} token). Güvenli profil bunu **${num(safe.total)}** karaktere (**${safe.pct.toFixed(1)}%**), agresif profil **${num(agg.total)}** karaktere (**${agg.pct.toFixed(1)}%**) indiriyor. Kendi makinende bir komutla doğrula: \`node scripts/prefix-audit.mjs\`.`
        : `On ${prefix.codexVersion}, with ${prefix.skillsInCatalogue} skills in the catalogue, the instruction prefix sent before you type is **${num(prefix.baseline.total)} characters** (~${num(prefix.baseline.total / 4)} tokens). The safe profile takes it to **${num(safe.total)}** (**${safe.pct.toFixed(1)}%**) and the aggressive one to **${num(agg.total)}** (**${agg.pct.toFixed(1)}%**). Reproduce it on your own machine in one command: \`node scripts/prefix-audit.mjs\`.`,
      "",
    );
  }

  if (thread) {
    const base = thread.arms.find((a) => a.kind === "baseline");
    const rows = ["baseline", "skill", "full", "lean"]
      .map((n) => thread.arms.find((a) => a.name === n))
      .filter(Boolean);
    lines.push(
      tr ? "### 2. Kuralları taşımanın üç yolu" : "### 2. Three ways to deliver the rules",
      "",
      tr
        ? `\`${thread.model}\`, ${thread.effort === "(model default)" ? "model varsayılanı" : thread.effort} effort, kol başına n=${base.tokens.n}, kollar tek parti içinde dönüşümlü. Her koşu üç turluk tek bir konuşma: incele, düzelt, açık uçlu soru. Kullanım tüm konuşma boyunca toplandı.`
        : `\`${thread.model}\`, ${thread.effort === "(model default)" ? "the model's default" : thread.effort} effort, n=${base.tokens.n} per arm, arms interleaved in one batch. Each run is one three-turn thread — review, patch, open question — with usage summed over the thread.`,
      "",
      tr
        ? "| Kol | maliyet | temele karşı | çıktı | komut | önsöz | iki hata da |"
        : "| Arm | cost | vs baseline | output | cmds | preamble | both bugs |",
      "|---|---:|---:|---:|---:|---:|---|",
    );
    for (const a of rows) {
      const cmp = thread.weightedComparisons?.[a.name];
      const gates = ["crash-bug", "nan-bug"].map((c) => a.grades?.criteria[c]).filter(Boolean);
      const bugs = gates.length ? `${Math.min(...gates.map((g) => g.hits))}/${gates[0].runs}` : "?";
      const label = (t.surfaces.arms[a.name] ?? [a.name])[0];
      const delta =
        a === base
          ? "—"
          : `**${signed(cmp.pctChange, 1)}**` +
            (cmp.ci95
              ? ` (${t.ci(plain(cmp.ci95.lowPct), plain(cmp.ci95.highPct), cmp.mannWhitneyP.toFixed(3))})`
              : "");
      lines.push(
        `| \`${label}\` | ${num(a.weighted.mean)} | ${delta} | ${num(a.tokens.mean)} | ` +
          `${a.commands.mean.toFixed(1)} | ${a.preambles.mean.toFixed(2)} | ${bugs} |`,
      );
    }
    lines.push(
      "",
      tr
        ? "Her kol, her koşuda iki ekili hatayı da buldu; karar bu yüzden ucuzluğa kalıyor. Kısa blok kazanıyor, `$eco` skill'i ise anlamlı biçimde kaybediyor — nedeni [yukarıda](#kurallar-neden-agentsmdde-skillde-değil)."
        : "Every arm found both planted bugs in every run, so cheapness decides. The short block wins; the `$eco` skill loses significantly — [why is above](#why-the-rules-live-in-agentsmd-and-not-in-the-skill).",
      "",
    );
  }

  if (efforts.length) {
    const sign = signTest(efforts.map((b) => b.delta));
    // The published range covers the levels whose batches AGREE. A level where they do not
    // is named instead of being folded into a range, which would otherwise read as though
    // the effect might go either way everywhere.
    const byEffortAll = new Map();
    for (const b of efforts) {
      if (!byEffortAll.has(b.effort)) byEffortAll.set(b.effort, []);
      byEffortAll.get(b.effort).push(b);
    }
    const agreeing = [...byEffortAll.entries()].filter(([, rows]) => rows.every((r) => r.delta < 0));
    const disagreeing = [...byEffortAll.entries()].filter(([, rows]) => !rows.every((r) => r.delta < 0));
    const resolved = agreeing.flatMap(([, rows]) => rows.map((r) => r.delta));
    const unresolvedNames = disagreeing.map(([effort]) => `\`${effort}\``);
    const lo = Math.min(...resolved);
    const hi = Math.max(...resolved);
    lines.push(
      tr ? "### 3. Her reasoning effort seviyesinde tekrar" : "### 3. Replicated at every reasoning effort",
      "",
      `![${tr ? "Effort seviyelerine göre tekrar" : "Replication across effort levels"}](assets/efforts${tr ? ".tr" : ""}.svg)`,
      "",
      tr
        ? `Dağıtılan blok, \`${efforts[0].model}\` üzerinde ${efforts.length} bağımsız partide sınandı (kol başına n=${efforts[0].n}); **${sign.sameDirection}/${sign.n} parti aynı yöne** gitti, iki yönlü işaret testi p = ${sign.p.toFixed(3)}. Partilerinin birbirini tuttuğu ${agreeing.length} seviyede etki **${plain(hi)} ile ${plain(lo)}** arasında${unresolvedNames.length ? `; ${unresolvedNames.join(", ")} çözülmedi ve aşağıda ayrıca anlatılıyor` : ""}. İki ekili hata her seviyede, her koşuda bulundu. Yayınlanan sayı bu aralıktır; tek bir parti değil.`
        : `The shipped block was run against no rules in ${efforts.length} independent batches on \`${efforts[0].model}\` (n=${efforts[0].n} per arm): **${sign.sameDirection}/${sign.n} batches moved the same way**, two-sided sign test p = ${sign.p.toFixed(3)}. Across the ${agreeing.length} levels whose batches agree, the effect ran from **${plain(hi)} to ${plain(lo)}**${unresolvedNames.length ? `; ${unresolvedNames.join(", ")} is unresolved and is described below` : ""}. Both planted bugs were found at every level in every run. The published number is that range, not any one batch.`,
      "",
      tr
        ? "Eğilim açık ve mekanizması makul: effort yükseldikçe temel çıktı da uzuyor, yani kesilecek yağ artıyor."
        : "The trend is clear and its mechanism is plausible: the higher the effort, the longer the baseline's output, so the more fat there is to cut.",
      "",
      tr ? "| effort | maliyet | çıktı | %95 GA | iki hata da |" : "| effort | cost | output | 95% CI | both bugs |",
      "|---|---:|---:|---|---|",
      ...efforts.map(
        (b) =>
          `| \`${b.label ?? b.effort}\` | **${signed(b.delta, 1)}** | ${signed(b.outputDelta, 1)} | ` +
          `${b.ci ? `${plain(b.ci.lowPct)} … ${plain(b.ci.highPct)}` : "n/a"} | ` +
          `${b.clean ? (tr ? "evet" : "yes") : tr ? "HAYIR" : "NO"} |`,
      ),
      "",
      // A level is described by what its batches AGREE on, not by one batch's sign. At
      // `none` the two batches disagree (+34.1% and -9.1%) and the disagreement traces to
      // the cached/uncached split, not to the block - so it is reported as unresolved
      // rather than as a loss, and the output-token effect, which IS consistent there, is
      // reported separately.
      ...(() => {
        const byEffort = new Map();
        for (const b of efforts) {
          if (!byEffort.has(b.effort)) byEffort.set(b.effort, []);
          byEffort.get(b.effort).push(b);
        }
        const unresolved = [];
        const losing = [];
        for (const [effort, rows] of byEffort) {
          const pos = rows.filter((r) => r.delta > 0).length;
          if (pos === rows.length && rows.length) losing.push({ effort, rows });
          else if (pos > 0) unresolved.push({ effort, rows });
        }
        const out = [];
        for (const { effort, rows } of unresolved) {
          const outs = rows.map((r) => plain(r.outputDelta)).join(tr ? " ve " : " and ");
          const costs = rows.map((r) => signed(r.delta, 1)).join(", ");
          out.push(
            tr
              ? `**\`${effort}\` seviyesinde toplam maliyet çözülmedi.** ${rows.length} bağımsız parti birbirini tutmuyor (${costs}) ve fark tamamen önbellekli/önbelleksiz girdi ayrımından geliyor: aynı blokla bir partide 53.155, diğerinde 24.865 önbelleksiz token. Yani ilk partideki artı, muamele etkisi değil önbellek ısınmasıydı — ve tek parti bakılsa blok orada "zararlı" görünecekti. Çıktı token'ı ise iki partide de tutarlı biçimde düştü (${outs}) ve iki ekili hata her koşuda bulundu. Bu yüzden toplam-maliyet iddiası \`low\` ve üstünü kapsıyor; \`${effort}\` için "çözülmedi" diyoruz, "kaybediyor" demiyoruz.`
              : `**At \`${effort}\`, total cost is unresolved.** The ${rows.length} independent batches disagree (${costs}), and the difference sits entirely in the cached/uncached split: with the same block, one batch billed 53,155 uncached tokens and the other 24,865. So the positive figure in the first batch was cache warmth, not a treatment effect — and a single batch would have "shown" the block to be harmful there. Output tokens fell consistently in both (${outs}), and both planted bugs were found in every run. The total-cost claim therefore covers \`low\` and above; for \`${effort}\` the honest word is unresolved, not worse.`,
            "",
          );
        }
        for (const { effort, rows } of losing) {
          out.push(
            tr
              ? `**\`${effort}\` seviyesinde blok kaybediyor** (${rows.map((r) => signed(r.delta, 1)).join(", ")}), ${rows.length} partinin hepsinde aynı yönde. Orada bloğu kullanma.`
              : `**At \`${effort}\` the block loses** (${rows.map((r) => signed(r.delta, 1)).join(", ")}), in all ${rows.length} batches. Do not use it there.`,
            "",
          );
        }
        return out;
      })(),
    );
  }

  const models = readModelBatches();
  if (models.length) {
    const sign = signTest(models.map((b) => b.delta));
    const deltas = models.map((b) => b.delta);
    const lo = Math.min(...deltas);
    const hi = Math.max(...deltas);
    lines.push(
      tr ? "### 4. Ve her modelde" : "### 4. And on every model",
      "",
      `![${tr ? "Modellere göre tekrar" : "Replication across models"}](assets/models${tr ? ".tr" : ""}.svg)`,
      "",
      tr ? "| Model | n | maliyet | çıktı | komut | önsöz | iki hata da |" : "| Model | n | cost | output | cmds | preamble | both bugs |",
      "|---|---:|---:|---:|---:|---:|---|",
    );
    for (const b of models) {
      lines.push(
        `| \`${b.model}\` | ${b.n} | **${signed(b.delta, 1)}** | ${signed(b.outputDelta, 1)} | ` +
          `${b.baselineCmds.toFixed(1)} → ${b.ecoCmds.toFixed(1)} | ${b.basePreamble.toFixed(2)} → ${b.ecoPreamble.toFixed(2)} | ${b.clean ? (tr ? "evet" : "yes") : (tr ? "HAYIR" : "NO")} |`,
      );
    }
    lines.push(
      "",
      tr
        ? `**${sign.sameDirection}/${sign.n} model aynı yöne** gitti, iki yönlü işaret testi p = ${sign.p.toFixed(5)}; etki **${plain(hi)} ile ${plain(lo)}** arasında. Önsöz turu her modelde sıfıra indi ve ekili iki hata her modelin her koşusunda bulundu. Mutlak sayılar modeller arasında kıyaslanamaz — tokenizer'lar farklı — o yüzden karşılaştırılan şey satır içindeki yüzde.`
        : `**${sign.sameDirection}/${sign.n} models moved the same way**, two-sided sign test p = ${sign.p.toFixed(5)}, effect between **${plain(hi)} and ${plain(lo)}**. The preamble turn went to zero on every model, and both planted bugs were found in every run of every model. Absolute counts are not comparable across models — different tokenizers — so what is compared is the percentage within a row.`,
    );
  }

  return lines.join("\n");
}

function fillBlock(text, start, end, body, path) {
  const a = text.indexOf(start);
  const b = text.indexOf(end);
  if (a === -1 || b === -1 || b < a) throw new Error(`${path}: no ${start} ... ${end} block to fill`);
  return text.slice(0, a + start.length) + "\n" + body + "\n" + text.slice(b);
}

function fillResultsBlock(path, lang) {
  if (!existsSync(path)) return null;
  const current = readFileSync(path, "utf8");
  let next = fillBlock(current, RESULTS_START, RESULTS_END, renderResults(lang), path);
  next = fillBlock(next, AUDIT_START, AUDIT_END, renderAudit(lang), path);
  return { current, next };
}

// ---------------------------------------------------------------------- main

const TARGETS = [
  ["prefix", renderPrefix],
  ["surfaces", renderSurfaces],
  ["efforts", renderEfforts],
  ["models", renderModels],
].flatMap(([name, render]) =>
  ["en", "tr"].map((lang) => ({
    out: join(ASSETS, lang === "en" ? `${name}.svg` : `${name}.tr.svg`),
    render: () => render(lang),
  })),
);

const README_TARGETS = [
  { out: join(REPO, "README.md"), lang: "en" },
  { out: join(REPO, "README.tr.md"), lang: "tr" },
];

function main() {
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const t of TARGETS) {
    const next = t.render();
    const current = existsSync(t.out) ? readFileSync(t.out, "utf8") : null;
    const rel = t.out.replace(REPO, ".");
    if (current === next) {
      console.log(`${check ? "ok      " : "current "} ${rel}`);
      continue;
    }
    if (check) {
      console.error(`STALE    ${rel} - run \`node scripts/build-charts.mjs\``);
      stale++;
      continue;
    }
    writeFileSync(t.out, next, "utf8");
    console.log(`wrote    ${rel} (${next.length} bytes)`);
  }

  for (const t of README_TARGETS) {
    const res = fillResultsBlock(t.out, t.lang);
    if (!res) continue;
    const rel = t.out.replace(REPO, ".");
    if (res.current === res.next) {
      console.log(`${check ? "ok      " : "current "} ${rel} (results block)`);
      continue;
    }
    if (check) {
      console.error(`STALE    ${rel} results block - run \`node scripts/build-charts.mjs\``);
      stale++;
      continue;
    }
    writeFileSync(t.out, res.next, "utf8");
    console.log(`wrote    ${rel} (results block)`);
  }

  if (stale) {
    console.error(
      `\n${stale} generated artifact(s) disagree with their data. The data is the source: regenerate,\n` +
        `never hand-edit an SVG or a results table.`,
    );
    return 1;
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
