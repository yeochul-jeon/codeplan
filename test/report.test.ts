// The snapshot and report commands.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { run, type RunResult } from "../src/cli.js";
import { lines, makeRepo, tempDir, type Tree } from "./helpers.js";
import { treeState } from "./page-helpers.js";

const K: Tree = {
  "package.json": lines(1),
  "README.md": lines(1),
  "src/shop/cart.ts": lines(3),
  "src/shop/pay.ts": lines(2),
  "src/shop/cart.test.ts": lines(1),
  "src/auth/login.ts": lines(4),
};
const PLAN_FILE = "docs/codeplan/plan.json";

type Item = Record<string, unknown>;
const part = (id: string, paths: string[], more: Item = {}): Item => ({ id, name: "", about: "", paths, ...more });
const planOf = (...parts: Item[]) => ({ format: 1, name: "", about: "", parts });
const P = () => planOf(part("shop", ["src/shop/**"]), part("auth", ["src/auth/**"]));
const REFUND = part("refund", ["src/refund/**"], { planned: true });

// A repository with the shared tree; update has run when it can write.
function repoWith(plan: unknown, more: Tree = {}): string {
  const tree: Tree = { ...K, ...more };
  if (plan !== null) tree[PLAN_FILE] = JSON.stringify(plan, null, 2);
  const repo = makeRepo(tree);
  run(["update"], repo);
  return repo;
}

// Runs a command twice: it writes nothing and prints the same both times.
function ran(repo: string, args: string[]): RunResult {
  const before = treeState(repo);
  const out = run(args, repo);
  expect(run(args, repo)).toEqual(out);
  expect(treeState(repo)).toEqual(before);
  return out;
}

// The snapshot of a repository, in a file outside every tree.
function baseFile(repo: string, change: (text: string) => string = (t) => t): string {
  const out = ran(repo, ["snapshot"]);
  expect(out.code).toBe(0);
  const file = join(tempDir(), "base.json");
  writeFileSync(file, change(out.stdout));
  return file;
}

// The status line says ok exactly when check passes on the same tree.
function report(repo: string, base?: string): RunResult {
  const out = ran(repo, base === undefined ? ["report"] : ["report", "--base", base]);
  if (out.code === 0) {
    expect(out.stdout.split("\n")[2] === "check: ok", out.stdout).toBe(run(["check"], repo).code === 0);
  }
  return out;
}
const printed = (out: RunResult): string => {
  expect(out.code, out.stderr).toBe(0);
  expect(out.stderr).toBe("");
  return out.stdout;
};

const OK = "## codeplan\n\ncheck: ok\n";

describe("snapshot", () => {
  test("prints the config, the parts, each file's owner and the problem lists as JSON", () => {
    const out = ran(repoWith(P()), ["snapshot"]);
    expect(out.code).toBe(0);
    expect(out.stderr).toBe("");
    const expected = {
      snapshot: 1,
      rules: 1,
      config: { languages: ["js"], watch: null, skip: [], roots: [], tests: false },
      plan: "ok",
      complete: true,
      page: "ok",
      parts: [
        { id: "shop", paths: ["src/shop/**"], planned: false, files: 2, lines: 5 },
        { id: "auth", paths: ["src/auth/**"], planned: false, files: 1, lines: 4 },
      ],
      owned: [
        { path: "src/auth/login.ts", part: "auth", pattern: "src/auth/**" },
        { path: "src/shop/cart.ts", part: "shop", pattern: "src/shop/**" },
        { path: "src/shop/pay.ts", part: "shop", pattern: "src/shop/**" },
      ],
      orphans: [],
      contested: [],
      unwatched: [],
      tasks: [],
      diagnostics: [],
    };
    expect(out.stdout).toBe(`${JSON.stringify(expected, null, 2)}\n`);
  });

  test("without a plan file every watched file is an orphan and the page is not checked", () => {
    const out = ran(repoWith(null), ["snapshot"]);
    expect(out.code).toBe(0);
    const s = JSON.parse(out.stdout);
    expect(s).toMatchObject({ plan: "missing", complete: true, page: "not-checked", parts: [], owned: [] });
    expect(s.orphans).toEqual(["src/auth/login.ts", "src/shop/cart.ts", "src/shop/pay.ts"]);
    expect(s.diagnostics).toHaveLength(1);
    expect(s.diagnostics[0]).toMatchObject({ at: "plan", code: "no-plan", severity: "warning" });
    expect(Object.keys(s.diagnostics[0])).toEqual(["at", "code", "severity", "message", "fix"]);
  });

  test("a plan with an error is invalid, and a part left out makes it incomplete", () => {
    const out = ran(repoWith(planOf(part("shop", ["src/shop/**"]), part("auth", [""]))), ["snapshot"]);
    expect(out.code).toBe(0);
    const s = JSON.parse(out.stdout);
    expect(s).toMatchObject({ plan: "invalid", complete: false, page: "not-checked", orphans: [] });
    expect(s.parts.map((p: Item) => p.id)).toEqual(["shop"]);
    expect(s.diagnostics[0]).toMatchObject({ at: "parts[1].paths[0]", code: "bad-shape", severity: "error" });
    for (const d of s.diagnostics) expect(d.fix).toMatch(/\S/);
  });

  test("the page is foreign, missing, outdated or not checked, and none of them ends the command", () => {
    const page = "docs/codeplan/codeplan.html";
    const state = (repo: string) => JSON.parse(printed(ran(repo, ["snapshot"]))).page;
    expect(state(makeRepo({ ...K, [PLAN_FILE]: JSON.stringify(P()) }))).toBe("missing");
    expect(state(makeRepo({ ...K, [PLAN_FILE]: JSON.stringify(P()), [page]: "something else" }))).toBe("foreign");
    // Something else at the page place comes before a missing plan file.
    expect(state(makeRepo({ ...K, [page]: "something else" }))).toBe("foreign");
    const outdated = repoWith(P());
    writeFileSync(join(outdated, "src/shop/more.ts"), lines(1));
    expect(state(outdated)).toBe("outdated");
    const contested = repoWith(planOf(part("shop", ["src/shop/**"]), part("auth", ["src/auth/**"]), part("b", ["src/shop/**"])));
    const s = JSON.parse(printed(ran(contested, ["snapshot"])));
    expect(s.page).toBe("not-checked");
    expect(s.contested).toEqual([
      { path: "src/shop/cart.ts", parts: ["b", "shop"] },
      { path: "src/shop/pay.ts", parts: ["b", "shop"] },
    ]);
    expect(s.owned.map((o: Item) => o.path)).toEqual(["src/auth/login.ts"]);
  });

  test("among equally strong patterns of one part, the first in paths is the one that won", () => {
    const repo = repoWith(planOf(part("shop", ["src/shop/*.ts", "src/shop/**"]), part("auth", ["src/auth/**"])));
    const s = JSON.parse(printed(ran(repo, ["snapshot"])));
    expect(s.owned[1]).toEqual({ path: "src/shop/cart.ts", part: "shop", pattern: "src/shop/*.ts" });
  });
});

describe("report", () => {
  test("says ok when check would pass", () => {
    expect(printed(report(repoWith(P())))).toBe(OK);
  });

  test("lists the files in no part", () => {
    expect(printed(report(repoWith(P(), { "src/misc/x_y.ts": lines(1) })))).toBe(
      "## codeplan\n\ncheck: fails (1 orphan files)\n\n### Files in no part\n\n- src/misc/x\\_y.ts\n",
    );
  });

  test("with a base, shows the parts that changed and the directories a wide pattern took in", () => {
    const Q = () => planOf(part("shop", ["src/shop/**"]), part("auth", ["src/**"]));
    const base = baseFile(repoWith(Q()));
    const head = repoWith(Q(), {
      "src/shop/extra.ts": lines(7),
      "src/newpkg/a.ts": lines(1),
      "src/newpkg/b.ts": lines(1),
    });
    expect(printed(report(head, base))).toBe(`${OK}
### Changes

| Part | Files | Lines | Change |
|---|---|---|---|
| shop | 2 → 3 | 5 → 12 | changed |
| auth | 1 → 3 | 4 → 6 | changed |

### New directories

- src/newpkg/: 2 files went to part auth through src/\\*\\*
`);
  });

  test("a base without a plan file has nothing to compare", () => {
    const base = baseFile(repoWith(null));
    expect(printed(report(repoWith(P()), base))).toBe(
      `${OK}\n### Changes\n\nNo plan in the base, so there is nothing to compare.\n`,
    );
  });

  test("a changed id is one new part and one removed part", () => {
    const base = baseFile(repoWith(P()));
    const head = repoWith(planOf(part("shop", ["src/shop/**"]), part("login", ["src/auth/**"])));
    expect(printed(report(head, base))).toBe(`${OK}
### Changes

| Part | Files | Lines | Change |
|---|---|---|---|
| login | 1 | 4 | new |
| auth | 1 | 4 | removed |
`);
  });

  test("a changed pattern is said, and no directory note follows", () => {
    const base = baseFile(repoWith(P()));
    const head = repoWith(planOf(part("shop", ["src/shop/*.ts"]), part("auth", ["src/auth/**"])));
    expect(printed(report(head, base))).toBe(`${OK}
### Changes

No part changed.

The config or part patterns changed, so some changes come from new rules, not new code.
`);
  });

  test("a changed config is said too", () => {
    const base = baseFile(repoWith(P()));
    const head = repoWith(P(), { "codeplan.json": JSON.stringify({ skip: ["vendor/**"] }) });
    expect(printed(report(head, base))).toContain("\nNo part changed.\n\nThe config or part patterns changed,");
  });

  test("a planned part that got code is marked, and its own narrow pattern gives no directory note", () => {
    const plan = () => planOf(part("shop", ["src/shop/**"]), part("auth", ["src/auth/**"]), REFUND);
    const base = baseFile(repoWith(plan()));
    const head = repoWith(plan(), { "src/refund/give.ts": lines(2) });
    expect(printed(report(head, base))).toBe(`## codeplan

check: fails (1 warnings)

### Findings

- parts\\[2\\].planned: planned-has-files [warning] part "refund": the part is planned, but 1 watched files are measured in it

### Changes

| Part | Files | Lines | Change |
|---|---|---|---|
| refund | 0 → 1 | 0 → 2 | planned, has code |
`);
  });

  test.each([
    ["is not there", null],
    ["is not JSON", () => "not json"],
    ["has another snapshot format", (t: string) => t.replace('"snapshot": 1', '"snapshot": 2')],
    ["has other counting rules", (t: string) => t.replace('"rules": 1', '"rules": 2')],
    [
      "lacks a field",
      (t: string) => {
        const { parts: _parts, ...rest } = JSON.parse(t);
        return JSON.stringify(rest, null, 2);
      },
    ],
  ])("a base file that %s ends the command with exit code 2", (_what, change) => {
    const repo = repoWith(P());
    const base = change === null ? join(tempDir(), "none.json") : baseFile(repo, change);
    const out = report(repo, base);
    expect(out.code).toBe(2);
    expect(out.stdout).toBe("");
    expect(out.stderr).toMatch(/^codeplan: the --base file .* cannot be used: .+\n$/);
  });

  test("an incomplete head shows no changes and no list of files in no part", () => {
    const base = baseFile(repoWith(P()));
    const head = repoWith(planOf(part("shop", ["src/shop/**"]), part("auth", [""])));
    expect(printed(report(head, base))).toBe(`## codeplan

check: fails (1 errors, measurement incomplete)

### Findings

- parts\\[1\\].paths\\[0\\]: bad-shape [error] part "auth": a pattern must be a non-empty string

Measurement is incomplete, so files in no part are not listed.

### Changes

Measurement is incomplete in the head, so changes are not shown.
`);
    // The other way round, the sentence names the base.
    const incomplete = baseFile(head);
    expect(printed(report(repoWith(P()), incomplete))).toBe(
      `${OK}\n### Changes\n\nMeasurement is incomplete in the base, so changes are not shown.\n`,
    );
    expect(printed(report(head, incomplete))).toContain("Measurement is incomplete in the base, so");
  });

  test("a list stops at thirty items and counts the rest", () => {
    const more: Tree = {};
    const name = (i: number) => `src/misc/f${String(i).padStart(2, "0")}.ts`;
    for (let i = 1; i <= 35; i++) more[name(i)] = lines(1);
    const text = printed(report(repoWith(P(), more))).split("\n");
    expect(text[2]).toBe("check: fails (35 orphan files)");
    expect(text.slice(4)).toEqual([
      "### Files in no part",
      "",
      ...Array.from({ length: 30 }, (_, i) => `- ${name(i + 1)}`),
      "- and 5 more",
      "",
    ]);
  });

  test("options that do not belong are refused", () => {
    const repo = repoWith(P());
    for (const args of [["snapshot", "--base", "x"], ["report", "--bogus"], ["report", "--base"], ["check", "--base", "x"]]) {
      const out = run(args, repo);
      expect(out.code, args.join(" ")).toBe(2);
      expect(out.stdout).toBe("");
    }
  });

  test("contested and unwatched files, a missing plan and a foreign page all show", () => {
    const contested = repoWith(
      planOf(part("shop", ["src/shop/**"]), part("auth", ["src/auth/**"]), part("b", ["src/shop/**"])),
      { "scripts/run.ts": lines(1), "codeplan.json": JSON.stringify({ watch: ["src/**/*.ts"] }) },
    );
    expect(printed(report(contested))).toBe(`## codeplan

check: fails (1 warnings, 2 contested files, 1 unwatched files)

### Findings

- parts\\[0\\].paths: empty-part [warning] part "shop": its paths match no watched file

### Contested files

- src/shop/cart.ts: b, shop
- src/shop/pay.ts: b, shop

### Unwatched files

- scripts/run.ts
`);
    const noPlan = printed(report(repoWith(null))).split("\n");
    expect(noPlan[2]).toBe("check: fails (1 warnings, 3 orphan files)");
    expect(noPlan).toContain("### Findings");
    const foreign = makeRepo({ ...K, [PLAN_FILE]: JSON.stringify(P()), "docs/codeplan/codeplan.html": "x" });
    expect(printed(report(foreign))).toBe("## codeplan\n\ncheck: fails (foreign page)\n");
    const missing = makeRepo({ ...K, [PLAN_FILE]: JSON.stringify(P()) });
    expect(printed(report(missing))).toBe("## codeplan\n\ncheck: fails (page missing)\n");
    writeFileSync(join(missing, "docs/codeplan/codeplan.html"), "<!doctype html><!-- codeplan page -->\nold");
    expect(printed(report(missing))).toBe("## codeplan\n\ncheck: fails (page outdated)\n");
  });

  test("directory notes leave out root files, directories the base had files in, and new parts", () => {
    const plan = (...more: Item[]) => planOf(part("all", ["**"]), part("shop", ["src/shop/**"]), ...more);
    const base = baseFile(repoWith(plan(), { "lib/deep/x.ts": lines(1) }));
    const head = repoWith(plan(part("fresh", ["fresh/**", "fr*/sub/**"])), {
      "lib/deep/x.ts": lines(1),
      "lib/y.ts": lines(1),
      "top.ts": lines(1),
      "src/auth/second.ts": lines(1),
      "fresh/a.ts": lines(1),
      "tools/z.ts": lines(1),
    });
    const text = printed(report(head, base));
    expect(text.slice(text.indexOf("### New directories"))).toBe(
      "### New directories\n\n- lib/: 1 files went to part all through \\*\\*\n- tools/: 1 files went to part all through \\*\\*\n",
    );
  });

  test("the config file or a plan file that cannot be read ends both commands with exit code 2", () => {
    const badConfig = makeRepo({ ...K, "codeplan.json": "{" });
    const badPlan = makeRepo({ ...K, [PLAN_FILE]: "{" });
    for (const repo of [badConfig, badPlan]) {
      for (const command of ["snapshot", "report"]) {
        const out = run([command], repo);
        expect(out.code).toBe(2);
        expect(out.stdout).toBe("");
      }
    }
  });
});
