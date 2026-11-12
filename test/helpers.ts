import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect } from "vitest";
import { check, run } from "../src/cli.js";

const created: string[] = [];

afterEach(() => {
  while (created.length > 0) rmSync(created.pop()!, { recursive: true, force: true });
});

// A fresh temporary directory, removed after the test.
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "codeplan-test-"));
  created.push(dir);
  return dir;
}

export type Tree = Record<string, string>;

export function writeTree(root: string, files: Tree): string {
  for (const [path, content] of Object.entries(files)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return root;
}

export function makeRepo(files: Tree): string {
  return writeTree(tempDir(), files);
}

// A plan file whose parts have the given paths and every other field filled.
export function plan(parts: Record<string, unknown>): string {
  return JSON.stringify({
    format: 1,
    name: "test",
    about: "test repository",
    parts: Object.entries(parts).map(([id, paths]) => ({ id, name: id, about: "", paths })),
    externals: [],
    scenarios: [],
  });
}

// `n` lines of text, each ending with LF.
export const lines = (n: number) => "x\n".repeat(n);

export interface Expected {
  parts?: Record<string, [files: number, lines: number]>;
  orphans?: string[];
  contested?: string[];
  unwatched?: string[];
  // Warnings as "<code>" or "<code> <part id>", e.g. "empty-part b".
  warnings?: string[];
  code: 0 | 1 | 2;
}

export function expectCheck(repo: string, expected: Expected, cwd = repo): void {
  const argv = cwd === repo ? ["check"] : ["check", "--repo", repo];
  // The page is written first, as a user would before check.
  run(argv[0] === "check" ? ["update", ...argv.slice(1)] : argv, cwd);
  const out = run(argv, cwd);
  expect(out.code, out.stderr).toBe(expected.code);
  if (expected.code === 2) return;
  const result = check(repo);
  if (result.kind !== "measured") throw new Error(result.message);
  const m = result.measurement;
  if (expected.parts) {
    const actual = Object.fromEntries(m.parts.map((p) => [p.id, [p.files, p.lines]]));
    expect(actual).toEqual(expected.parts);
  }
  expect(m.orphans).toEqual(expected.orphans ?? []);
  expect(m.contested.map((c) => c.path)).toEqual(expected.contested ?? []);
  expect(m.unwatched).toEqual(expected.unwatched ?? []);
  if (expected.warnings) {
    const actual = result.diagnostics.map((w) => {
      const part = /^part "([^"]+)"/.exec(w.message)?.[1];
      return part === undefined ? w.code : `${w.code} ${part}`;
    });
    expect(actual).toEqual(expected.warnings);
  }
}
