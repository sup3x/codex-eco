// Renders the README results table from published runs, in both languages.
//
// Kept in its own module because the English and Turkish READMEs must never
// disagree: they are filled from the same data, in the same pass, by the same
// code. A translated table that drifts from its source is worse than no
// translation.
import { existsSync, readFileSync } from "node:fs";

export const RESULT_MARKERS = {
  start: "<!-- codex-eco:results:start -->",
  end: "<!-- codex-eco:results:end -->",
};

const TEXT = {
  en: {
    empty:
      "_No headline study has been published yet. `node scripts/build-assets.mjs` fills this section from `bench/manifest.json` once runs are published._",
    head: ["Model", "Baseline", "With eco", "Output tokens", "n per arm"],
    caption:
      "Same task, same fixture, same day; arms interleaved in one batch with the arm order rotated. " +
      "Output tokens are what the provider reported in `turn.completed.usage`. Absolute counts are not " +
      "comparable across models - only the percentage within a row is. Generated from " +
      "`bench/manifest.json` by `scripts/build-assets.mjs`; CI fails if this table and the data disagree.",
  },
  tr: {
    empty:
      "_Henüz yayınlanmış bir ana çalışma yok. Çalıştırmalar yayınlandığında `node scripts/build-assets.mjs` bu bölümü `bench/manifest.json`'dan doldurur._",
    head: ["Model", "Baseline", "eco ile", "Çıktı token", "kol başına n"],
    caption:
      "Aynı görev, aynı fixture, aynı gün; kollar tek batch içinde ve dönüşümlü sırayla çalıştırıldı. " +
      "Çıktı token'ları sağlayıcının `turn.completed.usage` alanından geliyor. Mutlak sayılar modeller " +
      "arasında karşılaştırılamaz - yalnızca satır içindeki yüzde anlamlıdır. `bench/manifest.json`'dan " +
      "`scripts/build-assets.mjs` üretir; tablo veriyle çelişirse CI kırmızıya döner.",
  },
};

export function renderResults(data, lang = "en") {
  const t = TEXT[lang] ?? TEXT.en;
  if (!data.models.length) return t.empty;
  const rows = data.models.map((m) => {
    const pct = `${m.delta <= 0 ? "&minus;" : "+"}${Math.abs(m.delta).toFixed(1)}%`;
    const cell = m.delta <= 0 ? `**${pct}**` : pct;
    return `| \`${m.model}\` | ${Math.round(m.baseline)} | ${Math.round(m.eco)} | ${cell} | ${m.n} |`;
  });
  return [`| ${t.head.join(" | ")} |`, "|---|---:|---:|---:|---:|", ...rows, "", t.caption].join("\n");
}

/** Returns {file, content} with the marked block replaced, or null if not applicable. */
export function fillReadme(file, lang, table) {
  if (!existsSync(file)) return null;
  const current = readFileSync(file, "utf8");
  const a = current.indexOf(RESULT_MARKERS.start);
  const b = current.indexOf(RESULT_MARKERS.end);
  if (a === -1 || b === -1) return null;
  const content = `${current.slice(0, a + RESULT_MARKERS.start.length)}\n${table}\n${current.slice(b)}`;
  return { file, content };
}
