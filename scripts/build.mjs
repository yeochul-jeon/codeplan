// Bundles the CLI into one dependency-free file.
//   node scripts/build.mjs            writes skill/codeplan/codeplan.mjs
//   node scripts/build.mjs <outfile>  writes <outfile>
//   node scripts/build.mjs --check    exits 1 if skill/codeplan/codeplan.mjs
//                                     differs from a fresh build
// The output is the same bytes from any working directory: paths in the
// bundle are relative to the repository root and nothing holds a time.
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const committed = join(root, "skill/codeplan/codeplan.mjs");
const checking = process.argv[2] === "--check";
const outfile = checking ? committed : (process.argv[2] ?? committed);

const result = await build({
  absWorkingDir: root,
  entryPoints: [join(root, "src/bin.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  logLevel: "warning",
  write: false,
});
const bytes = result.outputFiles[0].contents;

if (checking) {
  let current = null;
  try {
    current = readFileSync(committed);
  } catch {
    // reported below
  }
  if (current === null || !Buffer.from(bytes).equals(current)) {
    console.error("skill/codeplan/codeplan.mjs differs from a fresh build; run npm run build and commit it");
    process.exit(1);
  }
} else {
  mkdirSync(dirname(outfile), { recursive: true });
  writeFileSync(outfile, bytes);
}
