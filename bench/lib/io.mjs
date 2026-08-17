// Filesystem helpers shared by the eco benchmark tooling.

// through here.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const BENCH_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const REPO_DIR = resolve(BENCH_DIR, "..");
export const RAW_DIR = join(BENCH_DIR, "raw");

/** Strip a UTF-8 BOM and any leading whitespace before the first JSON token. */
export function stripBom(text) {
  return text.replace(/^\uFEFF/, "");
}

export function readText(file) {
  return stripBom(readFileSync(file, "utf8"));
}

export function readJson(file) {
  const text = readText(file);
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${file}: not valid JSON (${err.message})`);
  }
}

/** Write JSON without a BOM, LF-terminated, creating parent directories. */
export function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tmp, file);
  return file;
}

export function writeTextFile(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, "utf8");
  return file;
}

/** All raw run files, sorted, as { id, file } — id is the basename without .json. */
export function listRawRuns(dir = RAW_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ id: f.replace(/\.json$/, ""), file: join(dir, f) }));
}

export function loadRawRun(id, dir = RAW_DIR) {
  const file = join(dir, `${id}.json`);
  if (!existsSync(file)) throw new Error(`raw run not found: ${file}`);
  return readJson(file);
}
