import { build } from "esbuild";
await build({
  entryPoints: [
    "scripts/backup.ts",
    "scripts/restore.ts",
    "scripts/load-test.ts",
  ],
  outdir: "dist/scripts",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
});
