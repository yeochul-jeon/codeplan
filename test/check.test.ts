import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { check, run } from "../src/cli.js";
import { expectCheck, lines, makeRepo, plan, type Tree } from "./helpers.js";

describe("ownership", () => {
  test("a one-character set makes the stronger pattern win", () => {
    const repo = makeRepo({
      "views/[slug]/show.tsx": lines(3),
      "views/index.tsx": lines(1),
      "docs/codeplan/plan.json": plan({ a: ["views/**"], b: ["views/[[]slug]/**"] }),
    });
    expectCheck(repo, { parts: { a: [1, 1], b: [1, 3] }, code: 0 });
  });

  test("two patterns of the same part at the same strength are not contested", () => {
    const repo = makeRepo({
      "src/a.ts": lines(1),
      "docs/codeplan/plan.json": plan({ a: ["src/*.ts", "src/**"] }),
    });
    expectCheck(repo, { parts: { a: [1, 1] }, code: 0 });
  });

  test("the longer fixed prefix wins", () => {
    const repo = makeRepo({
      "src/x/a.ts": lines(1),
      "src/y.ts": lines(1),
      "docs/codeplan/plan.json": plan({ outer: ["src/**"], inner: ["src/x/**"] }),
    });
    expectCheck(repo, { parts: { outer: [1, 1], inner: [1, 1] }, code: 0 });
  });

  test("contested files go to the first part id in code-unit order", () => {
    const repo = makeRepo({
      "src/a.ts": lines(2),
      "docs/codeplan/plan.json": plan({ a1: ["src/**"], "a-b": ["src/**"] }),
    });
    expectCheck(repo, {
      parts: { a1: [0, 0], "a-b": [1, 2] },
      contested: ["src/a.ts"],
      code: 1,
    });
  });
});

describe("watch set", () => {
  test("dot directories and dot files are not watched or reported", () => {
    const repo = makeRepo({
      "src/a.ts": lines(1),
      ".claude/hook.mjs": lines(1),
      ".github/scripts/x.js": lines(1),
      "src/.hidden/b.ts": lines(1),
      ".eslintrc.cjs": lines(1),
      "docs/codeplan/plan.json": plan({ all: ["**"] }),
    });
    expectCheck(repo, { parts: { all: [1, 1] }, code: 0 });
  });

  test("a written watch can reach a dot directory when it names it", () => {
    const repo = makeRepo({
      ".storybook/main.ts": lines(1),
      "docs/codeplan/plan.json": plan({ sb: [".storybook/**"] }),
      "codeplan.json": '{ "watch": [".storybook/**/*.ts"] }',
    });
    expectCheck(repo, { parts: { sb: [1, 1] }, code: 0 });
  });

  test("symbolic links are not followed", () => {
    const repo = makeRepo({
      "src/a.ts": lines(1),
      "docs/codeplan/plan.json": plan({ all: ["src/**"] }),
    });
    symlinkSync(join(repo, "src"), join(repo, "linked"));
    symlinkSync(join(repo, "src/a.ts"), join(repo, "src/b.ts"));
    expectCheck(repo, { parts: { all: [1, 1] }, code: 0 });
  });

  test("a java build-output name is skipped before a source root and kept after it", () => {
    const repo = makeRepo({
      "pom.xml": lines(1),
      "m/src/main/java/org/gearbox/build/Gear.java": lines(1),
      "build/gen/src/main/java/B.java": lines(1),
      "docs/codeplan/plan.json": plan({ all: ["**"] }),
    });
    expectCheck(repo, { parts: { all: [1, 1] }, code: 0 });
  });

  test(".git is not entered even when a written watch names it", () => {
    const repo = makeRepo({
      ".git/hooks/x.js": lines(1),
      "src/a.ts": lines(1),
      "docs/codeplan/plan.json": plan({ all: ["**"] }),
      "codeplan.json": '{ "watch": [".git/**", "src/**"] }',
    });
    expectCheck(repo, { parts: { all: [1, 1] }, code: 0 });
  });

  test("target as a java package name is measured", () => {
    const repo = makeRepo({
      "pom.xml": lines(1),
      "src/main/java/org/gearbox/target/Gear.java": lines(1),
      "docs/codeplan/plan.json": plan({ x: ["src/main/java/org/gearbox/**"] }),
    });
    expectCheck(repo, { parts: { x: [1, 1] }, code: 0 });
  });

  test("a js-only repository with the default config has no unwatched files", () => {
    const repo = makeRepo({
      "a.ts": lines(1),
      "web/x.vue": lines(1),
      "lib/y.mjs": lines(1),
      "dist/z.js": lines(1),
      "docs/codeplan/plan.json": plan({ all: ["**"] }),
    });
    const result = check(repo);
    if (result.kind !== "measured") throw new Error(result.message);
    expect(result.measurement.unwatched).toEqual([]);
  });

  test("a root dot file in a js repository is neither watched nor unwatched", () => {
    const repo = makeRepo({
      ".eslintrc.cjs": lines(1),
      "src/a.ts": lines(1),
      "docs/codeplan/plan.json": plan({ src: ["src/**"] }),
    });
    expectCheck(repo, { parts: { src: [1, 1] }, code: 0 });
  });

  test("watched files = owned files + orphans", () => {
    const repo = makeRepo({
      "src/a/1.ts": lines(1),
      "src/a/2.ts": lines(1),
      "src/b/3.ts": lines(1),
      "src/c/4.ts": lines(1),
      "docs/codeplan/plan.json": plan({ a: ["src/a/**"], b: ["src/b/**"] }),
    });
    const result = check(repo);
    if (result.kind !== "measured") throw new Error(result.message);
    const m = result.measurement;
    const owned = m.parts.reduce((sum, p) => sum + p.files, 0);
    expect(m.watchedFiles).toBe(owned + m.orphans.length);
    expect(m.watchedFiles).toBe(4);
  });
});

describe("check command", () => {
  const tree: Tree = { "src/a.ts": lines(1) };

  test("no plan file: every watched file is an orphan, with a warning", () => {
    const repo = makeRepo(tree);
    expectCheck(repo, { parts: {}, orphans: ["src/a.ts"], code: 1 });
    expect(run(["check"], repo).stderr).toContain("no-plan");
  });

  test("no plan file and nothing watched still exits 1", () => {
    expect(run(["check"], makeRepo({ "readme.md": "x" })).code).toBe(1);
  });

  test("a part that owns nothing is a warning and exits 1 on its own", () => {
    const repo = makeRepo({
      ...tree,
      "docs/codeplan/plan.json": plan({ a: ["src/**"], b: ["lib/**"] }),
    });
    expectCheck(repo, { parts: { a: [1, 1], b: [0, 0] }, code: 1 });
    expect(run(["check"], repo).stderr).toContain("empty-part");
  });

  test("a plan file that is not JSON exits 2", () => {
    expect(run(["check"], makeRepo({ ...tree, "docs/codeplan/plan.json": "{" })).code).toBe(2);
  });

  test("a part without paths exits 2 without crashing", () => {
    const planFile = JSON.stringify({ parts: [{ id: "a" }] });
    const out = run(["check"], makeRepo({ ...tree, "docs/codeplan/plan.json": planFile }));
    expect(out.code).toBe(2);
    expect(out.stderr).toContain("paths");
  });

  test("a part with an empty paths array exits 2", () => {
    const repo = makeRepo({ ...tree, "docs/codeplan/plan.json": plan({ a: [] }) });
    expect(run(["check"], repo).code).toBe(2);
  });

  test("long lists show 30 entries and the rest as a count", () => {
    const files: Tree = { "docs/codeplan/plan.json": plan({ none: ["nothing/**"] }) };
    for (let i = 0; i < 31; i++) files[`src/f${String(i).padStart(2, "0")}.ts`] = lines(1);
    const out = run(["check"], makeRepo(files));
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("orphan files: no part owns them (31)");
    expect(out.stderr).toContain("src/f29.ts");
    expect(out.stderr).not.toContain("src/f30.ts");
    expect(out.stderr).toContain("... and 1 more");
  });

  test("every problem list carries a fix line", () => {
    const repo = makeRepo({
      "src/a.ts": lines(1),
      "src/b/c.ts": lines(1),
      "web/d.ts": lines(1),
      "docs/codeplan/plan.json": plan({ p: ["src/b/**"], q: ["src/b/**"] }),
      "codeplan.json": '{ "watch": ["src/**"] }',
    });
    const out = run(["check"], repo);
    expect(out.code).toBe(1);
    expect(out.stderr.match(/^ {2}fix: /gm)?.length).toBe(4);
  });

  test("the same tree gives the same output", () => {
    const repo = makeRepo({
      "src/b.ts": lines(1),
      "src/a.ts": lines(1),
      "web/z.ts": lines(1),
      "docs/codeplan/plan.json": plan({ s: ["src/b.ts"] }),
    });
    expect(run(["check"], repo)).toEqual(run(["check"], repo));
    expect(run(["check"], repo).stderr.indexOf("src/a.ts")).toBeLessThan(
      run(["check"], repo).stderr.indexOf("web/z.ts"),
    );
  });

  test("output does not contain the absolute repository path", () => {
    const repo = makeRepo({ "src/a.ts": lines(1) });
    const out = run(["check"], repo);
    expect(out.stdout + out.stderr).not.toContain(repo);
  });

  test("a repository path that is missing or not a directory exits 2 in one line", () => {
    const repo = makeRepo({ "src/a.ts": lines(1) });
    for (const target of [join(repo, "missing"), join(repo, "src/a.ts")]) {
      const out = run(["check", "--repo", target], repo);
      expect(out.code).toBe(2);
      expect(out.stdout).toBe("");
      expect(out.stderr).toBe(`codeplan: repository not found: ${target}\n`);
      expect(out.stderr).not.toMatch(/^\s+at /m);
    }
  });

  test("help exits 0; unknown or missing commands exit 2 with usage", () => {
    expect(run(["help"], "/").code).toBe(0);
    for (const argv of [[], ["nope"], ["update", "--root", "src"], ["check", "--bogus"], ["check", "--max-parts", "2"]]) {
      const out = run(argv, "/");
      expect(out.code).toBe(2);
      expect(out.stderr).toContain("Usage:");
    }
  });
});
