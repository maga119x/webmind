import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { checkRepository, requiredFiles } from "../scripts/check-docs.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "webmind-docs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" });
  const write = (file, content = "# Documentation\n") => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  };
  git("init");
  for (const file of requiredFiles) write(file);
  const refs =
    "Read AGENTS.md docs/README.md docs/CURRENT_STATUS.md docs/DEVELOPMENT.md\n";
  for (const file of [
    "CLAUDE.md",
    "GEMINI.md",
    ".github/copilot-instructions.md",
  ])
    write(file, refs);
  write(".cursor/rules/webmind.mdc", `---\nalwaysApply: true\n---\n${refs}`);
  write("src/example.ts", "export const value = 1;\n");
  git("add", ".");
  git(
    "-c",
    "user.name=Docs Test",
    "-c",
    "user.email=docs@example.invalid",
    "-c",
    "commit.gpgSign=false",
    "commit",
    "-m",
    "fixture",
  );
  return { root, write, git, base: git("rev-parse", "HEAD").trim() };
}

test("links, imports, encoded paths and code-block examples are handled", (t) => {
  const { root, write } = fixture(t);
  write("docs/space name.md");
  write(
    "README.md",
    "[intro](docs/README.md#heading)\n[spaces](docs/space%20name.md)\n[ref][id]\n[id]: docs/DEVELOPMENT.md\n[external](https://example.invalid/missing)\n```md\n[example](missing.md)\n```\n`[inline](missing.md)`\n",
  );
  write(
    "CLAUDE.md",
    "@AGENTS.md\nRead docs/README.md docs/CURRENT_STATUS.md docs/DEVELOPMENT.md\n",
  );
  assert.deepEqual(checkRepository(root).errors, []);
});

test("missing documents and instruction references fail", (t) => {
  const { root, write } = fixture(t);
  rmSync(join(root, "docs/CURRENT_STATUS.md"));
  write("GEMINI.md", "# Empty instructions\n");
  write(
    ".cursor/rules/webmind.mdc",
    "AGENTS.md docs/README.md docs/CURRENT_STATUS.md docs/DEVELOPMENT.md\n",
  );
  const errors = checkRepository(root).errors.join("\n");
  assert.match(errors, /Missing required file: docs\/CURRENT_STATUS/);
  assert.match(errors, /GEMINI.md: must refer to AGENTS/);
  assert.match(errors, /alwaysApply/);
});

test("broken, case-mismatched, untracked ignored links and imports fail", (t) => {
  const { root, write } = fixture(t);
  write(".gitignore", "private.md\n");
  write("private.md");
  write(
    "README.md",
    "[bad](docs/missing.md)\n[case](docs/development.md)\n[private](private.md)\n@missing-import.md\n",
  );
  assert.equal(checkRepository(root).errors.length, 4);
});

test("implementation changes require a substantive documentation change", (t) => {
  const { root, write, base } = fixture(t);
  write("src/example.ts", "export const value = 2;\n");
  appendFileSync(join(root, "docs/README.md"), "New index entry\n");
  assert.match(
    checkRepository(root, base).errors.join("\n"),
    /Update a relevant docs/,
  );
  appendFileSync(join(root, "docs/DATA_API.md"), "Changed value contract\n");
  assert.deepEqual(checkRepository(root, base).errors, []);
});

test("source deletions and untracked additions are included", (t) => {
  const { root, write, base } = fixture(t);
  rmSync(join(root, "src/example.ts"));
  assert.match(
    checkRepository(root, base).errors.join("\n"),
    /Update a relevant docs/,
  );
  write("src/example.ts", "export const value = 1;\n");
  write("server/new.ts", "export {};\n");
  assert.match(checkRepository(root, base).errors.join("\n"), /server\/new.ts/);
  write("docs/new-contract.md", "New API contract\n");
  assert.deepEqual(checkRepository(root, base).errors, []);
});

test("documentation deletion alone does not satisfy change policy", (t) => {
  const { root, write, git } = fixture(t);
  write("docs/extra.md");
  git("add", ".");
  git(
    "-c",
    "user.name=Docs Test",
    "-c",
    "user.email=docs@example.invalid",
    "-c",
    "commit.gpgSign=false",
    "commit",
    "-m",
    "extra doc",
  );
  const base = git("rev-parse", "HEAD").trim();
  rmSync(join(root, "docs/extra.md"));
  write("src/example.ts", "export const value = 3;\n");
  assert.match(
    checkRepository(root, base).errors.join("\n"),
    /Update a relevant docs/,
  );
});

test("documentation-only changes pass without requiring product changes", (t) => {
  const { root, write, base } = fixture(t);
  write("README.md", "Updated introduction\n");
  assert.deepEqual(checkRepository(root, base).errors, []);
});

test("invalid or unavailable bases fail and initial push is explicit", (t) => {
  const { root } = fixture(t);
  assert.match(
    checkRepository(root, "--unsafe").errors.join("\n"),
    /full Git commit SHA/,
  );
  assert.match(
    checkRepository(root, "a".repeat(40)).errors.join("\n"),
    /Cannot compare base/,
  );
  const first = checkRepository(root, "0".repeat(40));
  assert.deepEqual(first.errors, []);
  assert.match(first.changePolicy, /initial push/);
});
