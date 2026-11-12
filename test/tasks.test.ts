// Tasks: the checks on them in the plan file, the info findings, the task
// pane of the page, and the task tables of summary, snapshot and report.
import { readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { check, run } from "../src/cli.js";
import { lines, makeRepo, tempDir, type Tree } from "./helpers.js";
import { readBlock } from "./page-helpers.js";
import { openViewer, type El, type Viewer } from "./viewer-dom.js";

const K: Tree = {
  "package.json": lines(1),
  "README.md": lines(1),
  "src/shop/cart.ts": lines(3),
  "src/shop/pay.ts": lines(2),
  "src/shop/cart.test.ts": lines(1),
  "src/auth/login.ts": lines(4),
};
const PLAN = "docs/codeplan/plan.json";
const PAGE = "docs/codeplan/codeplan.html";

interface Task {
  id: string;
  name: string;
  status?: unknown;
  parts?: unknown;
  makes?: unknown;
  [key: string]: unknown;
}
interface Plan {
  format: number;
  name: string;
  about: string;
  parts: Record<string, unknown>[];
  tasks?: unknown;
  [key: string]: unknown;
}

// The base plan. Each call gives a new value, so a case can change it.
const T = (): Plan & { tasks: Task[] } => ({
  format: 1,
  name: "shopfront",
  about: "",
  parts: [
    { id: "shop", name: "Shop", about: "", paths: ["src/shop/**"] },
    { id: "auth", name: "Auth", about: "", paths: ["src/auth/**"] },
    { id: "refund", name: "Refund", about: "", paths: ["src/refund/**"], planned: true },
  ],
  tasks: [
    { id: "refund-flow", name: "Refund flow", status: "doing", parts: ["shop", "refund"], makes: ["src/shop/pay.ts", "src/refund/give.ts"] },
    { id: "login-limit", name: "", status: "done", parts: ["auth"], makes: ["src/auth/login.ts"] },
    { id: "receipts", name: "Receipts", status: "todo" },
  ],
});
const changed = (change: (plan: ReturnType<typeof T>) => void) => {
  const plan = T();
  change(plan);
  return plan;
};
const LEGACY = { id: "legacy", name: "", about: "", paths: [""] };
const MAIL = { id: "mail", name: "", about: "" };
// login-limit is done and one of its two files is not there.
const doneMissing = (plan: ReturnType<typeof T>) => {
  plan.tasks[1]!.makes = ["src/auth/login.ts", "src/auth/limit.ts"];
};

const repoOf = (plan: unknown, tree: Tree = {}) => makeRepo({ ...K, ...tree, [PLAN]: JSON.stringify(plan, null, 2) });
const setPlan = (repo: string, plan: unknown) => writeFileSync(join(repo, PLAN), JSON.stringify(plan, null, 2));

type Row = [at: string, code: string, severity: "error" | "warning" | "info", id?: string];
const FINDING = /^(\S+): ([a-z-]+) \[(error|warning|info)\] (.*)$/;

// Writes the page as a user would, then runs check.
function checked(plan: unknown, tree: Tree = {}) {
  const repo = repoOf(plan, tree);
  run(["update"], repo);
  const out = run(["check"], repo);
  const found = out.stderr
    .split("\n")
    .map((l) => FINDING.exec(l))
    .filter((m): m is RegExpExecArray => m !== null);
  return { repo, out, found };
}

function expectFindings(plan: unknown, rows: Row[], code: 0 | 1 | 2, tree: Tree = {}) {
  const { out, found, repo } = checked(plan, tree);
  expect(found.map((m) => [m[1], m[2], m[3]]), out.stderr).toEqual(rows.map(([at, c, severity]) => [at, c, severity]));
  rows.forEach(([, , , id], i) => {
    if (id !== undefined) expect(found[i]![4]).toContain(`"${id}"`);
  });
  expect(out.code, out.stderr + out.stdout).toBe(code);
  // Every code has its fix line.
  for (const [, c] of rows) expect(out.stderr).toContain(`  fix: ${c}: `);
  return { out, repo };
}

describe("tasks in the plan file", () => {
  test("the base plan has no finding and measures as before", () => {
    const { out } = expectFindings(T(), [], 0);
    expect(out.stdout).toContain("part shop: 2 files, 5 lines\npart auth: 1 files, 4 lines\npart refund: 0 files, 0 lines\n");
    expect(out.stdout.endsWith("check: ok\n")).toBe(true);
    expect(out.stderr).toBe("");
  });

  test("a done task with a file that is not there is an info finding, and check stays ok", () => {
    const { out, found } = checked(changed(doneMissing));
    expect(found.map((m) => [m[1], m[2], m[3]])).toEqual([["tasks[1].status", "task-done-missing", "info"]]);
    expect(found[0]![4]).toMatch(/"login-limit".*\b1 of 2\b/);
    expect(out.code).toBe(0);
    expect(out.stdout.endsWith("check: ok\n")).toBe(true);
    expect(out.stderr).toContain("  fix: task-done-missing: ");
  });

  test("a todo task with a file that is there is an info finding", () => {
    const { out } = expectFindings(
      changed((p) => (p.tasks[2]!.makes = ["src/shop/cart.ts"])),
      [["tasks[2].status", "task-todo-has-files", "info", "receipts"]],
      0,
    );
    expect(out.stdout.endsWith("check: ok\n")).toBe(true);
    expect(out.stderr).toMatch(/1 of 1/);
  });

  test("a doing task gets no finding about its counts", () => {
    expectFindings(changed((p) => (p.tasks[0]!.makes = ["src/refund/a.ts", "src/refund/b.ts"])), [], 0);
  });

  const UNOWNED: Row[] = [["tasks[0].makes[2]", "task-path-unowned", "info", "refund-flow"]];
  test.each<[string, string[], Row[]]>([
    ["a path in no part", ["src/notify/mail.ts"], UNOWNED],
    ["a path outside src, watched by default", ["lib/mail.ts"], UNOWNED],
    ["a test file", ["src/notify/mail.test.ts"], []],
    ["a path under home", ["docs/codeplan/extra.ts"], []],
    ["a path that is not code", ["notes.md"], []],
    ["a path in a dependency directory", ["node_modules/x/index.js"], []],
    ["the same path twice", ["src/notify/mail.ts", "src/notify/mail.ts"], UNOWNED],
  ])("task-path-unowned: %s", (_name, paths, rows) => {
    const { out } = expectFindings(changed((p) => (p.tasks[0]!.makes as string[]).push(...paths)), rows, 0);
    if (rows.length > 0) expect(out.stderr).toContain(`${paths[0]} would be`);
  });

  test("task-path-unowned is not given for a file that is there; the orphan list has it", () => {
    const { out } = expectFindings(
      changed((p) => (p.tasks[0]!.makes as string[]).push("src/notify/mail.ts")),
      [],
      1,
      { "src/notify/mail.ts": lines(1) },
    );
    expect(out.stderr).toContain("orphan files: no part owns them (1)");
  });

  test("task-path-unowned is not given while a part is left out of measurement; the count findings are", () => {
    const unowned = (p: ReturnType<typeof T>) => {
      (p.tasks[0]!.makes as string[]).push("src/notify/mail.ts");
      p.parts.push(LEGACY);
    };
    expectFindings(changed(unowned), [["parts[3].paths[0]", "bad-shape", "error", "legacy"]], 2);
    expectFindings(
      changed((p) => {
        unowned(p);
        doneMissing(p);
      }),
      [
        ["parts[3].paths[0]", "bad-shape", "error", "legacy"],
        ["tasks[1].status", "task-done-missing", "info", "login-limit"],
      ],
      2,
    );
  });

  const push = (path: unknown) => (p: ReturnType<typeof T>) => void (p.tasks[0]!.makes as unknown[]).push(path);
  test.each<[string, (p: ReturnType<typeof T>) => void, Row[], 0 | 2]>([
    ["tasks is null", (p) => void ((p as Plan).tasks = null), [["tasks", "bad-shape", "error"]], 2],
    ["a task is not an object", (p) => void (p.tasks as unknown[]).push("x"), [["tasks[3]", "bad-shape", "error"]], 2],
    ["status in other letters", (p) => void (p.tasks[1]!.status = "Done"), [["tasks[1].status", "bad-shape", "error", "login-limit"]], 2],
    [
      "status in other letters, with a file that is not there",
      (p) => {
        p.tasks[1]!.status = "Done";
        doneMissing(p);
      },
      [["tasks[1].status", "bad-shape", "error", "login-limit"]],
      2,
    ],
    ["status is null", (p) => void (p.tasks[1]!.status = null), [["tasks[1].status", "bad-shape", "error", "login-limit"]], 2],
    ["no status", (p) => void delete p.tasks[2]!.status, [["tasks[2].status", "bad-shape", "error", "receipts"]], 2],
    ["parts is null", (p) => void (p.tasks[0]!.parts = null), [["tasks[0].parts", "bad-shape", "error", "refund-flow"]], 2],
    ["a part that is not an id", (p) => void (p.tasks[0]!.parts = ["shop", "Shop"]), [["tasks[0].parts[1]", "bad-shape", "error", "refund-flow"]], 2],
    ["a part that is not there", (p) => void (p.tasks[0]!.parts = ["shop", "nope"]), [["tasks[0].parts[1]", "unknown-target", "error", "refund-flow"]], 2],
    ["a task id as a part", (p) => void (p.tasks[0]!.parts = ["shop", "receipts"]), [["tasks[0].parts[1]", "unknown-target", "error", "refund-flow"]], 2],
    ["the same part twice", (p) => void (p.tasks[0]!.parts = ["shop", "shop"]), [], 0],
    ["a path from the root", push("/a"), [["tasks[0].makes[2]", "bad-shape", "error", "refund-flow"]], 2],
    ["a path that ends with a slash", push("a/"), [["tasks[0].makes[2]", "bad-shape", "error", "refund-flow"]], 2],
    ["a path with ..", push("a/../b"), [["tasks[0].makes[2]", "bad-shape", "error", "refund-flow"]], 2],
    ["a path with a backslash", push("a\\b"), [["tasks[0].makes[2]", "bad-shape", "error", "refund-flow"]], 2],
    ["makes is a string", (p) => void (p.tasks[0]!.makes = "src/a.ts"), [["tasks[0].makes", "bad-shape", "error", "refund-flow"]], 2],
    ["an unknown key", (p) => void (p.tasks[1]!.due = "2026-12"), [["tasks[1].due", "bad-shape", "error", "login-limit"]], 2],
    ["a note", (p) => void (p.tasks[1]!.note = "ask ops"), [], 0],
    [
      "a part left out of measurement is still a part a task can name",
      (p) => {
        p.parts.push(LEGACY);
        p.tasks[0]!.parts = ["shop", "legacy"];
      },
      [["parts[3].paths[0]", "bad-shape", "error", "legacy"]],
      2,
    ],
  ])("shape: %s", (_name, change, rows, code) => {
    expectFindings(changed(change), rows, code);
  });

  test("a task with the id of an earlier item is a repeated id, and only its shape is checked", () => {
    const withAuth = (p: ReturnType<typeof T>) =>
      void p.tasks.push({ id: "auth", name: "", status: "done", makes: ["src/auth/gone.ts"] });
    const { out } = expectFindings(changed(withAuth), [["tasks[3].id", "repeated-id", "error", "auth"]], 2);
    expect(out.stdout).toContain("part shop: 2 files, 5 lines\npart auth: 1 files, 4 lines\npart refund: 0 files, 0 lines\n");
    expectFindings(
      changed((p) => void p.tasks.push({ id: "receipts", name: "", status: "Done", parts: ["nope"] })),
      [
        ["tasks[3].id", "repeated-id", "error", "receipts"],
        ["tasks[3].status", "bad-shape", "error", "receipts"],
      ],
      2,
    );
    // No unused-external while any id is repeated.
    expectFindings(
      changed((p) => {
        withAuth(p);
        p.externals = [MAIL];
      }),
      [["tasks[3].id", "repeated-id", "error", "auth"]],
      2,
    );
  });

  test("findings come in document order: tasks after scenarios, a note and unknown keys last", () => {
    expectFindings(
      changed((p) => {
        p.tasks[1]!.status = "Done";
        p.note = "n";
        p.zzz = 1;
        p.tasks[2]!.yyy = 1;
      }),
      [
        ["tasks[1].status", "bad-shape", "error", "login-limit"],
        ["tasks[2].yyy", "bad-shape", "error", "receipts"],
        ["zzz", "bad-shape", "error"],
      ],
      2,
    );
  });

  test("a task id is not a target of a use, a step or a reference in a text", () => {
    expectFindings(
      changed((p) => {
        p.parts[0]!.about = "see {receipts}";
        p.parts[0]!.uses = [{ to: "receipts" }];
      }),
      [
        ["parts[0].about", "unknown-reference", "warning", "shop"],
        ["parts[0].uses[0].to", "unknown-target", "error", "shop"],
      ],
      2,
    );
  });

  test("a directory, and a file behind a symbolic link, are not there", () => {
    const { found } = checked(changed((p) => void (p.tasks[1]!.makes = ["src/auth"])));
    expect(found.map((m) => m[2])).toEqual(["task-done-missing"]);

    // src/link is a link to src/auth, so src/link/login.ts can be read.
    const repo = repoOf(changed((p) => void (p.tasks[1]!.makes = ["src/link/login.ts"])));
    symlinkSync("auth", join(repo, "src/link"));
    expect(readFileSync(join(repo, "src/link/login.ts"), "utf8")).toBe(lines(4));
    run(["update"], repo);
    const out = run(["check"], repo);
    expect(out.stderr.split("\n").filter((l) => FINDING.test(l)).map((l) => FINDING.exec(l)!.slice(1, 3))).toEqual([
      ["tasks[1].status", "task-done-missing"],
      ["tasks[1].makes[0]", "task-path-unowned"],
    ]);
    expect(out.code).toBe(0);
  });
});

describe("exit codes with info findings", () => {
  test("a warning beside an info finding: exit 1 and one warning in the summary line", () => {
    const { out } = expectFindings(
      changed((p) => {
        doneMissing(p);
        p.externals = [MAIL];
      }),
      [
        ["externals[0]", "unused-external", "warning", "mail"],
        ["tasks[1].status", "task-done-missing", "info", "login-limit"],
      ],
      1,
    );
    expect(out.stdout).toContain("0 errors, 1 warnings\n");
  });

  test("an info finding does not hide an outdated page", () => {
    const repo = repoOf(T());
    expect(run(["update"], repo).code).toBe(0);
    setPlan(repo, changed(doneMissing));
    const out = run(["check"], repo);
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("page outdated: ");
    expect(out.stdout).toContain("0 errors, 0 warnings, page outdated\n");
  });

  test("update writes the page and prints no finding line", () => {
    const repo = repoOf(changed(doneMissing));
    expect(run(["update"], repo)).toEqual({ code: 0, stdout: `update: wrote ${PAGE}\n`, stderr: "" });
  });

  test("summary prints with exit 0 and gives the info line on standard error", () => {
    const out = run(["summary"], repoOf(changed(doneMissing)));
    expect(out.code).toBe(0);
    expect(out.stderr).toMatch(/^tasks\[1\]\.status: task-done-missing \[info\] /);
  });
});

// ---- the page ----

function pageOf(plan: unknown, tree: Tree = {}) {
  const repo = repoOf(plan, tree);
  const out = run(["update"], repo);
  expect(out.code, out.stderr).toBe(0);
  const file = join(repo, PAGE);
  const text = readFileSync(file, "utf8");
  return { repo, file, text, ...readBlock(text) };
}
const layoutOf = (plan: unknown, tree: Tree = {}) => JSON.stringify(pageOf(plan, tree).block.layout);

describe("tasks in the page's data block", () => {
  test("the block has the tasks before the layout, with the parts to mark and the files that are not there", () => {
    const { block } = pageOf(T());
    expect(Object.keys(block)).toEqual(["format", "plan", "measure", "orphans", "unwatched", "tasks", "layout"]);
    expect(block.format).toBe(2);
    expect(block.tasks).toEqual([
      { id: "refund-flow", marks: ["shop", "refund"], missing: ["src/refund/give.ts"] },
      { id: "login-limit", marks: ["auth"], missing: [] },
      { id: "receipts", marks: [], missing: [] },
    ]);
  });

  test("tasks do not change the layout", () => {
    const base = layoutOf(T());
    const without = pageOf(changed((p) => void delete (p as Plan).tasks));
    expect(JSON.stringify(without.block.layout)).toBe(base);
    expect(without.block.tasks).toEqual([]);
    expect(openViewer(without.file).doc.byId.get("tasks")!.children).toEqual([]);

    expect(layoutOf(changed((p) => void (p.tasks[0]!.status = "done")))).toBe(base);
    expect(
      layoutOf(
        changed((p) => {
          p.tasks[0]!.parts = ["auth"];
          p.tasks[0]!.makes = ["src/auth/login.ts", "lib/x.ts"];
          p.tasks.reverse();
        }),
      ),
    ).toBe(base);
  });

  test("a changed status makes the page outdated", () => {
    const { repo } = pageOf(T());
    setPlan(repo, changed((p) => void (p.tasks[0]!.status = "done")));
    const out = run(["check"], repo);
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("page outdated: ");
  });

  test("marks adds the part that holds a file of makes, in plan order", () => {
    expect(pageOf(changed((p) => void (p.tasks[0]!.parts = ["refund"]))).block.tasks[0]!.marks).toEqual(["shop", "refund"]);
  });

  test("a path no part would own adds no part, and is among the missing in code unit order", () => {
    const { block } = pageOf(changed((p) => void (p.tasks[0]!.makes as string[]).push("src/notify/mail.ts")));
    expect(block.tasks[0]).toEqual({
      id: "refund-flow",
      marks: ["shop", "refund"],
      missing: ["src/notify/mail.ts", "src/refund/give.ts"],
    });
  });

  test("no page is written for a plan with a repeated task id", () => {
    const repo = repoOf(changed((p) => void p.tasks.push({ id: "auth", name: "", status: "done" })));
    expect(run(["update"], repo).code).toBe(2);
    expect(() => readFileSync(join(repo, PAGE))).toThrow();
  });
});

const pane = (v: Viewer) => v.doc.byId.get("tasks")!;
const taskButton = (v: Viewer, id: string) => pane(v).all().find((e) => e.getAttribute("data-task") === id)!;
const pressed = (v: Viewer) =>
  pane(v)
    .all()
    .filter((e) => e.getAttribute("aria-pressed") === "true")
    .map((e) => e.getAttribute("data-task"));
const active = (v: Viewer) => v.plane.all().filter((e) => e.hasAttribute("data-active"));
const activeRects = (v: Viewer) => {
  expect(active(v).every((e) => e.name === "rect")).toBe(true);
  return active(v).map((e) => e.getAttribute("data-id"));
};
// The text a reader sees in the pane: not what a hidden element holds.
const visibleText = (el: El): string =>
  el.hasAttribute("hidden") ? "" : [el.textContent, ...el.children.map(visibleText)].join(" ");

describe("the task pane", () => {
  test("the pane is after the drawing and before the scenario pane and the legend", () => {
    const { text } = pageOf(T());
    const places = ['id="plane"', 'id="tasks"', 'id="walk"', 'id="legend"'].map((id) => text.indexOf(id));
    expect(places.every((at) => at > 0)).toBe(true);
    expect([...places].sort((a, b) => a - b)).toEqual(places);
  });

  test("a button for each task: todo and doing first, done in a closed group", () => {
    const v = openViewer(pageOf(T()).file);
    const kids = pane(v).children;
    expect(kids.slice(0, 3).map((e) => [e.name, e.getAttribute("data-task")])).toEqual([
      ["button", "refund-flow"],
      ["button", "receipts"],
      ["details", null],
    ]);
    const group = kids[2]!;
    expect(group.hasAttribute("open")).toBe(false);
    expect(group.children.map((e) => [e.name, e.textContent || e.getAttribute("data-task")])).toEqual([
      ["summary", "Done (1)"],
      ["button", "login-limit"],
    ]);
    expect(v.walk.children).toEqual([]);
    expect(pressed(v)).toEqual([]);
    expect(activeRects(v)).toEqual([]);
  });

  test("a row reads name, status, count and a bar, in that order; no count and bar for a task that makes no file", () => {
    const v = openViewer(pageOf(T()).file);
    const row = (id: string) => taskButton(v, id).children.map((e) => (e.name === "svg" ? "<bar>" : e.textContent));
    expect(row("refund-flow")).toEqual(["Refund flow", "doing", "1 of 2 files", "<bar>"]);
    expect(row("login-limit")).toEqual(["login-limit", "done", "1 of 1 files", "<bar>"]);
    expect(row("receipts")).toEqual(["Receipts", "todo"]);
    // The bar: one box, and a filled length in proportion to the count.
    const widths = (id: string) => taskButton(v, id).children.at(-1)!.children.map((e) => [e.name, e.getAttribute("class"), e.getAttribute("width")]);
    expect(widths("refund-flow")).toEqual([["rect", "bar-line", "65"], ["rect", "bar-fill", "32"]]);
    expect(widths("login-limit")).toEqual([["rect", "bar-line", "65"], ["rect", "bar-fill", "64"]]);
  });

  test("choosing a task marks its parts, shows the files that are not there, and sets the fragment", () => {
    const v = openViewer(pageOf(T()).file);
    expect(visibleText(pane(v))).not.toContain("src/refund/give.ts");
    taskButton(v, "refund-flow").dispatch("click");
    expect(activeRects(v)).toEqual(["shop", "refund"]);
    expect(pressed(v)).toEqual(["refund-flow"]);
    expect(visibleText(pane(v))).toContain("src/refund/give.ts");
    expect(v.location.hash).toBe("#task=refund-flow");
    expect(v.history.length).toBe(1);

    taskButton(v, "refund-flow").dispatch("click");
    expect(activeRects(v)).toEqual([]);
    expect(pressed(v)).toEqual([]);
    expect(visibleText(pane(v))).not.toContain("src/refund/give.ts");
    expect(v.location.hash).toBe("");

    taskButton(v, "refund-flow").dispatch("click");
    v.press("Escape");
    expect(activeRects(v)).toEqual([]);
    expect(pressed(v)).toEqual([]);
    expect(v.location.hash).toBe("");

    // Another task takes the place of the chosen one.
    taskButton(v, "refund-flow").dispatch("click");
    taskButton(v, "login-limit").dispatch("click");
    expect(activeRects(v)).toEqual(["auth"]);
    expect(pressed(v)).toEqual(["login-limit"]);
    expect(visibleText(pane(v))).not.toContain("src/refund/give.ts");
  });

  test("the fragment chooses a task and opens the done group; an unknown id chooses nothing", () => {
    const { file } = pageOf(T());
    const v = openViewer(file, "#task=login-limit");
    expect(pressed(v)).toEqual(["login-limit"]);
    expect(activeRects(v)).toEqual(["auth"]);
    expect(pane(v).children.find((e) => e.name === "details")!.hasAttribute("open")).toBe(true);
    expect(v.location.hash).toBe("#task=login-limit");

    const none = openViewer(file, "#task=nope");
    expect(pressed(none)).toEqual([]);
    expect(activeRects(none)).toEqual([]);

    // A later unknown id leaves the chosen task; no fragment ends it.
    v.navigate("#task=nope");
    expect(pressed(v)).toEqual(["login-limit"]);
    v.navigate("#task=refund-flow");
    expect(pressed(v)).toEqual(["refund-flow"]);
    v.navigate("");
    expect(pressed(v)).toEqual([]);
    expect(activeRects(v)).toEqual([]);
  });

  test("the frame has no colour for a status and fills the bar with the dim text colour", () => {
    const { text } = pageOf(T());
    expect(text).toMatch(/\.bar-fill \{ fill: var\(--cp-text-dim\);/);
    expect(text).toMatch(/\.bar-line \{ fill: none; stroke: var\(--cp-control-line\);/);
    expect(text).not.toMatch(/data-status|text-transform|letter-spacing/);
  });
});

describe("a task and a scenario end each other", () => {
  const WITH_SCENARIO = () =>
    changed((p) => {
      p.scenarios = [{ id: "pay", name: "", steps: [{ at: "shop", does: "" }, { at: "auth", does: "" }] }];
      p.parts[0]!.uses = [{ to: "auth" }];
    });

  test("the scenario pane is after the task pane", () => {
    const v = openViewer(pageOf(WITH_SCENARIO()).file);
    expect(pane(v).children.length).toBeGreaterThan(0);
    expect(v.walk.children.length).toBeGreaterThan(0);
  });

  test("choosing a scenario ends the chosen task", () => {
    const v = openViewer(pageOf(WITH_SCENARIO()).file);
    taskButton(v, "refund-flow").dispatch("click");
    v.choose(1);
    expect(pressed(v)).toEqual([]);
    expect(v.state().rects).toEqual(["shop"]);
    expect(v.location.hash).toBe("#scenario=pay&step=1");
    expect(visibleText(pane(v))).not.toContain("src/refund/give.ts");
  });

  test("choosing a task ends the walk-through", () => {
    const v = openViewer(pageOf(WITH_SCENARIO()).file);
    v.choose(1);
    v.click("next");
    expect(v.state().lines).toEqual(["shop->auth"]);
    taskButton(v, "refund-flow").dispatch("click");
    const state = v.state();
    expect(state.selected).toBe(0);
    expect(state.lines).toEqual([]);
    expect(state.step).toBe("");
    expect(state.rects).toEqual(["shop", "refund"]);
    expect(state.hash).toBe("#task=refund-flow");
    // The arrow keys now do nothing; Esc ends the task.
    v.press("ArrowRight");
    expect(v.state().rects).toEqual(["shop", "refund"]);
    v.press("Escape");
    expect(v.state().rects).toEqual([]);
  });

  test("a fragment with a scenario key opens the scenario and does not look at the task key", () => {
    const { file } = pageOf(WITH_SCENARIO());
    const v = openViewer(file, "#scenario=pay&task=refund-flow");
    expect(v.state().step).toMatch(/^1\/2 /);
    expect(pressed(v)).toEqual([]);

    v.navigate("#task=receipts");
    expect(v.state().selected).toBe(0);
    expect(pressed(v)).toEqual(["receipts"]);
    expect(active(v)).toEqual([]);
    expect(v.location.hash).toBe("#task=receipts");

    const unknown = openViewer(file, "#scenario=nope&task=refund-flow");
    expect(pressed(unknown)).toEqual([]);
    expect(unknown.state().selected).toBe(0);
  });
});

// ---- summary, snapshot, report ----

const out0 = (repo: string, ...argv: string[]) => {
  const out = run(argv, repo);
  expect(out.code, out.stderr).toBe(0);
  return out.stdout;
};

describe("tasks in the summary", () => {
  const TABLE = [
    "## Tasks",
    "",
    "| Task | Id | Status | Files | Parts |",
    "|---|---|---|---|---|",
    "| Refund flow | refund-flow | doing | 1 of 2 | Shop, Refund |",
    "| login-limit | login-limit | done | 1 of 1 | Auth |",
    "| Receipts | receipts | todo |  |  |",
    "",
    "",
  ].join("\n");

  test("the table is after the parts and before the diagram; without tasks the output is as before", () => {
    const withTasks = out0(repoOf(T()), "summary");
    expect(withTasks).toContain(`\n\n${TABLE}## Diagram\n`);
    const without = out0(repoOf(changed((p) => void delete (p as Plan).tasks)), "summary");
    expect(without).not.toContain("Tasks");
    expect(withTasks.replace(TABLE, "")).toBe(without);
  });

  test("the table is after the scenarios", () => {
    const text = out0(
      repoOf(
        changed((p) => {
          p.scenarios = [{ id: "pay", name: "", steps: [{ at: "shop", does: "" }, { at: "shop", does: "" }] }];
        }),
      ),
      "summary",
    );
    expect(text.indexOf("## Scenarios")).toBeLessThan(text.indexOf("## Tasks"));
    expect(text.indexOf("## Tasks")).toBeLessThan(text.indexOf("## Diagram"));
  });

  test("a name is written as Markdown shows it, and parts come once in the written order", () => {
    const text = out0(
      repoOf(
        changed((p) => {
          p.tasks[0]!.name = "a|b";
          p.tasks[0]!.parts = ["refund", "shop", "refund"];
        }),
      ),
      "summary",
    );
    expect(text).toContain("\n| a\\|b | refund-flow | doing | 1 of 2 | Refund, Shop |\n");
  });

  test("the mermaid diagram is the same with and without tasks", () => {
    expect(out0(repoOf(T()), "summary", "--mermaid")).toBe(
      out0(repoOf(changed((p) => void delete (p as Plan).tasks)), "summary", "--mermaid"),
    );
  });
});

describe("tasks in the snapshot", () => {
  const TASKS = [
    { id: "refund-flow", status: "doing", makes: ["src/refund/give.ts", "src/shop/pay.ts"], missing: ["src/refund/give.ts"] },
    { id: "login-limit", status: "done", makes: ["src/auth/login.ts"], missing: [] },
    { id: "receipts", status: "todo", makes: [], missing: [] },
  ];
  const snap = (repo: string) => JSON.parse(out0(repo, "snapshot")) as Record<string, unknown> & { tasks: unknown[]; diagnostics: Record<string, string>[] };

  test("the tasks come before the findings, with the paths in code unit order", () => {
    const text = out0(repoOf(T()), "snapshot");
    const value = JSON.parse(text) as Record<string, unknown>;
    expect(value.tasks).toEqual(TASKS);
    expect([value.snapshot, value.rules]).toEqual([1, 1]);
    const keys = Object.keys(value);
    expect(keys.indexOf("tasks")).toBe(keys.indexOf("diagnostics") - 1);
    expect(text).toContain(
      '  "tasks": [\n    {\n      "id": "refund-flow",\n      "status": "doing",\n      "makes": [\n        "src/refund/give.ts",\n        "src/shop/pay.ts"\n      ],\n      "missing": [\n        "src/refund/give.ts"\n      ]\n    },\n',
    );
  });

  test("a status that is not one of the three is null; tasks that are not an array, or no plan file, give none", () => {
    const bad = snap(repoOf(changed((p) => void (p.tasks[1]!.status = "Done"))));
    expect(bad.plan).toBe("invalid");
    expect(bad.tasks[1]).toEqual({ id: "login-limit", status: null, makes: ["src/auth/login.ts"], missing: [] });
    expect(snap(repoOf(changed((p) => void ((p as Plan).tasks = null)))).tasks).toEqual([]);
    expect(snap(makeRepo(K)).tasks).toEqual([]);
  });

  test("an info finding is among the findings", () => {
    const { diagnostics } = snap(repoOf(changed(doneMissing)));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ at: "tasks[1].status", code: "task-done-missing", severity: "info" });
    expect(diagnostics[0]!.fix).not.toBe("");
  });
});

describe("tasks in the report", () => {
  const updated = (plan: unknown, tree: Tree = {}) => {
    const repo = repoOf(plan, tree);
    run(["update"], repo);
    return repo;
  };
  const baseFile = (edit: (snapshot: Record<string, unknown> & { tasks: Record<string, unknown>[] }) => void = () => {}) => {
    const value = JSON.parse(out0(updated(T()), "snapshot"));
    edit(value);
    const file = join(tempDir(), "base.json");
    writeFileSync(file, JSON.stringify(value));
    return file;
  };
  const GIVE = { "src/refund/give.ts": lines(2) };
  // The blocks from "### Changes" on.
  const changes = (text: string) => text.slice(text.indexOf("### Changes"));

  test("without a base: the state line and a table of the tasks", () => {
    expect(out0(updated(T()), "report")).toBe(
      [
        "## codeplan",
        "",
        "check: ok",
        "",
        "### Tasks",
        "",
        "| Task | Status | Files |",
        "|---|---|---|",
        "| refund-flow | doing | 1 of 2 |",
        "| login-limit | done | 1 of 1 |",
        "| receipts | todo |  |",
        "",
      ].join("\n"),
    );
  });

  test("an info finding is listed and the state line stays ok", () => {
    const text = out0(updated(changed(doneMissing)), "report");
    expect(text).toContain("\n\ncheck: ok\n\n### Findings\n\n- tasks\\[1\\].status: task-done-missing [info] ");
  });

  test("a table shows 30 rows and says how many more there are", () => {
    const ids = Array.from({ length: 31 }, (_, i) => `t${String(i + 1).padStart(2, "0")}`);
    const text = out0(
      updated(changed((p) => void (p.tasks = ids.map((id) => ({ id, name: "", status: "todo" }))))),
      "report",
    );
    expect(text).toContain("check: ok");
    expect(text.endsWith("| t30 | todo |  |\n\nAnd 1 more rows.\n")).toBe(true);
    expect(text).not.toContain("t31");
    expect(text.match(/^\| t\d\d /gm)).toHaveLength(30);
  });

  test("with a base: changed, new and removed tasks after the part changes", () => {
    const head = changed((p) => {
      p.tasks[0]!.status = "done";
      p.tasks.splice(2, 1, { id: "audit", name: "", status: "todo" });
    });
    const text = out0(updated(head, GIVE), "report", "--base", baseFile());
    expect(text).toContain("\ncheck: fails (1 warnings)\n");
    expect(text).toContain("| refund-flow | done | 2 of 2 |\n| login-limit | done | 1 of 1 |\n| audit | todo |  |\n\n### Changes");
    expect(changes(text)).toBe(
      [
        "### Changes",
        "",
        "| Part | Files | Lines | Change |",
        "|---|---|---|---|",
        "| refund | 0 → 1 | 0 → 2 | planned, has code |",
        "",
        "| Task | Status | Files | Change |",
        "|---|---|---|---|",
        "| refund-flow | doing → done | 1 of 2 → 2 of 2 | changed |",
        "| audit | todo |  | new |",
        "| receipts | todo |  | removed |",
        "",
      ].join("\n"),
    );
  });

  test("a base from before tasks: every task of the head is new", () => {
    const text = out0(updated(T()), "report", "--base", baseFile((s) => void delete (s as Record<string, unknown>).tasks));
    expect(changes(text)).toContain(
      "No part changed.\n\n| Task | Status | Files | Change |\n|---|---|---|---|\n| refund-flow | doing | 1 of 2 | new |\n| login-limit | done | 1 of 1 | new |\n| receipts | todo |  | new |\n",
    );
  });

  test("a file of makes that is now there is a change with the status written on both sides", () => {
    const text = out0(updated(T(), GIVE), "report", "--base", baseFile());
    expect(changes(text)).toContain("| refund | 0 → 1 | 0 → 2 | planned, has code |\n\n| Task | Status | Files | Change |\n|---|---|---|---|\n| refund-flow | doing → doing | 1 of 2 → 2 of 2 | changed |\n");
    expect(changes(text).match(/\| changed \|/g)).toHaveLength(1);
  });

  test("nothing changed", () => {
    expect(changes(out0(updated(T()), "report", "--base", baseFile()))).toBe("### Changes\n\nNo part changed.\n\nNo task changed.\n");
  });

  test("a task that had no makes writes 0 of 0 on that side", () => {
    const text = out0(updated(changed((p) => void (p.tasks[2]!.makes = ["src/shop/cart.ts"]))), "report", "--base", baseFile());
    expect(changes(text)).toContain("\n| receipts | todo → todo | 0 of 0 → 1 of 1 | changed |\n");
  });

  test("other paths with the same counts are a change", () => {
    const text = out0(
      updated(changed((p) => void (p.tasks[0]!.makes = ["src/shop/cart.ts", "src/refund/give.ts"]))),
      "report",
      "--base",
      baseFile(),
    );
    expect(changes(text)).toContain("\n| refund-flow | doing → doing | 1 of 2 → 1 of 2 | changed |\n");
  });

  test("a plan with an error: task changes are not shown", () => {
    const text = out0(updated(changed((p) => void (p.tasks[1]!.status = "Done"))), "report", "--base", baseFile());
    expect(changes(text)).toBe("### Changes\n\nNo part changed.\n\nThe plan has errors, so task changes are not shown.\n");
  });

  test("no plan file in the head: no task table, and every task of the base is removed", () => {
    const text = out0(makeRepo(K), "report", "--base", baseFile());
    expect(text).not.toContain("### Tasks");
    expect(changes(text)).toContain(
      "| Task | Status | Files | Change |\n|---|---|---|---|\n| refund-flow | doing | 1 of 2 | removed |\n| login-limit | done | 1 of 1 | removed |\n| receipts | todo |  | removed |\n",
    );
  });

  test("no tasks on either side: nothing about tasks", () => {
    const noTasks = changed((p) => void delete (p as Plan).tasks);
    const base = baseFile((s) => void (s.tasks = []));
    expect(changes(out0(updated(noTasks), "report", "--base", base))).toBe("### Changes\n\nNo part changed.\n");
  });

  test.each<[string, (s: { tasks: Record<string, unknown>[] }) => void]>([
    ["tasks is null", (s) => void ((s as Record<string, unknown>).tasks = null)],
    ["two tasks with one id", (s) => void (s.tasks[1]!.id = "refund-flow")],
    ["a status that is not one of the three", (s) => void (s.tasks[1]!.status = "Done")],
    ["makes is not an array of strings", (s) => void (s.tasks[1]!.makes = [1])],
  ])("a base file that cannot be used: %s", (_name, edit) => {
    const out = run(["report", "--base", baseFile(edit)], updated(T()));
    expect(out.code).toBe(2);
    expect(out.stdout).toBe("");
    expect(out.stderr).toContain("cannot be used");
  });
});

test("check gives the tasks it read", () => {
  const result = check(repoOf(T()));
  if (result.kind !== "measured") throw new Error(result.message);
  expect(result.tasks.map((t) => [t.id, t.status, t.parts, t.makes.length - t.missing.length, t.makes.length])).toEqual([
    ["refund-flow", "doing", ["shop", "refund"], 1, 2],
    ["login-limit", "done", ["auth"], 1, 1],
    ["receipts", "todo", [], 0, 0],
  ]);
});
