import { it, expect } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
it("backs up and restores a consistent database and assets without overwriting existing data", () => {
  const temp = mkdtempSync(join(tmpdir(), "webmind-backup-"));
  try {
    const source = join(temp, "source"),
      backup = join(temp, "backup"),
      target = join(temp, "restored");
    mkdirSync(join(source, "assets"), { recursive: true });
    writeFileSync(join(source, "assets", "test-image"), "image bytes");
    const db = new Database(join(source, "webmind.sqlite"));
    db.exec(
      "CREATE TABLE sample(id TEXT); INSERT INTO sample VALUES('preserved');",
    );
    db.close();
    const run = (script: string, args: string[], env: NodeJS.ProcessEnv = {}) =>
      execFileSync(process.execPath, ["--import", "tsx", script, ...args], {
        env: { ...process.env, ...env },
        stdio: "pipe",
      });
    run("scripts/backup.ts", ["--offline-confirmed"], {
      DATA_DIR: source,
      BACKUP_DIR: backup,
    });
    run("scripts/restore.ts", [backup, target]);
    expect(readFileSync(join(target, "assets", "test-image"), "utf8")).toBe(
      "image bytes",
    );
    const restored = new Database(join(target, "webmind.sqlite"));
    expect(restored.prepare("SELECT id FROM sample").get()).toEqual({
      id: "preserved",
    });
    restored.close();
    expect(() => run("scripts/restore.ts", [backup, target])).toThrow();
    writeFileSync(join(backup, "assets", "test-image"), "tampered");
    expect(() =>
      run("scripts/restore.ts", [backup, join(temp, "tampered-target")]),
    ).toThrow();
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}, 20000);
