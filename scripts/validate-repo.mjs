#!/usr/bin/env node
// Schema gate for the things Codex will reject, runnable without Codex installed.
//
// Codex 0.147 ships the authoritative validators as system skills
// (`skill-creator/scripts/quick_validate.py`, `plugin-creator/scripts/validate_plugin.py`)
// and those are what we run locally before a release. They cannot run in CI,
// because CI has no Codex. So this script re-implements the rules we verified
// against them - the rules, not their code - so a pull request cannot land a
// manifest or a frontmatter that the real validators would refuse.
//
// Each rule below records how it was established. If Codex changes, re-run the
// real validators and update this file; do not let the two drift silently.
//
//   node scripts/validate-repo.mjs
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Verified against quick_validate.py: allowed_properties = {name, description,
// license, allowed-tools, metadata}. The Rust loader only reads name,
// description and metadata.short-description, so the other two are inert - we
// forbid them here to keep the bodies honest about what has an effect.
const SKILL_ALLOWED = new Set(["name", "description", "metadata"]);
const SKILL_INERT = new Set(["license", "allowed-tools"]);
const SKILL_NAME_RE = /^[a-z0-9-]+$/;
const SKILL_NAME_MAX = 64;
const DESCRIPTION_MAX = 1024;

// Verified against validate_plugin.py.
const PLUGIN_TOP_LEVEL = new Set([
  "id",
  "name",
  "version",
  "description",
  "skills",
  "apps",
  "mcpServers",
  "interface",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
]);
const PLUGIN_INTERFACE = new Set([
  "displayName",
  "shortDescription",
  "longDescription",
  "developerName",
  "category",
  "capabilities",
  "websiteURL",
  "privacyPolicyURL",
  "termsOfServiceURL",
  "defaultPrompt",
  "brandColor",
  "logo",
  "logoDark",
  "screenshots",
  "icon",
  "iconDark",
]);
const INTERFACE_REQUIRED = ["displayName", "shortDescription", "longDescription", "developerName", "category"];
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const BRAND_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

// Verified against validate_plugin.py's reject_skill_agent_unknown_fields.
const AGENT_YAML_TOP = new Set(["interface", "policy", "dependencies"]);
const AGENT_YAML_INTERFACE = new Set([
  "display_name",
  "short_description",
  "icon_small",
  "icon_large",
  "brand_color",
  "default_prompt",
]);

const problems = [];
const notes = [];
const fail = (where, msg) => problems.push(`${where}: ${msg}`);

function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = {};
  let currentKey = null;
  for (const raw of m[1].split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const nested = raw.match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
    if (nested && currentKey) {
      out[currentKey] = { ...(typeof out[currentKey] === "object" ? out[currentKey] : {}), [nested[1]]: nested[2] };
      continue;
    }
    const top = raw.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (top) {
      currentKey = top[1];
      out[currentKey] = top[2] === "" ? {} : top[2];
    }
  }
  return out;
}

function checkSkill(dir, name) {
  const file = join(dir, "SKILL.md");
  const where = `skills/${name}`;
  if (!existsSync(file)) return fail(where, "no SKILL.md");
  const text = readFileSync(file, "utf8");
  const fm = frontmatter(text);
  if (!fm) return fail(where, "no YAML frontmatter");

  for (const key of Object.keys(fm)) {
    if (SKILL_INERT.has(key)) {
      notes.push(`${where}: frontmatter carries \`${key}\`, which the Python validator accepts but the runtime ignores`);
      continue;
    }
    if (!SKILL_ALLOWED.has(key)) fail(where, `frontmatter key \`${key}\` is not a Codex skill field`);
  }
  for (const key of ["name", "description"]) if (!fm[key]) fail(where, `frontmatter is missing \`${key}\``);

  const declared = String(fm.name ?? "").trim();
  if (declared !== name) fail(where, `frontmatter name is "${declared}" but the directory is "${name}"`);
  if (!SKILL_NAME_RE.test(declared)) fail(where, `name "${declared}" must match ${SKILL_NAME_RE}`);
  if (declared.length > SKILL_NAME_MAX) fail(where, `name is ${declared.length} chars, max ${SKILL_NAME_MAX}`);
  if (declared.startsWith("-") || declared.endsWith("-") || declared.includes("--")) {
    fail(where, "name cannot start or end with a hyphen, or contain consecutive hyphens");
  }

  const desc = String(fm.description ?? "");
  if (desc.length > DESCRIPTION_MAX) fail(where, `description is ${desc.length} chars, max ${DESCRIPTION_MAX}`);
  if (/[<>]/.test(desc)) fail(where, "description contains an angle bracket, which Codex forbids");

  // A colon followed by a space makes an unquoted YAML scalar ambiguous, and Codex's
  // loader rejects the file outright. This check exists because a description edit here
  // shipped that exact break and only Codex's own validator caught it.
  for (const [key, value] of Object.entries(fm)) {
    if (typeof value !== "string") continue;
    const raw = text.match(new RegExp(`^${key}:\\s*(.*)$`, "m"))?.[1] ?? "";
    const quoted = /^(["']).*\1$/.test(raw.trim());
    if (!quoted && /:\s/.test(value)) {
      fail(where, `\`${key}\` contains ": " but is not quoted, so the YAML frontmatter will not parse`);
    }
  }

  if (typeof fm.metadata === "object" && fm.metadata) {
    for (const key of Object.keys(fm.metadata)) {
      if (key !== "short-description") fail(where, `metadata.${key} is not a Codex field (only short-description)`);
    }
  }

  const agentYaml = join(dir, "agents", "openai.yaml");
  if (existsSync(agentYaml)) {
    const yaml = readFileSync(agentYaml, "utf8");
    for (const m of yaml.matchAll(/^([A-Za-z0-9_]+):/gm)) {
      if (!AGENT_YAML_TOP.has(m[1])) fail(`${where}/agents/openai.yaml`, `top-level key \`${m[1]}\` is not allowed`);
    }
    const iface = yaml.match(/^interface:\r?\n((?:[ \t]+.*\r?\n?)*)/m)?.[1] ?? "";
    for (const m of iface.matchAll(/^\s+([A-Za-z0-9_]+):/gm)) {
      if (!AGENT_YAML_INTERFACE.has(m[1])) fail(`${where}/agents/openai.yaml`, `interface.${m[1]} is not allowed`);
    }
  }
}

function checkPlugin(root) {
  const file = join(root, ".codex-plugin", "plugin.json");
  const where = ".codex-plugin/plugin.json";
  if (!existsSync(file)) return fail(where, "missing");
  let j;
  try {
    j = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    return fail(where, `invalid JSON: ${err.message}`);
  }
  for (const key of Object.keys(j)) if (!PLUGIN_TOP_LEVEL.has(key)) fail(where, `top-level key \`${key}\` is rejected by Codex`);
  for (const key of ["name", "version", "description", "author", "interface"]) if (!j[key]) fail(where, `\`${key}\` is required`);
  if (typeof j.author !== "object" || !j.author?.name) fail(where, "`author` must be an object with a `name`");
  if (!SEMVER_RE.test(String(j.version))) fail(where, `version "${j.version}" is not strict semver`);

  const iface = j.interface ?? {};
  for (const key of Object.keys(iface)) if (!PLUGIN_INTERFACE.has(key)) fail(where, `interface.${key} is rejected by Codex`);
  for (const key of INTERFACE_REQUIRED) if (!iface[key]) fail(where, `interface.${key} is required`);
  if (!iface.defaultPrompt || (Array.isArray(iface.defaultPrompt) && !iface.defaultPrompt.length)) {
    fail(where, "interface.defaultPrompt is required and must be non-empty");
  }
  if (iface.brandColor && !BRAND_COLOR_RE.test(iface.brandColor)) fail(where, `brandColor "${iface.brandColor}" must be #RRGGBB`);
  for (const key of ["websiteURL", "privacyPolicyURL", "termsOfServiceURL"]) {
    if (iface[key] && !/^https:\/\//.test(iface[key])) fail(where, `interface.${key} must be an absolute https URL`);
  }
  if (j.skills && j.skills !== "./skills/" && j.skills !== "skills") {
    notes.push(`${where}: skills is "${j.skills}"; Codex expects the skills directory`);
  }
}

function checkMarketplace(root) {
  const file = join(root, ".agents", "plugins", "marketplace.json");
  const where = ".agents/plugins/marketplace.json";
  if (!existsSync(file)) return fail(where, "missing");
  let j;
  try {
    j = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    return fail(where, `invalid JSON: ${err.message}`);
  }
  if (!j.name) fail(where, "`name` is required");
  if (!Array.isArray(j.plugins) || !j.plugins.length) return fail(where, "`plugins` must be a non-empty array");
  for (const p of j.plugins) {
    if (!p.name) fail(where, "a plugin entry has no `name`");
    if (!p.source?.path) fail(where, `plugin "${p.name}" has no source.path`);
    else if (!existsSync(join(root, p.source.path))) fail(where, `plugin "${p.name}" source.path does not exist: ${p.source.path}`);
  }
}

// The rules blocks the installers write into a user's AGENTS.md.
const BLOCK_START = "<!-- codex-eco:start -->";
const BLOCK_END = "<!-- codex-eco:end -->";
// AGENTS.md is re-sent on every request, so the block's size is a per-turn cost.
// The short block exists specifically to keep that cost down; if it grows back to the
// size of the full one, the file has lost its reason to exist. Measured on
// gpt-5.6-terra, the full block cut output 37% but doubled uncached input.
const LEAN_MAX_BYTES = 1600;

function extractBlock(text) {
  const start = text.indexOf(BLOCK_START);
  const end = text.indexOf(BLOCK_END);
  if (start === -1 || end === -1 || end < start) return null;
  return text.slice(start, end + BLOCK_END.length);
}

function checkRuleBlocks(root) {
  for (const [file, budget] of [
    ["AGENTS.eco.md", null],
    ["AGENTS.eco.lean.md", LEAN_MAX_BYTES],
  ]) {
    const path = join(root, file);
    if (!existsSync(path)) {
      fail(file, "missing - the installers read the rules block from it");
      continue;
    }
    const text = readFileSync(path, "utf8");
    const block = extractBlock(text);
    if (!block) {
      fail(file, `no ${BLOCK_START} ... ${BLOCK_END} region, so the installers cannot extract anything`);
      continue;
    }
    const bytes = Buffer.byteLength(block, "utf8");
    if (budget && bytes > budget) {
      fail(file, `rule block is ${bytes} bytes, over the ${budget}-byte budget that is the point of the short block`);
    }
    // The block is what reaches the model; a stray marker inside it would break the
    // installers' idempotent replace.
    const inner = block.slice(BLOCK_START.length, -BLOCK_END.length);
    if (inner.includes(BLOCK_START) || inner.includes(BLOCK_END)) {
      fail(file, "a nested codex-eco marker inside the block would break idempotent re-install");
    }
    notes.push(`${file}: rule block is ${bytes} bytes${budget ? ` (budget ${budget})` : ""}`);
  }

  // Both installers must agree on what the block is, so both must name the same files.
  for (const [installer, needles] of [
    ["install.sh", ["AGENTS.eco.lean.md", "AGENTS.eco.md", BLOCK_START]],
    ["install.ps1", ["AGENTS.eco.lean.md", "AGENTS.eco.md", BLOCK_START]],
  ]) {
    const path = join(root, installer);
    if (!existsSync(path)) {
      fail(installer, "missing");
      continue;
    }
    const text = readFileSync(path, "utf8");
    for (const needle of needles) {
      if (!text.includes(needle)) fail(installer, `does not reference \`${needle}\``);
    }
  }

  // install.ps1 has no BOM, so PowerShell 5.1 decodes it as ANSI; one non-ASCII byte
  // there once stopped the whole script parsing.
  const ps1 = join(root, "install.ps1");
  if (existsSync(ps1)) {
    const buf = readFileSync(ps1);
    const bad = [...buf].findIndex((b) => b > 0x7e || (b < 0x09 && b !== 0x0a && b !== 0x0d));
    if (bad !== -1) fail("install.ps1", `byte ${bad} is 0x${buf[bad].toString(16)}, outside ASCII`);
  }
}

// Keys that live at the TOP level of a Codex config. Written below a `[section]` header
// they silently become `section.key`, which Codex does not know and ignores without a
// word - so a profile can look frugal and do nothing. This shipped once: four keys sat
// under `[features]`, and `codex debug prompt-input` measured the top-level form of
// include_permissions_instructions removing 3,939 characters against the prefixed form
// removing 0. The authoritative check is `codex mcp-server --strict-config`, which needs
// Codex; this is the CI-runnable version of the same rule.
const TOP_LEVEL_KEYS = new Set([
  "include_permissions_instructions",
  "include_environment_context",
  "include_apps_instructions",
  "project_doc_max_bytes",
  "tool_output_token_limit",
  "model_reasoning_effort",
  "model_verbosity",
  "model_reasoning_summary",
  "model_context_window",
  "model",
  "approval_policy",
  "sandbox_mode",
]);

function checkProfiles(root) {
  const dir = join(root, "profiles");
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".toml"))) {
    const where = `profiles/${file}`;
    let section = "";
    let lineNo = 0;
    for (const raw of readFileSync(join(dir, file), "utf8").split(/\r?\n/)) {
      lineNo++;
      const line = raw.replace(/#.*$/, "").trim();
      if (!line) continue;
      const header = line.match(/^\[([A-Za-z0-9_.]+)\]$/);
      if (header) {
        section = header[1];
        continue;
      }
      const kv = line.match(/^([A-Za-z0-9_]+)\s*=/);
      if (!kv) {
        fail(where, `line ${lineNo} is neither a comment, a [section] nor key = value: ${raw.trim()}`);
        continue;
      }
      if (section && TOP_LEVEL_KEYS.has(kv[1])) {
        fail(
          where,
          `line ${lineNo}: \`${kv[1]}\` is a top-level key but sits under [${section}], so Codex reads it ` +
            `as ${section}.${kv[1]} and silently ignores it. Move it above the first [section] header.`,
        );
      }
    }
  }
}

// Every image a README points at must exist in the repository, and the URL must name this
// repository and branch. The READMEs use absolute raw URLs so the markdown still renders
// when it is copied out of the repo, which means a typo or a renamed asset cannot be caught
// by "the file is next to the markdown" - only by checking the URL against the tree.
const RAW_PREFIX = "https://raw.githubusercontent.com/sup3x/codex-eco/main/";

function checkReadmeImages(root) {
  for (const file of ["README.md", "README.tr.md"]) {
    const path = join(root, file);
    if (!existsSync(path)) {
      fail(file, "missing");
      continue;
    }
    const text = readFileSync(path, "utf8");
    let found = 0;
    for (const m of text.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const url = m[1];
      if (url.startsWith("https://img.shields.io/")) continue; // badges are third-party
      found++;
      if (!url.startsWith(RAW_PREFIX)) {
        fail(file, `image "${url}" is not an absolute ${RAW_PREFIX}... url, so it breaks when the markdown is copied`);
        continue;
      }
      const rel = url.slice(RAW_PREFIX.length);
      if (!existsSync(join(root, rel))) fail(file, `image "${url}" points at ${rel}, which is not in the repository`);
    }
    // Also check the link targets wrapping those images, which are the SVG sources.
    for (const m of text.matchAll(/\[!\[[^\]]*\]\([^)]+\)\]\(([^)\s]+)\)/g)) {
      const url = m[1];
      if (!url.startsWith(RAW_PREFIX)) continue;
      const rel = url.slice(RAW_PREFIX.length);
      if (!existsSync(join(root, rel))) fail(file, `image link target ${rel} is not in the repository`);
    }
    if (!found) notes.push(`${file}: no images found, which is suspicious for this project`);
    else notes.push(`${file}: ${found} image(s), all present and absolute`);
  }
}

/** The plugin's own version must match package.json, or an update never reaches users. */
function checkVersionSync(root) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const plugin = JSON.parse(readFileSync(join(root, "plugins", "eco", ".codex-plugin", "plugin.json"), "utf8"));
  const market = JSON.parse(readFileSync(join(root, ".agents", "plugins", "marketplace.json"), "utf8"));
  const entry = market.plugins?.find((p) => p.name === plugin.name);
  if (pkg.version !== plugin.version) fail("versions", `package.json ${pkg.version} != plugin.json ${plugin.version}`);
  if (entry?.version && entry.version !== plugin.version) {
    fail("versions", `marketplace entry ${entry.version} != plugin.json ${plugin.version}`);
  }
}

function main() {
  const pluginRoot = join(REPO, "plugins", "eco");
  const skillsRoot = join(pluginRoot, "skills");
  if (!existsSync(skillsRoot)) {
    console.error("no plugins/eco/skills directory");
    return 2;
  }
  for (const name of readdirSync(skillsRoot)) {
    const dir = join(skillsRoot, name);
    if (statSync(dir).isDirectory()) checkSkill(dir, name);
  }
  checkPlugin(pluginRoot);
  checkMarketplace(REPO);
  checkRuleBlocks(REPO);
  checkProfiles(REPO);
  checkReadmeImages(REPO);
  checkVersionSync(REPO);

  for (const n of notes) console.log(`note  ${n}`);
  if (problems.length) {
    for (const p of problems) console.error(`FAIL  ${p}`);
    console.error(
      `\n${problems.length} problem(s). These are the rules Codex's own validators enforce;\n` +
        `run them locally for the authoritative answer:\n` +
        `  python3 "$CODEX_HOME/skills/.system/skill-creator/scripts/quick_validate.py" plugins/eco/skills/eco\n` +
        `  python3 "$CODEX_HOME/skills/.system/plugin-creator/scripts/validate_plugin.py" plugins/eco`,
    );
    return 1;
  }
  console.log("ok: skills, plugin manifest, marketplace and versions all satisfy the Codex schema rules");
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
