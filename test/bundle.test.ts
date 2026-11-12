import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { lines, makeRepo, plan } from "./helpers.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("the bundled codeplan.mjs runs update and check from under home", () => {
  const repo = makeRepo({
    "build.gradle.kts": lines(2),
    "src/main/java/org/harbor/Dock.java": lines(4),
    "docs/codeplan/patches/Patch.java": lines(2),
    "docs/codeplan/plan.json": plan({ harbor: ["src/*/*/org/harbor/**"] }),
  });
  const bundle = join(repo, "docs/codeplan/codeplan.mjs");
  const built = spawnSync(process.execPath, [join(root, "scripts/build.mjs"), bundle], {
    encoding: "utf8",
    timeout: 60_000,
  });
  expect(built.status, built.stderr).toBe(0);
  expect(readFileSync(bundle, "utf8")).not.toMatch(/from\s+["'](?!node:)[^"']+["']/);

  const written = spawnSync(process.execPath, ["docs/codeplan/codeplan.mjs", "update"], {
    cwd: repo,
    encoding: "utf8",
    timeout: 30_000,
  });
  expect(written.status, written.stderr).toBe(0);
  expect(readFileSync(join(repo, "docs/codeplan/codeplan.html"), "utf8")).toMatch(/^<!doctype html><!-- codeplan page -->/);

  const out = spawnSync(process.execPath, ["docs/codeplan/codeplan.mjs", "check"], {
    cwd: repo,
    encoding: "utf8",
    timeout: 30_000,
  });
  expect(out.status, out.stderr).toBe(0);
  expect(out.stdout).toContain("part harbor: 1 files, 4 lines");
  expect(out.stdout).toContain("check: ok");
});
