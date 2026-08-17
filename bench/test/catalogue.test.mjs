import test from "node:test";
import assert from "node:assert/strict";
import { findDuplicateSkills } from "../../scripts/prefix-audit.mjs";
import { catalogue, duplicateSkills, promptText } from "../lib/preflight.mjs";

// Shape copied from a real `codex debug prompt-input` render, trimmed. The two `eco`
// lines are the defect this detects: one copy staged in a project, one left over in
// $HOME/.agents/skills, both published to the model under the same name.
const CATALOGUE = `<skills_instructions>
## Skills
### Available skills
- imagegen: Generate or edit raster images when the task benefits from bitmaps. (file: C:/Users/Kerim/.codex/skills/.system/imagegen/SKILL.md)
- eco: Token-frugal mode for Codex - fewer tokens per turn at full task quality. (file: C:/tmp/ws/.agents/skills/eco/SKILL.md)
- eco: Token-frugal mode - minimize token consumption at full task quality. (file: C:/Users/Kerim/.agents/skills/eco/SKILL.md)
- eco-max: The same rules at the tightest reply budget. (file: C:/Users/Kerim/.agents/skills/eco-max/SKILL.md)
- browser:control-in-app-browser: Control the in-app Browser. (file: C:/x/skills/control-in-app-browser/SKILL.md)
</skills_instructions>`;

const rendered = [{ role: "developer", content: [{ type: "input_text", text: CATALOGUE }] }];

test("the catalogue parser finds every published skill and its file", () => {
  const rows = catalogue(rendered);
  assert.equal(rows.length, 5);
  assert.deepEqual(
    rows.map((r) => r.name),
    ["imagegen", "eco", "eco", "eco-max", "browser:control-in-app-browser"],
  );
  assert.ok(rows[1].file.endsWith("/ws/.agents/skills/eco/SKILL.md"));
});

test("a name published twice is reported, and a name published once is not", () => {
  const dupes = duplicateSkills(catalogue(rendered));
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].name, "eco");
  assert.equal(dupes[0].files.length, 2);
});

test("the audit reports the duplicated description as waste", () => {
  const found = findDuplicateSkills(promptText(rendered));
  assert.equal(found.length, 1);
  assert.equal(found[0].name, "eco");
  assert.equal(found[0].copies.length, 2);
  // Only the extra copies count as waste; the first one you were always going to pay for.
  assert.ok(found[0].wastedChars > 40, `wastedChars was ${found[0].wastedChars}`);
});

test("a clean catalogue produces no findings", () => {
  const clean = [
    {
      role: "developer",
      content: [{ type: "input_text", text: "- eco: only one copy. (file: /home/u/.agents/skills/eco/SKILL.md)" }],
    },
  ];
  assert.deepEqual(findDuplicateSkills(promptText(clean)), []);
  assert.deepEqual(duplicateSkills(catalogue(clean)), []);
});

test("skill names with a plugin prefix are not confused with each other", () => {
  const rows = catalogue(rendered);
  const names = rows.filter((r) => r.name.includes(":"));
  assert.equal(names.length, 1);
  assert.equal(names[0].name, "browser:control-in-app-browser");
});
