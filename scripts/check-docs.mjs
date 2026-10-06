import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const requiredFiles = [
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  "CONTRIBUTING.md",
  "README.md",
  ".github/copilot-instructions.md",
  ".cursor/rules/webmind.mdc",
  ".github/pull_request_template.md",
  ...[
    "README",
    "CURRENT_STATUS",
    "DEVELOPMENT",
    "ARCHITECTURE",
    "DATA_API",
    "DECISIONS",
    "TROUBLESHOOTING",
    "DOCUMENTATION",
    "FEATURES",
    "MOVEMENT",
    "GOOGLE_DRIVE",
    "SERVER",
    "DEPLOYMENT",
    "VALIDATION",
  ].map((name) => `docs/${name}.md`),
];
const entrypoints = [
  "CLAUDE.md",
  "GEMINI.md",
  ".github/copilot-instructions.md",
  ".cursor/rules/webmind.mdc",
];
const implementation =
  /^(?:(?:src|shared|server|public|deploy|scripts|tests)\/|\.github\/workflows\/|(?:package(?:-lock)?\.json|(?:vite|vitest|playwright|tsconfig)[^/]*|Dockerfile|compose[^/]*|\.env\.example|\.dockerignore)$)/;
const substantiveDoc = /^docs\/(?!README\.md$)[^/]+\.md$/;

function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
function paths(output) {
  return output.split("\0").filter(Boolean);
}
function withoutCode(markdown) {
  let fence;
  return markdown
    .split(/\r?\n/)
    .map((line) => {
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (marker && !fence) {
        fence = marker[1];
        return "";
      }
      if (fence) {
        if (
          marker &&
          marker[1][0] === fence[0] &&
          marker[1].length >= fence.length
        )
          fence = undefined;
        return "";
      }
      return line.replace(/`+[^`]*`+/g, "");
    })
    .join("\n");
}

export function checkRepository(root, base) {
  const errors = [];
  const inventory = new Set(
    paths(
      git(root, [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
      ]),
    ),
  );
  const present = (name) =>
    inventory.has(name) && existsSync(resolve(root, name));
  for (const file of requiredFiles) {
    if (!present(file)) errors.push(`Missing required file: ${file}`);
  }
  for (const file of entrypoints.filter(present)) {
    const content = readFileSync(resolve(root, file), "utf8");
    for (const target of [
      "AGENTS.md",
      "docs/README.md",
      "docs/CURRENT_STATUS.md",
      "docs/DEVELOPMENT.md",
    ]) {
      if (!content.includes(target))
        errors.push(`${file}: must refer to ${target}`);
    }
    if (file.endsWith(".mdc") && !/^alwaysApply:\s*true\s*$/m.test(content)) {
      errors.push(`${file}: must set alwaysApply: true`);
    }
  }
  let documents = 0;
  let links = 0;
  for (const file of [...inventory].filter(
    (name) => /\.(md|mdc)$/i.test(name) && present(name),
  )) {
    documents++;
    const content = withoutCode(readFileSync(resolve(root, file), "utf8"));
    const targets = [
      ...[
        ...content.matchAll(/\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^\s)]+))/g),
      ].map((match) => match[1] ?? match[2]),
      ...[
        ...content.matchAll(/^\s{0,3}\[[^\]\n]+\]:\s*(?:<([^>\n]+)>|(\S+))/gm),
      ].map((match) => match[1] ?? match[2]),
      ...[...content.matchAll(/^@(\S+)\s*$/gm)].map((match) => match[1]),
    ];
    for (const target of targets) {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target)) continue;
      let path;
      try {
        path = decodeURIComponent(target.split(/[?#]/)[0]);
      } catch {
        errors.push(`${file}: malformed link ${target}`);
        continue;
      }
      if (!path) continue;
      links++;
      const absolute = resolve(dirname(resolve(root, file)), path);
      const local = relative(root, absolute).split(sep).join("/");
      const directory =
        existsSync(absolute) && statSync(absolute).isDirectory();
      if (
        local.startsWith("../") ||
        !existsSync(absolute) ||
        (directory
          ? ![...inventory].some((item) => item.startsWith(`${local}/`))
          : !inventory.has(local))
      ) {
        errors.push(
          `${file}: broken/untracked or case-mismatched link ${target}`,
        );
      }
    }
  }
  let changePolicy = "not checked (no base; structural checks only)";
  if (base) {
    changePolicy = "base validation failed";
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(base)) {
      errors.push("Base must be a full Git commit SHA.");
    } else if (/^0+$/.test(base)) {
      changePolicy = "skipped for initial push (zero base)";
    } else {
      try {
        git(root, ["cat-file", "-e", `${base}^{commit}`]);
        const changed = new Set([
          ...paths(
            git(root, [
              "diff",
              "--name-only",
              "--no-renames",
              "-z",
              base,
              "--",
            ]),
          ),
          ...paths(
            git(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
          ),
        ]);
        const source = [...changed].filter((file) => implementation.test(file));
        const docs = [...changed].filter(
          (file) => substantiveDoc.test(file) && present(file),
        );
        changePolicy = `${source.length} implementation/config/test changes, ${docs.length} documentation changes`;
        if (source.length && !docs.length) {
          errors.push(
            `Update a relevant docs/*.md file with this change (docs/README.md alone is insufficient): ${source.join(", ")}`,
          );
        }
      } catch {
        errors.push(
          `Cannot compare base ${base}; fetch its Git history before running docs:check.`,
        );
      }
    }
  }
  return { errors, documents, links, changePolicy };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--base")) {
      throw Error("Usage: npm run docs:check -- [--base FULL_COMMIT_SHA]");
    }
    const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
    const result = checkRepository(root, args[1] ?? process.env.DOCS_BASE_SHA);
    console.log(
      `Documentation: ${result.documents} files, ${result.links} local references; ${result.changePolicy}.`,
    );
    for (const error of result.errors) console.error(error);
    process.exitCode = result.errors.length ? 1 : 0;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
