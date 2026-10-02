import "dotenv/config";
import Database from "better-sqlite3";
import { resolve, join } from "node:path";
import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  mkdirSync,
} from "node:fs";
import { createHash } from "node:crypto";
const backupArg = process.argv[2],
  targetArg = process.argv[3];
if (!backupArg || !targetArg)
  throw Error(
    "Usage: restore BACKUP_DIRECTORY NEW_DATA_DIRECTORY. Stop the app before switching DATA_DIR.",
  );
const source = resolve(backupArg),
  target = resolve(targetArg);
if (source === target || (existsSync(target) && readdirSync(target).length))
  throw Error(
    "Restore target must be empty; existing data is never overwritten",
  );
const manifest = JSON.parse(
  readFileSync(join(source, "manifest.json"), "utf8"),
);
for (const [file, hash] of Object.entries(manifest.hashes)) {
  if (!/^(webmind\.sqlite|assets\/[a-zA-Z0-9-]+)$/.test(file))
    throw Error("Invalid backup path");
  if (
    createHash("sha256")
      .update(readFileSync(join(source, file)))
      .digest("hex") !== hash
  )
    throw Error(`Checksum mismatch: ${file}`);
}
const db = new Database(join(source, "webmind.sqlite"), {
  readonly: true,
  fileMustExist: true,
});
if (db.pragma("quick_check", { simple: true }) !== "ok")
  throw Error("Database integrity check failed");
db.close();
mkdirSync(target, { recursive: true });
cpSync(join(source, "webmind.sqlite"), join(target, "webmind.sqlite"));
cpSync(join(source, "assets"), join(target, "assets"), { recursive: true });
console.log(
  `Restored to ${target}. Configure DATA_DIR before starting the app.`,
);
