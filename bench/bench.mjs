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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { REPO_DIR, BENCH_DIR, RAW_DIR, readJson, writeJson, writeTextFile } from "./lib/io.mjs";
import { compareArms, describe, fmtNum, fmtPct } from "./lib/stats.mjs";
import { gradeAnswer, summarizeGrades, rubricIds, RUBRICS } from "./lib/grade.mjs";
import { runArm, validateRun, summarizeRun, codexVersion, stageWorkspace, digestFile, RunError } from "./lib/codex.mjs";
import { textTable, comparisonLines } from "./lib/report.mjs";

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

  return {
    task,
    fixture,
    fixtureDir,
    rubric: rubric ?? null,
    arms: selected,
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

const promptFor = (plan, arm) => (arm.kind === "skill" ? `$${arm.skill} ${plan.task}` : plan.task);

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
    })),
  };

  console.log(`codex-eco bench - ${plan.tag}`);
  console.log(
    `  ${version} | model ${header.model} | effort ${header.effort} | verbosity ${header.verbosity} | ` +
      `n=${plan.n} per arm | arms ${plan.arms.map((a) => a.name).join("+")}${plan.rubric ? ` | rubric ${plan.rubric}` : ""}`,
  );
  console.log(`  task: ${plan.task.length > 100 ? `${plan.task.slice(0, 97)}...` : plan.task}`);
  for (const a of header.arms.filter((x) => x.skillDigest)) {
    console.log(`  arm ${a.name}: $${a.skill} from ${a.skillDir} (sha256 ${a.skillDigest})`);
  }
  console.log(`  workspace: ${workspace.dir}${isRepo ? " (git)" : " (NOT a git repo - runs will need --skip-git-repo-check)"}`);

  if (opts["dry-run"]) {
    console.log(`\n--dry-run: ${plan.arms.length * plan.n} runs planned, nothing executed.`);
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
      let events;
      let exitCode;
      try {
        ({ events, exitCode } = await runArm({
          prompt: promptFor(plan, arm),
          cwd: workspace.dir,
          codexHome: plan.codexHome ?? undefined,
          model: plan.model ?? undefined,
          effort: plan.effort ?? undefined,
          verbosity: plan.verbosity ?? undefined,
          skipGitRepoCheck: !isRepo,
          timeoutMs: plan.timeoutMs,
        }));
      } catch (err) {
        console.log(`FAILED: ${err.message}`);
        broken.push({ id, arm: arm.name, rep, problems: [err.message] });
        continue;
      }
      writeTextFile(join(rawOut, `${id}.jsonl`), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
      const s = summarizeRun(events, id);
      const problems = validateRun(s, { exitCode });
      if (problems.length) {
        console.log(`REJECTED (${problems.join("; ")})`);
        broken.push({ id, arm: arm.name, rep, problems, outputTokens: s.outputTokens });
        continue;
      }
      const grade = plan.rubric ? gradeAnswer(plan.rubric, s.result) : null;
      runs.push({ ...s, arm: arm.name, rep, grade, file: join("raw", `${id}.jsonl`) });
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
        grade: r.grade,
      })),
      tokens: describe(armRuns.map((r) => r.outputTokens)),
      reasoning: describe(armRuns.map((r) => r.reasoningTokens ?? 0)),
      commands: describe(armRuns.map((r) => r.commandCount)),
      preambles: describe(armRuns.map((r) => r.preambleCount)),
      grades: header.rubric ? summarizeGrades(armRuns.map((r) => r.grade)) : null,
    });
  }
  const baseline = arms.find((a) => a.kind === "baseline");
  const comparisons = {};
  if (baseline) {
    for (const arm of arms.filter((a) => a.kind === "skill")) {
      comparisons[arm.name] = compareArms(baseline.tokens.values, arm.tokens.values);
    }
  }
  return { ...header, finishedAt: new Date().toISOString(), arms, comparisons, broken };
}

const ARM_HEADERS = ["arm", "n", "mean out", "range", "sd", "reasoning", "cmds", "preamble"];
const ARM_ALIGN = ["", "right", "right", "right", "right", "right", "right", "right"];

function renderSummary(summary) {
  const rows = summary.arms.map((a) => [
    a.name,
    a.tokens.n,
    fmtNum(a.tokens.mean, 1),
    `${fmtNum(a.tokens.min, 0)}-${fmtNum(a.tokens.max, 0)}`,
    Number.isFinite(a.tokens.stdev) ? fmtNum(a.tokens.stdev, 1) : "n/a",
    fmtNum(a.reasoning.mean, 1),
    fmtNum(a.commands.mean, 1),
    fmtNum(a.preambles.mean, 2),
  ]);
  const lines = [textTable(ARM_HEADERS, rows, { align: ARM_ALIGN })];
  for (const [name, cmp] of Object.entries(summary.comparisons ?? {})) {
    lines.push("");
    lines.push(...comparisonLines(cmp, { baselineName: "baseline", treatmentName: name }));
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

function commandPublish(opts) {
  const tag = opts._[1];
  if (!tag) throw new Error("usage: bench.mjs publish <tag> --study <study-id>");
  const studyId = opts.study;
  if (!studyId) throw new Error("--study <id> is required so every published run carries its study label");
  const outDir = join(RESULTS_DIR, tag);
  const summary = readJson(join(outDir, "summary.json"));
  const manifest = existsSync(MANIFEST_FILE) ? readJson(MANIFEST_FILE) : { runs: {} };
  const prefix = opts.prefix ?? slug(studyId);
  let copied = 0;
  mkdirSync(RAW_DIR, { recursive: true });
  for (const arm of summary.arms) {
    for (const run of arm.runs) {
      const id = `${prefix}_${arm.name}_${String(run.rep).padStart(2, "0")}`;
      const target = join(RAW_DIR, `${id}.jsonl`);
      if (existsSync(target) && !opts.force) throw new Error(`${target} exists - pass --force to overwrite`);
      writeFileSync(target, readTextSafe(join(outDir, run.file)), "utf8");
      manifest.runs[id] = {
        study: studyId,
        arm: arm.name,
        rep: run.rep,
        task: summary.task,
        fixture: summary.fixture,
        skill: arm.skill,
        skillDigest: arm.skillDigest,
        model: summary.model,
        effort: summary.effort,
        verbosity: summary.verbosity,
        codexVersion: summary.codexVersion,
        rubric: summary.rubric,
        date: summary.startedAt.slice(0, 10),
        outputTokens: run.outputTokens,
        reasoningTokens: run.reasoningTokens,
        preambleCount: run.preambleCount,
        commandCount: run.commandCount,
      };
      copied++;
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

main()
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    console.error(`\nerror: ${err.message}`);
    if (process.env.ECO_DEBUG) console.error(err.stack);
    process.exit(2);
  });
