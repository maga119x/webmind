import "dotenv/config";
import Database from "better-sqlite3";
import { resolve, join } from "node:path";
import {
  mkdirSync,
  cpSync,
  writeFileSync,
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
if (!process.argv.includes("--offline-confirmed"))
  throw Error(
    "Stop the app first, then pass --offline-confirmed. Backups require an offline app to keep database and assets consistent.",
  );
const source = resolve(process.env.DATA_DIR ?? "data"),
  target = resolve(
    process.env.BACKUP_DIR ??
      `backups/${new Date().toISOString().replace(/[:.]/g, "-")}`,
  );
if (
  target === source ||
  target.startsWith(source + "/") ||
  target.startsWith(source + "\\") ||
  existsSync(target)
)
  throw Error("Backup target must be a new directory outside DATA_DIR");
mkdirSync(target, { recursive: true });
const db = new Database(join(source, "webmind.sqlite"), {
  readonly: true,
  fileMustExist: true,
});
await db.backup(join(target, "webmind.sqlite"));
db.close();
cpSync(join(source, "assets"), join(target, "assets"), { recursive: true });
const files = [
  "webmind.sqlite",
  ...readdirSync(join(target, "assets")).map((f) => "assets/" + f),
];
const hashes = Object.fromEntries(
  files.map((f) => [
    f,
    createHash("sha256")
      .update(readFileSync(join(target, f)))
      .digest("hex"),
  ]),
);
writeFileSync(
  join(target, "manifest.json"),
  JSON.stringify(
    { version: 1, createdAt: new Date().toISOString(), hashes },
    null,
    2,
  ),
);
console.log(target);
