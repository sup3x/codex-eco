#!/usr/bin/env node
// Measures what your Codex session costs before you type anything - and what the
// eco profile takes off that bill. Free, offline, no model call.
//
// Codex ships `codex debug prompt-input`, which renders the exact list of items
// the model will receive. That makes the fixed prefix measurable rather than
// estimated: this script renders it three times (untouched, then with each eco
// tier's config) and reports the difference per section, so every claim in this
// repository about prefix size is one command away from being checked on your
// own machine.
//
//   node scripts/prefix-audit.mjs                # audit the current directory
//   node scripts/prefix-audit.mjs --json
//   node scripts/prefix-audit.mjs --model gpt-5.6-sol
//   node scripts/prefix-audit.mjs --prompt "hello"
//
// Run it inside a real project to see your AGENTS.md in the numbers.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Every lever here is a real config key, verified against
// `codex mcp-server --strict-config` before it is offered. `what it costs you`
// is not decoration: two of these trade behaviour for tokens and you should know
// which before you copy a profile.
const TIERS = [
  {
    id: "safe",
    label: "eco profile (safe)",
    args: [
      "-c",
      "include_environment_context=false",
      "-c",
      "include_permissions_instructions=false",
      "-c",
      "include_apps_instructions=false",
      "-c",
      "features.tool_suggest=false",
    ],
    levers: [
      ["include_environment_context=false", "drops the cwd/OS/git block", "the model no longer knows your OS or branch unless you say so"],
      [
        "include_permissions_instructions=false",
        "drops the escalation/permissions prose",
        "the model has less guidance on when to ask before running something - keep it if you rely on approval prompts",
      ],
      ["include_apps_instructions=false", "drops the apps block", "nothing, unless you use ChatGPT apps from Codex"],
      ["features.tool_suggest=false", "drops the recommended-plugins advert", "nothing: it lists plugins you have not installed"],
    ],
  },
  {
    id: "aggressive",
    label: "eco profile (aggressive)",
    args: [
      "-c",
      "include_environment_context=false",
      "-c",
      "include_permissions_instructions=false",
      "-c",
      "include_apps_instructions=false",
      "-c",
      "features.tool_suggest=false",
      "-c",
      "features.apps=false",
      "-c",
      "features.plugins=false",
    ],
    levers: [
      ["features.apps=false", "turns the apps subsystem off", "you cannot use ChatGPT apps in that session"],
      [
        "features.plugins=false",
        "turns the plugin subsystem off, which also shrinks the skills catalog",
        "installed PLUGINS stop loading - including eco if you installed it as a plugin. Standalone skills in .agents/skills still work, so this tier pairs with the ./install.sh path",
      ],
    ],
  },
];

const SECTION_LABELS = {
  skills_instructions: "skills catalog",
  plugins_instructions: "plugin instructions",
  apps_instructions: "apps instructions",
  recommended_plugins: "recommended-plugins advert",
  environment_context: "environment context",
  multi_agent_mode: "multi-agent mode note",
  plain: "core instruction prose",
};

function runPromptInput({ prompt, model, extra = [], bin = "codex" }) {
  const args = ["debug", "prompt-input", prompt];
  if (model) args.push("-c", `model=${model}`);
  args.push(...extra);
  const out = execFileSync(bin, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  const items = JSON.parse(out);
  const sections = new Map();
  let total = 0;
  for (const item of items) {
    const text = (item.content ?? []).map((c) => c.text ?? "").join("");
    total += text.length;
    const tag = text.match(/^<([a-z_]+)>/)?.[1] ?? "plain";
    sections.set(tag, (sections.get(tag) ?? 0) + text.length);
  }
  return { total, sections: [...sections.entries()].map(([tag, chars]) => ({ tag, chars })).sort((a, b) => b.chars - a.chars) };
}

/** Confirm a key is real before we ever suggest it. Free: no model call. */
function validateKey(kv, bin = "codex") {
  try {
    execFileSync(bin, ["mcp-server", "--strict-config", "-c", kv], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60000,
      input: "",
    });
    return null;
  } catch (err) {
    const msg = String(err.stderr ?? err.stdout ?? err.message).trim();
    // A timeout means the server started, which means the config parsed.
    if (err.killed || /ETIMEDOUT|timed out/i.test(String(err.message))) return null;
    return msg.split("\n")[0]?.slice(0, 160) || null;
  }
}

const estTokens = (chars) => Math.round(chars / 4);
// Explicit grouping: toLocaleString() follows the machine's locale, which turns
// 16,901 into 16.901 on a Turkish system and makes the table read as decimals.
const num = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const pad = (s, n) => String(s).padEnd(n);
const padl = (s, n) => String(s).padStart(n);

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const modelIdx = argv.indexOf("--model");
  const model = modelIdx !== -1 ? argv[modelIdx + 1] : null;
  const promptIdx = argv.indexOf("--prompt");
  const prompt = promptIdx !== -1 ? argv[promptIdx + 1] : "hello";

  let base;
  try {
    base = runPromptInput({ prompt, model });
  } catch (err) {
    console.error(
      `error: could not run \`codex debug prompt-input\` (${String(err.message).split("\n")[0]}).\n` +
        `This audit needs the Codex CLI on PATH. It makes no model call and costs nothing.`,
    );
    return 2;
  }

  const results = TIERS.map((tier) => {
    const measured = runPromptInput({ prompt, model, extra: tier.args });
    return { ...tier, measured, delta: measured.total - base.total, pct: ((measured.total - base.total) / base.total) * 100 };
  });

  if (json) {
    console.log(
      JSON.stringify(
        {
          prompt,
          model: model ?? "(config default)",
          baseline: base,
          tiers: results.map((r) => ({ id: r.id, total: r.measured.total, delta: r.delta, pct: r.pct, sections: r.measured.sections })),
          note: "chars are exact; token counts are chars/4 estimates and labelled as such",
        },
        null,
        2,
      ),
    );
    return 0;
  }

  console.log(`Codex fixed-prefix audit  -  model ${model ?? "(config default)"}, prompt "${prompt}", cwd ${process.cwd()}`);
  console.log(`Measured with \`codex debug prompt-input\`: no model call, nothing billed.\n`);

  console.log(`${pad("section", 30)}${padl("chars", 9)}${padl("~tokens", 10)}`);
  console.log("-".repeat(49));
  for (const s of base.sections) {
    console.log(`${pad(SECTION_LABELS[s.tag] ?? s.tag, 30)}${padl(num(s.chars), 9)}${padl(num(estTokens(s.chars)), 10)}`);
  }
  console.log("-".repeat(49));
  console.log(`${pad("TOTAL before you type", 30)}${padl(num(base.total), 9)}${padl(num(estTokens(base.total)), 10)}`);

  console.log(`\n${pad("configuration", 30)}${padl("chars", 9)}${padl("~tokens", 10)}${padl("change", 12)}`);
  console.log("-".repeat(61));
  console.log(`${pad("as configured now", 30)}${padl(num(base.total), 9)}${padl(num(estTokens(base.total)), 10)}${padl("-", 12)}`);
  for (const r of results) {
    const pctText = `${r.pct <= 0 ? "" : "+"}${r.pct.toFixed(1)}%`;
    console.log(
      `${pad(r.label, 30)}${padl(num(r.measured.total), 9)}${padl(num(estTokens(r.measured.total)), 10)}${padl(pctText, 12)}`,
    );
  }

  console.log(`\nWhat each lever removes, and what it costs you:`);
  for (const r of results) {
    console.log(`\n  ${r.label}`);
    for (const [key, removes, cost] of r.levers) {
      const problem = validateKey(key);
      const mark = problem ? "REJECTED BY YOUR CODEX" : "ok";
      console.log(`    ${key}  [${mark}]`);
      console.log(`      removes: ${removes}`);
      console.log(`      costs:   ${cost}`);
      if (problem) console.log(`      error:   ${problem}`);
    }
  }

  console.log(
    `\nTo apply a tier, copy the matching profile and launch with it:\n` +
      `  cp profiles/eco.config.toml "$CODEX_HOME/eco.config.toml"   # or %USERPROFILE%\\.codex\\ on Windows\n` +
      `  codex --profile eco\n\n` +
      `Not included in these numbers: the model's own base instructions (a further ~17.7k chars on the\n` +
      `5.6 family, which no setting reaches), tool schemas, and your conversation. AGENTS.md IS included,\n` +
      `so run this inside a real project to see what yours costs - project_doc_max_bytes caps it at 32,768\n` +
      `bytes by default, which is the single largest number a user controls.`,
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
