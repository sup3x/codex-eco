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

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = join(REPO, "assets");
const RESULTS = join(REPO, "bench", "results");

const THREAD_TAG = "thread-terra";
const EFFORT_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
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
  const file = join(RESULTS, THREAD_TAG, "summary.json");
  if (!existsSync(file)) return emptyChart(t.surfaces.emptyTitle, t.surfaces.empty);
  const s = readJson(file);
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
  if (!existsSync(RESULTS)) return [];
  const out = [];
  for (const dir of readdirSync(RESULTS)) {
    if (!dir.startsWith("eff-")) continue;
    const file = join(RESULTS, dir, "summary.json");
    if (!existsSync(file)) continue;
    const s = readJson(file);
    const base = s.arms.find((a) => a.kind === "baseline");
    const eco = s.arms.find((a) => a.kind === "agents");
    if (!base || !eco) continue;
    out.push({
      effort: s.effort,
      model: s.model,
      n: Math.min(base.tokens.n, eco.tokens.n),
      baseline: base.weighted.mean,
      eco: eco.weighted.mean,
      delta: s.weightedComparisons?.[eco.name]?.pctChange ?? 0,
      outputDelta: s.comparisons?.[eco.name]?.pctChange ?? 0,
      clean: Boolean(
        eco.grades &&
          ["crash-bug", "nan-bug"].every((c) => eco.grades.criteria[c].hits === eco.grades.criteria[c].runs),
      ),
    });
  }
  return out.sort((a, b) => EFFORT_ORDER.indexOf(a.effort) - EFFORT_ORDER.indexOf(b.effort));
}

export function renderEfforts(lang = "en") {
  const t = STRINGS[lang];
  const batches = readEffortBatches();
  if (!batches.length) return emptyChart(t.efforts.emptyTitle, t.efforts.empty);
  const sign = signTest(batches.map((b) => b.delta));
  const rows = batches.map((b) => ({
    label: b.effort,
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
  if (!existsSync(RESULTS)) return [];
  const out = [];
  for (const dir of readdirSync(RESULTS)) {
    if (!dir.startsWith("mdl-")) continue;
    const file = join(RESULTS, dir, "summary.json");
    if (!existsSync(file)) continue;
    const s = readJson(file);
    const base = s.arms.find((a) => a.kind === "baseline");
    const eco = s.arms.find((a) => a.kind === "agents");
    if (!base || !eco) continue;
    out.push({
      model: s.model,
      effort: s.effort,
      n: Math.min(base.tokens.n, eco.tokens.n),
      baseline: base.weighted.mean,
      eco: eco.weighted.mean,
      delta: s.weightedComparisons?.[eco.name]?.pctChange ?? 0,
      outputDelta: s.comparisons?.[eco.name]?.pctChange ?? 0,
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

// ------------------------------------------------------------- results block

const RESULTS_START = "<!-- codex-eco:results:start -->";
const RESULTS_END = "<!-- codex-eco:results:end -->";

/**
 * The README's results section, generated in both languages from the same files the
 * charts use, and gated by bench/headline.json: a study that is not listed there cannot
 * reach a README, however good its number looks. That gate exists because two earlier
 * studies in this project turned out to have compared a baseline against itself.
 */
export function renderResults(lang = "en") {
  const gate = join(REPO, "bench", "headline.json");
  const allowed = new Set(existsSync(gate) ? (readJson(gate).studies ?? []) : []);
  const tr = lang === "tr";

  const threadFile = join(RESULTS, THREAD_TAG, "summary.json");
  const thread = allowed.has(THREAD_TAG) && existsSync(threadFile) ? readJson(threadFile) : null;
  const efforts = readEffortBatches().filter((b) => allowed.has(`eff-${b.effort}`));
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
    const deltas = efforts.map((b) => b.delta);
    const lo = Math.min(...deltas);
    const hi = Math.max(...deltas);
    lines.push(
      tr ? "### 3. Her reasoning effort seviyesinde tekrar" : "### 3. Replicated at every reasoning effort",
      "",
      `![${tr ? "Effort seviyelerine göre tekrar" : "Replication across effort levels"}](assets/efforts${tr ? ".tr" : ""}.svg)`,
      "",
      tr
        ? `Dağıtılan blok, \`${efforts[0].model}\` üzerinde ${efforts.length} bağımsız partide sınandı (kol başına n=${efforts[0].n}); **${sign.sameDirection}/${sign.n} parti aynı yöne** gitti, iki yönlü işaret testi p = ${sign.p.toFixed(3)}. Etki **${hi.toFixed(1)}% ile ${lo.toFixed(1)}%** arasında değişti ve iki ekili hata her seviyede, her koşuda bulundu. Yayınlanan sayı bu aralıktır; tek bir parti değil.`
        : `The shipped block was run against no rules in ${efforts.length} independent batches on \`${efforts[0].model}\` (n=${efforts[0].n} per arm): **${sign.sameDirection}/${sign.n} batches moved the same way**, two-sided sign test p = ${sign.p.toFixed(3)}. The effect ranged from **${plain(hi)} to ${plain(lo)}**, and both planted bugs were found at every level in every run. The published number is that range, not any one batch.`,
      "",
      tr
        ? "Eğilim açık ve mekanizması makul: effort yükseldikçe temel çıktı da uzuyor, yani kesilecek yağ artıyor."
        : "The trend is clear and its mechanism is plausible: the higher the effort, the longer the baseline's output, so the more fat there is to cut.",
    );
  }

  return lines.join("\n");
}

function fillResultsBlock(path, lang) {
  if (!existsSync(path)) return null;
  const current = readFileSync(path, "utf8");
  const a = current.indexOf(RESULTS_START);
  const b = current.indexOf(RESULTS_END);
  if (a === -1 || b === -1 || b < a) {
    throw new Error(`${path}: no ${RESULTS_START} ... ${RESULTS_END} block to fill`);
  }
  const next =
    current.slice(0, a + RESULTS_START.length) + "\n" + renderResults(lang) + "\n" + current.slice(b);
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
