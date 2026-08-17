#!/usr/bin/env node
// codex-eco benchmark driver.
//
//   node bench/bench.mjs ab --task "your task here"
//   node bench/bench.mjs study review --n 5 --model gpt-5.6-terra
//   node bench/bench.mjs matrix review --models gpt-5.6-terra,gpt-5.6-luna --n 5
//   node bench/bench.mjs list
//   node bench/bench.mjs grade orders-review bench/raw/<id>.json
//
// The rules this obeys are inherited from the sibling project, where each one
// was learned from a defect:
//   * argv arrays, never shell strings;
//   * every run's event stream is written to disk before it is parsed;
//   * a run that errored, failed its turn, or hit a dead sandbox is reported as
//     broken rather than scored;
//   * arm order rotates across repetitions so cache warmth cannot favour one arm;
//   * quality is graded next to tokens, because tokens alone reward silence.
//
// Codex-specific: reasoning tokens are reported separately from output tokens,
// preamble messages before the first command are counted as their own metric,
// and no dollar figure is ever printed - the event stream contains no cost.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_DIR, BENCH_DIR, RAW_DIR, readJson, writeJson, writeTextFile } from "./lib/io.mjs";
import { compareArms, describe, fmtNum, fmtPct } from "./lib/stats.mjs";
import { gradeAnswer, summarizeGrades, rubricIds, RUBRICS } from "./lib/grade.mjs";
import {
  runArm,
  validateRun,
  summarizeRun,
  parseEvents,
  mergeTurns,
  codexVersion,
  stageWorkspace,
  digestFile,
  RunError,
} from "./lib/codex.mjs";
import { textTable, comparisonLines } from "./lib/report.mjs";
import { checkSkillResolution } from "./lib/preflight.mjs";
import { COST_WEIGHTS, weightedCost, uncachedInput } from "./lib/cost.mjs";

const STUDIES_FILE = join(BENCH_DIR, "studies.json");
const RESULTS_DIR = join(BENCH_DIR, "results");
const MANIFEST_FILE = join(BENCH_DIR, "manifest.json");
const FIXTURES_DIR = join(BENCH_DIR, "fixtures");
const SKILLS_DIR = join(REPO_DIR, "plugins", "eco", "skills");

const USAGE = `codex-eco benchmark driver

Usage
  node bench/bench.mjs ab --task "<task>" [options]
  node bench/bench.mjs study <id> [options]
  node bench/bench.mjs matrix <id> --models a,b,c [options]
  node bench/bench.mjs list
  node bench/bench.mjs grade <rubric> <file...>
  node bench/bench.mjs publish <tag> --study <study-id> [--force]

Options
  --task <text>        task prompt (required for ab)
  --skill <name>       skill invoked by the treatment arm            (default: eco)
  --skill-dir <path>   stage this skill directory into the workspace, so the run
                       measures the checked-out body and not ~/.agents/skills
  --variants a=dir,b=dir
                       one treatment arm per skill directory, interleaved in one batch
  --agents-file <path> add an arm that writes this file as the workspace AGENTS.md and
                       sends the task with no skill invocation. Codex loads AGENTS.md into
                       the prompt itself, so this arm carries the rules WITHOUT the shell
                       round trip a skill body costs - which is the comparison that matters.
  --fixture <name>     fixture directory under bench/fixtures         (default: orders)
  --arms <list>        comma-separated arm names to run             (default: all)
  --n <int>            repetitions per arm                              (default: 1)
  --model <name>       codex --model                            (default: config default)
  --models <list>      matrix only: one batch per model, run sequentially
  --effort <level>     -c model_reasoning_effort=...            (default: model default)
  --verbosity <level>  -c model_verbosity=...                   (default: model default)
  --codex-home <path>  CODEX_HOME for isolation from your own setup
  --rubric <id>        grade every run with this rubric (see: list)
  --tag <name>         output directory under bench/results
  --timeout <seconds>  per-run timeout                                (default: 900)
  --no-rotate          keep a fixed arm order
  --keep-workspace     leave the staged workspace on disk
  --dry-run            print the plan and exit without spending anything
`;

const BOOL_FLAGS = ["no-rotate", "keep-workspace", "dry-run", "force", "help"];

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      opts._.push(a);
      continue;
    }
    const key = a.slice(2);
    if (BOOL_FLAGS.includes(key)) {
      opts[key] = true;
      continue;
    }
    const value = argv[++i];
    if (value === undefined) throw new Error(`missing value for --${key}`);
    opts[key] = value;
  }
  return opts;
}

function intOpt(opts, key, fallback) {
  if (opts[key] === undefined) return fallback;
  const n = Number(opts[key]);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`--${key} must be a positive integer (got ${opts[key]})`);
  return n;
}

const loadStudies = () => (existsSync(STUDIES_FILE) ? readJson(STUDIES_FILE) : {});
const timestamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const slug = (t) =>
  String(t)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function buildPlan(opts, study) {
  const cfg = { ...(study ?? {}) };
  const pick = (key, fallback) => (opts[key] !== undefined ? opts[key] : (cfg[key] ?? fallback));

  const task = pick("task");
  if (!task) throw new Error('a task is required: --task "..." (or a study that defines one)');

  const fixture = pick("fixture", "orders");
  const fixtureDir = join(FIXTURES_DIR, fixture);
  if (!existsSync(fixtureDir)) throw new Error(`no fixture directory at ${fixtureDir}`);

  const rubric = pick("rubric", null);
  if (rubric && !RUBRICS[rubric]) throw new Error(`unknown rubric "${rubric}" (have: ${rubricIds().join(", ")})`);

  const arms = [];
  const variantSpec = pick("variants", null);
  if (variantSpec) {
    for (const part of String(variantSpec).split(",")) {
      const [label, dir] = part.split("=");
      if (!label || !dir) throw new Error(`--variants expects label=path pairs, got "${part}"`);
      const dirPath = resolve(REPO_DIR, dir);
      if (!existsSync(join(dirPath, "SKILL.md"))) throw new Error(`no SKILL.md in ${dirPath}`);
      arms.push({ name: slug(label), kind: "skill", skill: `eco-${slug(label)}`, skillDir: dirPath });
    }
  } else {
    const name = pick("skill", "eco");
    const dir = pick("skill-dir", join(SKILLS_DIR, name));
    arms.push({
      name: "skill",
      kind: "skill",
      skill: name,
      skillDir: existsSync(join(resolve(REPO_DIR, dir), "SKILL.md")) ? resolve(REPO_DIR, dir) : null,
    });
  }
  // `--agents-file path` gives one arm named "agents"; `--agents-file a=path,b=path`
  // gives one arm per block, so two block SIZES can be compared inside a single batch
  // instead of across batches, where the noise is larger than the effect.
  const agentsSpec = pick("agents-file", null);
  if (agentsSpec) {
    for (const part of String(agentsSpec).split(",")) {
      const hasLabel = part.includes("=");
      const label = hasLabel ? part.slice(0, part.indexOf("=")) : "agents";
      const rel = hasLabel ? part.slice(part.indexOf("=") + 1) : part;
      const p = resolve(REPO_DIR, rel);
      if (!existsSync(p)) throw new Error(`no such AGENTS.md source: ${p}`);
      arms.push({ name: slug(label), kind: "agents", skill: null, skillDir: null, agentsFile: p });
    }
  }
  arms.unshift({ name: "baseline", kind: "baseline", skill: null, skillDir: null });

  const requested = opts.arms ?? cfg.armFilter;
  let selected = arms;
  if (requested) {
    const names = String(requested)
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    for (const n of names) {
      if (!arms.some((a) => a.name === n)) {
        throw new Error(`unknown arm "${n}" (have: ${arms.map((a) => a.name).join(", ")})`);
      }
    }
    selected = arms.filter((a) => names.includes(a.name));
  }

  // A study may define `turns` - a list of prompts sent down ONE thread. `task` stays
  // the first turn so every existing study and every recorded batch keeps its meaning.
  const extraTurns = cfg.turns ?? null;
  const turns = [task, ...(Array.isArray(extraTurns) ? extraTurns : [])];

  return {
    task,
    turns,
    fixture,
    fixtureDir,
    rubric: rubric ?? null,
    arms: selected,
    agentsSpec: agentsSpec ?? null,
    n: intOpt(opts, "n", cfg.n ?? 1),
    model: pick("model", null),
    effort: pick("effort", null),
    verbosity: pick("verbosity", null),
    codexHome: pick("codex-home", process.env.CODEX_ECO_BENCH_HOME ?? null),
    timeoutMs: intOpt(opts, "timeout", cfg.timeout ?? 900) * 1000,
    rotate: !opts["no-rotate"],
    keepWorkspace: Boolean(opts["keep-workspace"]),
    tag: pick("tag", `${cfg.id ?? "ab"}-${slug(pick("model", "default"))}-${timestamp()}`),
  };
}

const promptFor = (plan, arm, text = plan.task) => (arm.kind === "skill" ? `$${arm.skill} ${text}` : text);

/**
 * The AGENTS.md arm carries its rules in the workspace, not in the prompt, so the
 * file has to exist for that arm's runs and be absent for every other arm's. The
 * arms share one workspace (so they share one git state and one cache prefix),
 * which means this is set per run, immediately before the run.
 */
function applyAgentsFile(workspaceDir, arm) {
  const target = join(workspaceDir, "AGENTS.md");
  if (arm.kind === "agents") writeFileSync(target, ecoBlock(readFileSync(arm.agentsFile, "utf8")), "utf8");
  else rmSync(target, { force: true });
}

/**
 * The marker-delimited region is what install.sh writes into a user's AGENTS.md, so
 * it is what the arm must measure. The surrounding HTML comment explains the file to
 * a human reader and would otherwise be billed as tokens no user ever pays for.
 */
export function ecoBlock(text) {
  const start = text.indexOf(AGENTS_MARKERS.start);
  const end = text.indexOf(AGENTS_MARKERS.end);
  if (start === -1 || end === -1 || end < start) return text;
  return `${text.slice(start + AGENTS_MARKERS.start.length, end).trim()}\n`;
}

export const AGENTS_MARKERS = { start: "<!-- codex-eco:start -->", end: "<!-- codex-eco:end -->" };

/**
 * Put the workspace back to the committed fixture before every run.
 *
 * This is not hygiene, it is correctness: the arms share one workspace, and a
 * multi-turn run whose second turn patches the bug would leave the fixture fixed for
 * every run after it - so the grader would stop finding the planted bugs and the
 * later arms would look like quality regressions. Resetting also means a run cannot
 * inherit files an earlier run created.
 */
function resetWorkspace(dir) {
  const run = (args) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  run(["reset", "--hard", "-q"]);
  run(["clean", "-fdq"]);
}

/** Codex wants a trusted directory; a throwaway git repo is the cheapest one. */
function gitInit(dir) {
  const run = (args) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  try {
    run(["init", "-q"]);
    run(["add", "-A"]);
    run(["-c", "user.email=bench@codex-eco", "-c", "user.name=codex-eco bench", "commit", "-qm", "fixture"]);
    return true;
  } catch {
    return false;
  }
}

async function commandAb(opts, study) {
  const plan = buildPlan(opts, study);
  const outDir = join(RESULTS_DIR, plan.tag);
  const rawOut = join(outDir, "raw");

  const version = await codexVersion();
  if (!version) throw new Error("codex CLI not found on PATH");

  const skillArms = plan.arms.filter((a) => a.kind === "skill" && a.skillDir);
  const workspace = stageWorkspace({
    fixtureDir: plan.fixtureDir,
    skills: skillArms.map((a) => ({ from: a.skillDir, name: a.skill })),
  });
  const isRepo = gitInit(workspace.dir);

  const header = {
    tag: plan.tag,
    startedAt: new Date().toISOString(),
    codexVersion: version,
    cwd: workspace.dir,
    isGitRepo: isRepo,
    task: plan.task,
    turns: plan.turns,
    fixture: plan.fixture,
    model: plan.model ?? "(config default)",
    effort: plan.effort ?? "(model default)",
    verbosity: plan.verbosity ?? "(model default)",
    codexHome: plan.codexHome ?? "(operator default)",
    rubric: plan.rubric,
    n: plan.n,
    rotate: plan.rotate,
    arms: plan.arms.map((a) => ({
      name: a.name,
      kind: a.kind,
      skill: a.skill,
      skillDir: a.skillDir ? a.skillDir.replace(REPO_DIR, ".") : null,
      skillDigest: a.skillDir ? digestFile(join(a.skillDir, "SKILL.md")) : null,
      agentsFile: a.agentsFile ? a.agentsFile.replace(REPO_DIR, ".") : null,
      agentsDigest: a.agentsFile ? digestFile(a.agentsFile) : null,
    })),
  };

  console.log(`codex-eco bench - ${plan.tag}`);
  console.log(
    `  ${version} | model ${header.model} | effort ${header.effort} | verbosity ${header.verbosity} | ` +
      `n=${plan.n} per arm | arms ${plan.arms.map((a) => a.name).join("+")}${plan.rubric ? ` | rubric ${plan.rubric}` : ""}`,
  );
  console.log(`  task: ${plan.task.length > 100 ? `${plan.task.slice(0, 97)}...` : plan.task}`);
  if (plan.turns.length > 1) {
    console.log(`  ${plan.turns.length} turns per run, sent down one resumed thread:`);
    plan.turns.forEach((t, i) => console.log(`    t${i + 1}: ${t.length > 86 ? `${t.slice(0, 83)}...` : t}`));
  }
  for (const a of header.arms.filter((x) => x.skillDigest)) {
    console.log(`  arm ${a.name}: $${a.skill} from ${a.skillDir} (sha256 ${a.skillDigest})`);
  }
  console.log(`  workspace: ${workspace.dir}${isRepo ? " (git)" : " (NOT a git repo - runs will need --skip-git-repo-check)"}`);

  // Free, offline check that the batch will measure what it thinks it will. See
  // bench/lib/preflight.mjs for the defect that motivated it.
  const staged = plan.arms.filter((a) => a.kind === "skill" && a.skill).map((a) => a.skill);
  if (staged.length) {
    const res = checkSkillResolution({
      cwd: workspace.dir,
      codexHome: plan.codexHome ?? undefined,
      expected: staged,
    });
    if (res.skipped) {
      console.log(`  preflight: skipped (${res.skipped})`);
    } else if (!res.ok) {
      workspace.cleanup();
      throw new Error(`preflight failed, nothing was spent:\n    ${res.problems.join("\n    ")}`);
    } else {
      const dupes = (res.duplicates ?? []).filter((d) => !staged.includes(d.name));
      console.log(
        `  preflight: ${staged.length} staged skill(s) resolve uniquely inside the workspace` +
          (dupes.length ? `; unrelated duplicate names in your catalogue: ${dupes.map((d) => d.name).join(", ")}` : ""),
      );
    }
  }

  if (opts["dry-run"]) {
    console.log(
      `\n--dry-run: ${plan.arms.length * plan.n} runs planned, ` +
        `${plan.arms.length * plan.n * plan.turns.length} codex invocations, nothing executed.`,
    );
    workspace.cleanup();
    return 0;
  }

  mkdirSync(rawOut, { recursive: true });
  const runs = [];
  const broken = [];

  for (let rep = 1; rep <= plan.n; rep++) {
    const offset = plan.rotate ? (rep - 1) % plan.arms.length : 0;
    const order = [...plan.arms.slice(offset), ...plan.arms.slice(0, offset)];
    for (const arm of order) {
      const id = `${arm.name}_${String(rep).padStart(2, "0")}`;
      process.stdout.write(`  [${id}] `);
      let s;
      let exitCode;
      try {
        if (isRepo) resetWorkspace(workspace.dir);
        applyAgentsFile(workspace.dir, arm);
        const turnSummaries = [];
        let threadId = null;
        for (const [turnIndex, turnText] of plan.turns.entries()) {
          const single = plan.turns.length === 1;
          const prompt = turnIndex === 0 ? promptFor(plan, arm, turnText) : turnText;
          const res = await runArm({
            prompt,
            cwd: workspace.dir,
            codexHome: plan.codexHome ?? undefined,
            model: plan.model ?? undefined,
            effort: plan.effort ?? undefined,
            verbosity: plan.verbosity ?? undefined,
            skipGitRepoCheck: !isRepo,
            timeoutMs: plan.timeoutMs,
            resumeFrom: turnIndex === 0 ? null : threadId,
          });
          exitCode = res.exitCode;
          const file = single ? `${id}.jsonl` : `${id}_t${turnIndex + 1}.jsonl`;
          writeTextFile(join(rawOut, file), res.events.map((e) => JSON.stringify(e)).join("\n") + "\n");
          const turn = summarizeRun(res.events, `${id}#t${turnIndex + 1}`);
          turnSummaries.push(turn);
          // A resume needs the id the first turn recorded; without it later turns
          // would silently start fresh threads and measure the wrong thing.
          threadId = threadId ?? turn.threadId;
          if (!threadId && turnIndex === 0 && plan.turns.length > 1) {
            throw new RunError("turn 1 reported no thread id, so the thread cannot be resumed");
          }
        }
        s = plan.turns.length === 1 ? turnSummaries[0] : mergeTurns(turnSummaries, id);
      } catch (err) {
        console.log(`FAILED: ${err.message}`);
        broken.push({ id, arm: arm.name, rep, problems: [err.message] });
        continue;
      }
      const problems = validateRun(s, { exitCode });
      if (problems.length) {
        console.log(`REJECTED (${problems.join("; ")})`);
        broken.push({ id, arm: arm.name, rep, problems, outputTokens: s.outputTokens });
        continue;
      }
      const grade = plan.rubric ? gradeAnswer(plan.rubric, s.result) : null;
      const files =
        plan.turns.length === 1
          ? [join("raw", `${id}.jsonl`)]
          : plan.turns.map((_, i) => join("raw", `${id}_t${i + 1}.jsonl`));
      runs.push({ ...s, arm: arm.name, rep, grade, file: files[0], files });
      const gradeNote = grade ? ` | ${grade.planted}/${grade.plantedTotal} planted${grade.bonus ? ` +${grade.bonus}` : ""}` : "";
      console.log(
        `${s.outputTokens} out (+${s.reasoningTokens} reasoning) | ${s.commandCount} cmd | ` +
          `${s.preambleCount} preamble${gradeNote}`,
      );
    }
  }

  const summary = summarize(header, runs, broken);
  writeJson(join(outDir, "summary.json"), summary);
  const md = renderSummary(summary);
  writeTextFile(join(outDir, "summary.md"), `${md}\n`);
  console.log(`\n${md}`);
  console.log(`\nartifacts: ${outDir}`);
  if (plan.keepWorkspace) console.log(`workspace kept: ${workspace.dir}`);
  else workspace.cleanup();
  return broken.length ? 1 : 0;
}

function summarize(header, runs, broken) {
  const arms = [];
  for (const spec of header.arms) {
    const armRuns = runs.filter((r) => r.arm === spec.name);
    if (!armRuns.length) continue;
    arms.push({
      ...spec,
      runs: armRuns.map((r) => ({
        id: r.id,
        rep: r.rep,
        file: r.file,
        outputTokens: r.outputTokens,
        reasoningTokens: r.reasoningTokens,
        inputTokens: r.inputTokens,
        cachedInputTokens: r.cachedInputTokens,
        commandCount: r.commandCount,
        preambleCount: r.preambleCount,
        threadId: r.threadId,
        turns: r.turns ?? 1,
        files: r.files ?? [r.file],
        perTurn: r.perTurn ?? null,
        grade: r.grade,
      })),
      tokens: describe(armRuns.map((r) => r.outputTokens)),
      reasoning: describe(armRuns.map((r) => r.reasoningTokens ?? 0)),
      commands: describe(armRuns.map((r) => r.commandCount)),
      preambles: describe(armRuns.map((r) => r.preambleCount)),
      uncachedInput: describe(armRuns.map((r) => uncachedInput(r))),
      cachedInput: describe(armRuns.map((r) => r.cachedInputTokens ?? 0)),
      weighted: describe(armRuns.map((r) => weightedCost(r))),
      skillReads: armRuns.filter((r) => (r.commands ?? []).some((c) => /SKILL\.md/i.test(c))).length,
      grades: header.rubric ? summarizeGrades(armRuns.map((r) => r.grade)) : null,
    });
  }
  const baseline = arms.find((a) => a.kind === "baseline");
  const comparisons = {};
  const weightedComparisons = {};
  if (baseline) {
    for (const arm of arms.filter((a) => a.kind !== "baseline")) {
      comparisons[arm.name] = compareArms(baseline.tokens.values, arm.tokens.values);
      weightedComparisons[arm.name] = compareArms(baseline.weighted.values, arm.weighted.values);
    }
  }
  return {
    ...header,
    finishedAt: new Date().toISOString(),
    costWeights: COST_WEIGHTS,
    arms,
    comparisons,
    weightedComparisons,
    broken,
  };
}

const ARM_HEADERS = ["arm", "n", "mean out", "range", "reasoning", "uncached in", "cached in", "weighted", "cmds", "preamble"];
const ARM_ALIGN = ["", "right", "right", "right", "right", "right", "right", "right", "right", "right"];

export function renderSummary(summary) {
  // Batches recorded before the cost columns existed have no `uncachedInput`, `cachedInput`
  // or `weighted` field. They are re-derived here from the per-run usage the harness has
  // always stored, so an old artifact still renders - and still renders the same numbers a
  // fresh one would. Older batches with no usage at all simply show n/a.
  const derive = (a, key, fn) =>
    a[key] ?? describe((a.runs ?? []).map(fn).filter((x) => Number.isFinite(x)));
  const rows = summary.arms.map((a) => {
    const uncached = derive(a, "uncachedInput", (r) => uncachedInput(r));
    const cached = derive(a, "cachedInput", (r) => r.cachedInputTokens ?? 0);
    const weighted = derive(a, "weighted", (r) => weightedCost(r));
    return [
      a.name,
      a.tokens.n,
      fmtNum(a.tokens.mean, 1),
      `${fmtNum(a.tokens.min, 0)}-${fmtNum(a.tokens.max, 0)}`,
      fmtNum(a.reasoning.mean, 1),
      fmtNum(uncached.mean, 0),
      fmtNum(cached.mean, 0),
      fmtNum(weighted.mean, 0),
      fmtNum(a.commands.mean, 1),
      fmtNum(a.preambles.mean, 2),
    ];
  });
  const lines = [textTable(ARM_HEADERS, rows, { align: ARM_ALIGN })];
  const w = summary.costWeights ?? COST_WEIGHTS;
  lines.push("");
  lines.push(
    `weighted = uncached input x${w.uncachedInput} + cached input x${w.cachedInput} + output x${w.output} ` +
      `(GPT-5-class price ratios). It is the primary metric: output alone is under a third of the bill.`,
  );
  for (const [name, cmp] of Object.entries(summary.weightedComparisons ?? {})) {
    lines.push("");
    lines.push(`WEIGHTED COST (primary) - ${name} vs baseline`);
    lines.push(...comparisonLines(cmp, { baselineName: "baseline", treatmentName: name, metric: "weighted cost" }));
  }
  for (const [name, cmp] of Object.entries(summary.comparisons ?? {})) {
    lines.push("");
    lines.push(`OUTPUT TOKENS ONLY (secondary) - ${name} vs baseline`);
    lines.push(...comparisonLines(cmp, { baselineName: "baseline", treatmentName: name, metric: "output tokens" }));
  }
  const reads = summary.arms.filter((a) => a.kind === "skill" && a.skillReads !== undefined);
  if (reads.length) {
    lines.push("");
    lines.push(
      "SKILL.md reads (Codex injects only the name and description, so a skill arm must read its own " +
        "body from disk - one extra round trip, and the rules are absent from any run that skipped it):",
    );
    for (const a of reads) lines.push(`  ${a.name}: ${a.skillReads}/${a.tokens.n} runs read SKILL.md`);
  }
  const graded = summary.arms.filter((a) => a.grades);
  if (graded.length) {
    lines.push("");
    const gradeRows = graded.flatMap((a) =>
      Object.entries(a.grades.criteria).map(([id, c]) => [
        a.name,
        id,
        `${c.hits}/${c.runs}`,
        `${((c.hits / c.runs) * 100).toFixed(0)}%`,
      ]),
    );
    lines.push(textTable(["arm", "criterion", "hits", "rate"], gradeRows));
  }
  if (summary.broken.length) {
    lines.push("");
    lines.push(`${summary.broken.length} run(s) rejected and excluded from every number above:`);
    for (const b of summary.broken) lines.push(`  ${b.id}: ${b.problems.join("; ")}`);
  }
  lines.push("");
  lines.push("Tokens only: the codex exec event stream carries no cost field, so no dollar figure is inferred.");
  return lines.join("\n");
}

async function commandMatrix(opts) {
  const id = opts._[1];
  const studies = loadStudies();
  if (!id || !studies[id]) throw new Error(`unknown study "${id ?? ""}" - run: node bench/bench.mjs list`);
  const models = String(opts.models ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  if (!models.length) throw new Error("--models a,b,c is required for matrix");
  const stamp = timestamp();
  const results = [];
  for (const model of models) {
    console.log(`\n=============== ${model} ===============`);
    const code = await commandAb(
      { ...opts, model, tag: `${id}-${slug(model)}-${stamp}` },
      { id, ...studies[id] },
    );
    results.push({ model, tag: `${id}-${slug(model)}-${stamp}`, exitCode: code });
  }
  const matrixFile = join(RESULTS_DIR, `matrix-${id}-${stamp}.json`);
  writeJson(matrixFile, { study: id, startedAt: stamp, models: results });
  console.log(`\nmatrix index: ${matrixFile}`);
  return results.some((r) => r.exitCode) ? 1 : 0;
}

function commandList() {
  const studies = loadStudies();
  console.log("studies:");
  for (const [id, s] of Object.entries(studies)) {
    console.log(`  ${id.padEnd(12)} ${s.title ?? ""}`);
    if (s.task) console.log(`  ${"".padEnd(12)} task: ${s.task.slice(0, 95)}`);
  }
  console.log("\nrubrics:");
  for (const id of rubricIds()) {
    console.log(`  ${id.padEnd(14)} ${RUBRICS[id].criteria.map((c) => `${c.id}(${c.kind})`).join(", ")}`);
  }
  return 0;
}

function commandGrade(opts) {
  const [rubric, ...files] = opts._.slice(1);
  if (!rubric || !files.length) throw new Error("usage: bench.mjs grade <rubric> <file...>");
  if (!RUBRICS[rubric]) throw new Error(`unknown rubric "${rubric}" (have: ${rubricIds().join(", ")})`);
  const ids = RUBRICS[rubric].criteria.map((c) => c.id);
  const rows = files.map((f) => {
    const events = readJsonl(resolve(f));
    const s = summarizeRun(events, basename(f).replace(/\.jsonl?$/, ""));
    const g = gradeAnswer(rubric, s.result);
    return [s.id, s.outputTokens, ...ids.map((i) => (g.criteria[i] ? "yes" : "no"))];
  });
  console.log(textTable(["run", "out", ...ids], rows, { align: ["", "right"] }));
  return 0;
}

/** A BOM would break the first parse, so it is stripped on read. */
function readTextSafe(file) {
  return readFileSync(file, "utf8").replace(/^﻿/, "");
}

/** One event per line. */
function readJsonl(file) {
  return readTextSafe(file)
    .split("\n")
    .filter((l) => l.trim().startsWith("{"))
    .map((l) => JSON.parse(l));
}

/**
 * All event streams belonging to one run. `<id>.jsonl` for a single-turn run;
 * `<id>_t1.jsonl`, `<id>_t2.jsonl`, ... for a thread.
 */
function discoverTurnFiles(outDir, firstFile) {
  const rel = String(firstFile);
  const dir = join(outDir, "raw");
  const base = basename(rel).replace(/\.jsonl$/, "").replace(/_t\d+$/, "");
  if (!existsSync(dir)) return [rel];
  // Prefix match rather than a built regex: the id contains dots and dashes, and building
  // a pattern out of it is how this line got broken once already.
  const turn = (f) => Number(f.slice(base.length + 2, -6));
  const found = readdirSync(dir)
    .filter((f) => f.startsWith(`${base}_t`) && f.endsWith(".jsonl") && Number.isInteger(turn(f)))
    .sort((a, b) => turn(a) - turn(b));
  return found.length ? found.map((f) => join("raw", f)) : [rel];
}

function commandPublish(opts) {
  const tag = opts._[1];
  if (!tag) throw new Error("usage: bench.mjs publish <tag> --study <study-id>");
  const studyId = opts.study;
  if (!studyId) throw new Error("--study <id> is required so every published run carries its study label");
  const outDir = join(RESULTS_DIR, tag);
  const summaryFile = join(outDir, "summary.json");
  const manifest = existsSync(MANIFEST_FILE) ? readJson(MANIFEST_FILE) : { runs: {} };
  const prefix = opts.prefix ?? slug(studyId);

  // A batch that was stopped part-way has raw streams and no summary. Those runs are
  // still evidence, and dropping them because they are inconvenient to publish is
  // selective reporting, so they go out with what provenance exists and an `aborted` flag.
  if (!existsSync(summaryFile)) {
    const rawDir = join(outDir, "raw");
    if (!existsSync(rawDir)) throw new Error(`${outDir} has neither summary.json nor raw/`);
    let n = 0;
    mkdirSync(RAW_DIR, { recursive: true });
    for (const f of readdirSync(rawDir).filter((x) => x.endsWith(".jsonl"))) {
      const id = `${prefix}_${f.replace(/\.jsonl$/, "")}`;
      const target = join(RAW_DIR, `${id}.jsonl`);
      if (existsSync(target) && !opts.force) throw new Error(`${target} exists - pass --force to overwrite`);
      const text = readTextSafe(join(rawDir, f));
      writeFileSync(target, text, "utf8");
      const s = summarizeRun(parseEvents(text), id);
      manifest.runs[id] = {
        study: studyId,
        aborted: true,
        note: "batch stopped before it produced a summary; published so the runs are not hidden",
        arm: f.replace(/_\d+(_t\d+)?\.jsonl$/, ""),
        files: [basename(target)],
        outputTokens: s.outputTokens,
        reasoningTokens: s.reasoningTokens,
        inputTokens: s.inputTokens,
        cachedInputTokens: s.cachedInputTokens,
        preambleCount: s.preambleCount,
        commandCount: s.commandCount,
      };
      n++;
    }
    writeJson(MANIFEST_FILE, manifest);
    console.log(`published ${n} runs from an unsummarised batch into ${RAW_DIR}`);
    return 0;
  }

  const summary = readJson(summaryFile);
  let copied = 0;
  mkdirSync(RAW_DIR, { recursive: true });
  for (const arm of summary.arms) {
    for (const run of arm.runs) {
      const id = `${prefix}_${arm.name}_${String(run.rep).padStart(2, "0")}`;
      // A multi-turn run is several event streams. Every one is published: the summed
      // usage is what the claim rests on, so a reader has to be able to re-add it.
      // Summaries written before `files` existed list only turn 1. Recover the rest from
      // disk rather than publishing a third of a multi-turn run and calling it published.
      const files = run.files ?? discoverTurnFiles(outDir, run.file);
      const published = [];
      files.forEach((rel, i) => {
        const suffix = files.length === 1 ? "" : `_t${i + 1}`;
        const target = join(RAW_DIR, `${id}${suffix}.jsonl`);
        if (existsSync(target) && !opts.force) throw new Error(`${target} exists - pass --force to overwrite`);
        writeFileSync(target, readTextSafe(join(outDir, rel)), "utf8");
        published.push(basename(target));
        copied++;
      });
      manifest.runs[id] = {
        study: studyId,
        arm: arm.name,
        armKind: arm.kind,
        rep: run.rep,
        task: summary.task,
        turns: summary.turns ?? [summary.task],
        files: published,
        fixture: summary.fixture,
        skill: arm.skill,
        skillDigest: arm.skillDigest,
        agentsFile: arm.agentsFile ?? null,
        agentsDigest: arm.agentsDigest ?? null,
        model: summary.model,
        effort: summary.effort,
        verbosity: summary.verbosity,
        codexVersion: summary.codexVersion,
        rubric: summary.rubric,
        costWeights: summary.costWeights ?? null,
        date: summary.startedAt.slice(0, 10),
        outputTokens: run.outputTokens,
        reasoningTokens: run.reasoningTokens,
        inputTokens: run.inputTokens,
        cachedInputTokens: run.cachedInputTokens,
        preambleCount: run.preambleCount,
        commandCount: run.commandCount,
        perTurn: run.perTurn ?? null,
        grade: run.grade ?? null,
      };
    }
  }
  writeJson(MANIFEST_FILE, manifest);
  console.log(`published ${copied} runs into ${RAW_DIR}\nprovenance recorded in ${MANIFEST_FILE}`);
  return 0;
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv[0] === "help" || argv.includes("--help")) {
    console.log(USAGE);
    return 0;
  }
  const opts = parseArgs(argv);
  switch (opts._[0]) {
    case "ab":
      return commandAb(opts, null);
    case "study": {
      const id = opts._[1];
      const studies = loadStudies();
      if (!id || !studies[id]) throw new Error(`unknown study "${id ?? ""}" - run: node bench/bench.mjs list`);
      return commandAb(opts, { id, ...studies[id] });
    }
    case "matrix":
      return commandMatrix(opts);
    case "list":
      return commandList();
    case "grade":
      return commandGrade(opts);
    case "publish":
      return commandPublish(opts);
    default:
      throw new Error(`unknown command "${opts._[0]}"\n\n${USAGE}`);
  }
}

// Guarded so this module can be imported for its renderers - scripts/regrade.mjs needs
// renderSummary to keep summary.md in step with summary.json.
//
// Without the guard the CLI ran on import: main() parsed the IMPORTER's argv, found no
// command, threw, and its .catch called process.exit(2). It only ever appeared to work
// because the importing script's own synchronous main() reached process.exit(0) first.
// A race that a library wins by luck is a bug that will lose it later.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => process.exit(code ?? 0))
    .catch((err) => {
      console.error(`\nerror: ${err.message}`);
      if (process.env.ECO_DEBUG) console.error(err.stack);
      process.exit(2);
    });
}
