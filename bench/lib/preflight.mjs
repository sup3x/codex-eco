// Check the experiment before spending anything on it.
//
// This exists because of a defect it would have caught. Codex resolves standalone
// skills from three roots - the project's `.agents/skills`, `$HOME/.agents/skills`,
// and a machine-wide one - and it lists ALL of them in the catalogue it publishes to
// the model. An older copy of `eco` left in the home root therefore appeared next to
// the staged copy under test, with a different description, under the SAME name. Every
// batch this project ran was measuring an ambiguous `$eco`, and the read-rate split it
// produced (10/10 reads in some batches, 1/20 in others) was read as a model quirk for
// far too long.
//
// `codex debug prompt-input` renders the exact model-visible input list offline and for
// free, so the check costs nothing: render the prompt the batch is about to send, and
// refuse to run if a staged skill name is not unique.
import { execFileSync } from "node:child_process";

const CATALOGUE_ENTRY = /^- ([A-Za-z0-9:_-]+):[\s\S]*?\(file: ([^)]+)\)/gm;

/** Render the model-visible prompt for a workspace. Returns null if Codex cannot. */
export function renderPrompt({ cwd, codexHome, prompt = "hi", bin = "codex" }) {
  try {
    const stdout = execFileSync(bin, ["debug", "prompt-input", prompt], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, ...(codexHome ? { CODEX_HOME: codexHome } : {}), MSYS_NO_PATHCONV: "1" },
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 32 * 1024 * 1024,
    });
    // A CODEX_HOME under a temp dir makes Codex print a warning before the JSON.
    const first = stdout.indexOf("[");
    const brace = stdout.indexOf("{");
    const at = first === -1 ? brace : brace === -1 ? first : Math.min(first, brace);
    if (at === -1) return null;
    return JSON.parse(stdout.slice(at));
  } catch {
    return null;
  }
}

export function promptText(rendered) {
  const items = Array.isArray(rendered) ? rendered : (rendered?.input ?? rendered?.items ?? []);
  return items
    .map((it) => (it.content ?? []).map((c) => c.text ?? "").join("") || it.text || "")
    .join("\n");
}

/** Every skill Codex would publish to the model, as {name, file} rows. */
export function catalogue(rendered) {
  const rows = [];
  for (const m of promptText(rendered).matchAll(CATALOGUE_ENTRY)) rows.push({ name: m[1], file: m[2] });
  return rows;
}

/**
 * Names that appear more than once. A duplicate is both a correctness problem for an
 * experiment and pure waste for a user, since each copy's description is billed.
 */
export function duplicateSkills(rows) {
  const byName = new Map();
  for (const r of rows) {
    if (!byName.has(r.name)) byName.set(r.name, []);
    byName.get(r.name).push(r.file);
  }
  return [...byName.entries()].filter(([, files]) => files.length > 1).map(([name, files]) => ({ name, files }));
}

/**
 * Refuse an ambiguous batch. `expected` are the skill names the batch staged; each must
 * resolve to exactly one file, and that file must be inside the staged workspace.
 */
export function checkSkillResolution({ cwd, codexHome, expected = [], bin = "codex" }) {
  const rendered = renderPrompt({ cwd, codexHome, prompt: "hi", bin });
  if (!rendered) return { ok: true, skipped: "codex debug prompt-input produced nothing parseable", rows: [] };
  const rows = catalogue(rendered);
  if (!rows.length) return { ok: true, skipped: "no skills catalogue in the rendered prompt", rows };

  const problems = [];
  const normalise = (p) => String(p).replace(/\\/g, "/").toLowerCase();
  const here = normalise(cwd);
  for (const name of expected) {
    const matches = rows.filter((r) => r.name === name);
    if (!matches.length) {
      problems.push(`skill "${name}" was staged but Codex does not list it - the arm would measure nothing`);
      continue;
    }
    if (matches.length > 1) {
      problems.push(
        `skill "${name}" resolves to ${matches.length} files, so "$${name}" is ambiguous:\n` +
          matches.map((m) => `      ${m.file}`).join("\n") +
          `\n      remove the copies outside the workspace (./install.sh --uninstall clears the ones this project installs)`,
      );
      continue;
    }
    if (!normalise(matches[0].file).startsWith(here)) {
      problems.push(
        `skill "${name}" resolves to ${matches[0].file}, which is outside the staged workspace - ` +
          `the batch would measure a body it did not stage`,
      );
    }
  }
  return { ok: problems.length === 0, problems, rows, duplicates: duplicateSkills(rows) };
}
