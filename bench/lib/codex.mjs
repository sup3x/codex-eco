// Runs `codex exec` arms and turns them into validated benchmark records.
//
// Ported from the claude-code-eco harness, with the parts that were specific to
// Claude Code replaced by what Codex actually reports. Three differences drive
// the design:
//   1. Codex streams JSONL events; the numbers live on `turn.completed.usage`,
//      and reasoning tokens are reported SEPARATELY from output tokens. Claude
//      folds thinking into output, so this harness can answer a question the
//      other one cannot: did brevity cut the prose or the reasoning?
//   2. There is no cost field anywhere in the event stream. On a ChatGPT plan
//      the currency is your rate limit, so this harness reports tokens only and
//      never invents a dollar figure.
//   3. Codex's own default behaviour includes a preamble message before tool
//      calls. That is a whole billed turn that moves no work forward, so
//      "preamble messages before the first command" is a first-class metric
//      here rather than a footnote.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, basename } from "node:path";

export class RunError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "RunError";
    Object.assign(this, details);
  }
}

function exec(bin, args, { cwd, timeoutMs = 900000, env } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bin, args, {
      cwd,
      // shell:false keeps argv intact: a prompt starting with "$eco" must not be
      // touched by a shell, and Git Bash rewrites some argument shapes.
      shell: false,
      windowsHide: true,
      // stdin closed on purpose: `codex exec` otherwise waits on stdin for
      // additional input and the run hangs.
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new RunError(`failed to launch ${bin}: ${err.message}`, { stderr }));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new RunError(`${bin} timed out after ${timeoutMs}ms`, { stdout, stderr }));
      resolvePromise({ stdout, stderr, code });
    });
  });
}

export async function codexVersion(bin = "codex") {
  try {
    const { stdout } = await exec(bin, ["--version"], { timeoutMs: 30000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

export function parseEvents(stdout) {
  const events = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // A non-JSON line on stdout is Codex chatter, not an event. Ignored on
      // purpose: a malformed *event* would fail validation below instead.
    }
  }
  return events;
}

/** Turn an event stream into the record the rest of the harness scores. */
export function summarizeRun(events, id = "?") {
  const items = events.filter((e) => e.item).map((e) => e.item);
  const completed = events.find((e) => e.type === "turn.completed");
  const usage = completed?.usage ?? {};
  const messages = items.filter((i) => i.type === "agent_message");
  const commands = items.filter((i) => i.type === "command_execution");

  // Preamble = an assistant message emitted before any command ran. Deduped by
  // item id because Codex reports item.started and item.completed for the same
  // item.
  const order = [];
  const seen = new Set();
  for (const i of items) {
    const key = `${i.type}:${i.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    order.push(i);
  }
  const firstCommandIndex = order.findIndex((i) => i.type === "command_execution");
  const preambles = order.filter(
    (i, idx) => i.type === "agent_message" && firstCommandIndex !== -1 && idx < firstCommandIndex,
  );

  const uniqueCommands = [];
  const cmdSeen = new Set();
  for (const c of commands) {
    const key = String(c.command);
    if (cmdSeen.has(key)) continue;
    cmdSeen.add(key);
    uniqueCommands.push(key);
  }

  return {
    id,
    outputTokens: usage.output_tokens ?? null,
    reasoningTokens: usage.reasoning_output_tokens ?? null,
    inputTokens: usage.input_tokens ?? null,
    cachedInputTokens: usage.cached_input_tokens ?? null,
    cacheWriteTokens: usage.cache_write_input_tokens ?? null,
    threadId: events.find((e) => e.type === "thread.started")?.thread_id ?? null,
    // The final assistant message is the answer; earlier ones are preamble.
    result: messages.length ? String(messages[messages.length - 1].text ?? "") : "",
    preambleCount: preambles.length,
    preambleText: preambles.map((p) => String(p.text ?? "")).join(" | "),
    commandCount: uniqueCommands.length,
    commands: uniqueCommands,
    errors: events.filter((e) => e.type === "error").map((e) => String(e.message ?? "").slice(0, 400)),
    turnFailed: events.some((e) => e.type === "turn.failed"),
    events: events.length,
  };
}

/** Problems that disqualify a run from being scored. Empty array = clean. */
export function validateRun(summary, { exitCode } = {}) {
  const problems = [];
  if (!summary) return ["no summary"];
  if (summary.errors.length) problems.push(`error event: ${summary.errors[0]}`);
  if (summary.turnFailed) problems.push("turn.failed");
  if (summary.outputTokens == null) problems.push("no turn.completed usage - the run produced no scorable numbers");
  if (!summary.result) problems.push("no agent message - nothing was answered");
  if (exitCode !== undefined && exitCode !== 0) problems.push(`codex exited ${exitCode}`);
  // A sandbox that fails to start makes the agent apologise instead of working;
  // it looks like a cheap run and is worthless. Catch it by name.
  if (/sandbox/i.test(summary.result) && /unavailable|failed/i.test(summary.result)) {
    problems.push("the agent reported a sandbox failure in its answer");
  }
  return problems;
}

/**
 * Execute one arm.
 * @param {object} opts
 * @param {string} opts.prompt      full prompt, including any leading $skill
 * @param {string} opts.cwd         working directory (should be a git repo)
 * @param {string} [opts.codexHome] CODEX_HOME for isolation from the operator's setup
 * @param {string} [opts.model]     --model
 * @param {string} [opts.effort]    -c model_reasoning_effort=...
 * @param {string} [opts.verbosity] -c model_verbosity=...
 */
export async function runArm({
  prompt,
  cwd = process.cwd(),
  codexHome,
  model,
  effort,
  verbosity,
  serviceTier = "default",
  sandbox,
  approveForMe = true,
  skipGitRepoCheck = false,
  timeoutMs = 900000,
  retries = 1,
  bin = "codex",
  extraArgs = [],
}) {
  const args = ["exec", "--json"];
  if (approveForMe) args.push("--approve-for-me");
  if (skipGitRepoCheck) args.push("--skip-git-repo-check");
  if (model) args.push("--model", model);
  if (sandbox) args.push("--sandbox", sandbox);
  if (effort) args.push("-c", `model_reasoning_effort=${effort}`);
  if (verbosity) args.push("-c", `model_verbosity=${verbosity}`);
  if (serviceTier) args.push("-c", `service_tier=${serviceTier}`);
  args.push(...extraArgs, prompt);

  const env = codexHome ? { CODEX_HOME: codexHome } : {};
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { stdout, stderr, code } = await exec(bin, args, { cwd, timeoutMs, env });
      const events = parseEvents(stdout);
      if (!events.length) {
        throw new RunError(`codex produced no JSON events: ${String(stderr).slice(0, 200)}`);
      }
      return { events, args, exitCode: code, stderr };
    } catch (err) {
      lastErr = err;
      if (err instanceof RunError && /no JSON events/.test(err.message)) break;
    }
  }
  throw lastErr;
}

/** sha256 (first 12 hex) of a file's LF-normalised content. */
export function digestFile(file) {
  return createHash("sha256").update(readFileSync(file, "utf8").replace(/\r\n/g, "\n")).digest("hex").slice(0, 12);
}

/**
 * Stage an isolated workspace: fixture files, a git repo (Codex wants a trusted
 * directory), and zero or more skills installed project-scoped under
 * .agents/skills so the arm measures the checked-out body rather than whatever
 * the operator has installed.
 */
export function stageWorkspace({ fixtureDir, skills = [], prefix = "codex-eco-bench-" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  if (fixtureDir) cpSync(fixtureDir, dir, { recursive: true });
  const staged = [];
  for (const s of skills) {
    const name = s.name ?? basename(resolve(s.from));
    const dest = join(dir, ".agents", "skills", name);
    mkdirSync(dest, { recursive: true });
    cpSync(s.from, dest, { recursive: true });
    const skillFile = join(dest, "SKILL.md");
    if (!existsSync(skillFile)) throw new RunError(`staged skill has no SKILL.md: ${s.from}`);
    const body = readFileSync(skillFile, "utf8");
    const renamed = body.replace(/^(---\r?\n(?:.*\r?\n)*?name:\s*)([^\r\n]+)/, `$1${name}`);
    writeFileSync(skillFile, renamed, "utf8");
    staged.push({ name, source: resolve(s.from), digest: digestFile(skillFile) });
  }
  return { dir, skills: staged, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
