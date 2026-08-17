// A horizontal bar chart, in SVG, with no dependencies and no external fetches.
//
// GitHub renders SVG in a README but blocks CSS from outside the file and gives no
// reliable theme signal, so every colour is inline and the card paints its own dark
// background instead of borrowing the page's.
//
// The layout is fixed columns - label | bar | value | delta - rather than "text after
// the bar", because the first version placed the value at the end of the bar and the
// longest bar's value ran off the canvas while the delta printed on top of it. Fixed
// columns cannot collide, and `fits()` says out loud when a string is too long for the
// column it was given instead of silently overflowing.
//
// Every chart built with this must be generated from recorded data. A chart is the most
// quotable thing in a repository and the easiest place for a number nobody measured to
// end up, so the generator is the only writer and CI re-runs it with `--check`.

export const PALETTE = {
  bg: "#0b111c",
  ink: "#e8ecf3",
  dim: "#8e99ac",
  faint: "#3f4a5f",
  good: "#34d399",
  bad: "#f87171",
  neutral: "#60a5fa",
};

const FONT = "Segoe UI, -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif";
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Segoe UI at these sizes averages ~0.53em per character for this kind of mixed
// alphanumeric text. Only used to warn about overflow, never to position anything.
const widthOf = (s, size) => String(s).length * size * 0.53;

const text = (x, y, s, { size = 13, weight = 400, fill = PALETTE.dim, anchor = "start" } = {}) =>
  `<text x="${x}" y="${y}"${anchor === "start" ? "" : ` text-anchor="${anchor}"`} font-family="${FONT}" ` +
  `font-size="${size}" ${weight === 400 ? "" : `font-weight="${weight}" `}fill="${fill}">${esc(s)}</text>`;

const TONES = { good: PALETTE.good, bad: PALETTE.bad, neutral: PALETTE.neutral, base: PALETTE.faint };

/**
 * @param {object} spec
 * @param {string} spec.title
 * @param {string} [spec.subtitle]
 * @param {Array<{label:string, sub?:string, value:number, display:string, detail?:string, note?:string, tone?:string}>} spec.rows
 * @param {string[]} [spec.footer]
 * @param {number} [spec.width]
 * @param {number} [spec.labelW]
 * @param {number} [spec.valueW]
 */
export function barChart({ title, subtitle, rows, footer = [], width = 900, labelW = 168, valueW = 262 }) {
  const rowH = 46;
  const padTop = subtitle ? 86 : 62;
  const padBottom = 26 + footer.length * 18;
  const noteW = 78;
  const barX = labelW + 20;
  const barW = width - barX - valueW - noteW - 28;
  if (barW < 80) throw new Error(`chart "${title}": no room for bars (barW=${barW}) - widen it or shorten the columns`);
  const height = padTop + rows.length * rowH + padBottom;
  const max = Math.max(...rows.map((r) => r.value), 1);
  const valueX = barX + barW + 14;

  const overflow = [];
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ` +
      `role="img" aria-label="${esc(title)}">`,
    `<title>${esc(title)}</title>`,
    `<rect width="${width}" height="${height}" rx="14" fill="${PALETTE.bg}"/>`,
    text(28, 34, title, { size: 18, weight: 700, fill: PALETTE.ink }),
  ];
  if (subtitle) parts.push(text(28, 58, subtitle, { size: 12.5 }));

  rows.forEach((r, i) => {
    const y = padTop + i * rowH;
    const w = Math.max(3, (r.value / max) * barW);
    const fill = TONES[r.tone] ?? PALETTE.faint;
    parts.push(text(labelW, y + 15, r.label, { size: 14, weight: 600, fill: PALETTE.ink, anchor: "end" }));
    if (r.sub) parts.push(text(labelW, y + 31, r.sub, { size: 11, anchor: "end" }));
    parts.push(`<rect x="${barX}" y="${y + 3}" width="${w.toFixed(1)}" height="17" rx="5" fill="${fill}"/>`);
    parts.push(text(valueX, y + 14, r.display, { size: 12.5, fill: PALETTE.ink }));
    if (r.detail) parts.push(text(valueX, y + 30, r.detail, { size: 11 }));
    if (r.note) {
      parts.push(
        text(width - 24, y + 20, r.note, {
          size: 18,
          weight: 700,
          anchor: "end",
          fill: r.tone === "bad" ? PALETTE.bad : r.tone === "good" ? PALETTE.good : PALETTE.dim,
        }),
      );
    }
    if (widthOf(r.display, 12.5) > valueW) overflow.push(`display "${r.display}"`);
    if (r.detail && widthOf(r.detail, 11) > valueW) overflow.push(`detail "${r.detail}"`);
    if (widthOf(r.label, 14) > labelW) overflow.push(`label "${r.label}"`);
  });

  footer.forEach((line, i) => {
    parts.push(text(28, padTop + rows.length * rowH + 16 + i * 18, line, { size: 12 }));
    if (widthOf(line, 12) > width - 56) overflow.push(`footer "${line.slice(0, 40)}..."`);
  });
  parts.push("</svg>", "");

  if (overflow.length) {
    throw new Error(
      `chart "${title}": ${overflow.length} string(s) do not fit their column and would be clipped:\n  ` +
        overflow.join("\n  ") +
        `\n  shorten them, or pass a larger valueW/width.`,
    );
  }
  return parts.join("\n");
}

/** A "nothing measured yet" placeholder, so an empty chart still says why. */
export function emptyChart(title, lines, width = 900) {
  const height = 60 + lines.length * 22 + 18;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ` +
      `role="img" aria-label="${esc(title)}">`,
    `<rect width="${width}" height="${height}" rx="14" fill="${PALETTE.bg}"/>`,
    text(28, 40, title, { size: 18, weight: 700, fill: PALETTE.ink }),
    ...lines.map((l, i) => text(28, 68 + i * 22, l, { size: 13 })),
    "</svg>",
    "",
  ].join("\n");
}
