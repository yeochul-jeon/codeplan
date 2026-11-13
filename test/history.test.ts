// The history command: the records of a directory as one HTML file.
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, test } from "vitest";
import { run, type RunResult } from "../src/cli.js";
import { lines, makeRepo, tempDir, type Tree } from "./helpers.js";
import { treeState } from "./page-helpers.js";
import { El, FakeDocument } from "./viewer-dom.js";

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
const planOf = (parts: Item[], more: Item = {}) => ({ format: 1, name: "", about: "", parts, ...more });
const SHOP = part("shop", ["src/shop/**"]);
const AUTH = part("auth", ["src/auth/**"]);

function repoWith(plan: unknown): string {
  const tree: Tree = { ...K };
  if (plan !== null) tree[PLAN_FILE] = JSON.stringify(plan, null, 2);
  return makeRepo(tree);
}
const setPlan = (repo: string, plan: unknown) => writeFileSync(join(repo, PLAN_FILE), JSON.stringify(plan, null, 2));
const add = (repo: string, path: string, n: number) => {
  mkdirSync(join(repo, path, ".."), { recursive: true });
  writeFileSync(join(repo, path), lines(n));
};
// A records directory outside every tree.
function folder(): string {
  const dir = join(tempDir(), "records");
  mkdirSync(dir);
  return dir;
}
// A record: what snapshot prints for the tree as it is now, after update
// when asked.
function take(repo: string, dir: string, name: string, update = false): void {
  if (update) expect(run(["update"], repo).code).toBe(0);
  const out = run(["snapshot"], repo);
  expect(out.code, out.stderr).toBe(0);
  writeFileSync(join(dir, `${name}.json`), out.stdout);
}
const put = (dir: string, name: string, text: string) => writeFileSync(join(dir, name), text);
const text = (dir: string, name: string) => readFileSync(join(dir, name), "utf8");

// Runs history twice: it writes nothing and prints the same both times.
function history(dir: string, ...more: string[]): RunResult {
  const before = treeState(dir);
  const out = run(["history", dir, ...more], tempDir());
  expect(run(["history", dir, ...more], tempDir())).toEqual(out);
  expect(treeState(dir)).toEqual(before);
  return out;
}

// A reader for the HTML that history prints: elements with attributes in
// double quotes, text with the four entities, and no element that has both
// text and child elements.
const ENTITY: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"' };
function decode(raw: string): string {
  expect(raw.replace(/&(amp|lt|gt|quot);/g, ""), raw).not.toMatch(/[&<>"]/);
  return raw.replace(/&(amp|lt|gt|quot);/g, (e) => ENTITY[e]!);
}
function parse(html: string, doc: FakeDocument): El {
  const token =
    /<!--[\s\S]*?-->|<!doctype html>|<(script|style)>([\s\S]*?)<\/\1>|<\/([a-z0-9]+)>|<([a-z0-9]+)((?:\s+[a-z-]+(?:="[^"]*")?)*)>|([^<]+)/gy;
  const root = new El("root", doc);
  const open = [root];
  let at = 0;
  for (;;) {
    token.lastIndex = at;
    const m = token.exec(html);
    if (m === null) break;
    at = token.lastIndex;
    const top = open[open.length - 1]!;
    const child = (name: string) => {
      expect(top.textContent, `text beside <${name}>`).toBe("");
      const el = new El(name, doc);
      Object.assign(el, { cellIndex: top.children.length });
      top.appendChild(el);
      return el;
    };
    if (m[1] !== undefined) child(m[1]).textContent = m[2]!;
    else if (m[3] !== undefined) expect(open.pop()!.name).toBe(m[3]);
    else if (m[4] !== undefined) {
      const el = child(m[4]);
      for (const a of m[5]!.matchAll(/([a-z-]+)(?:="([^"]*)")?/g)) el.setAttribute(a[1]!, decode(a[2] ?? ""));
      if (el.hasAttribute("id")) doc.byId.set(el.getAttribute("id")!, el);
      if (m[4] !== "meta") open.push(el);
    } else if (m[6] !== undefined && m[6].trim() !== "") {
      expect(top.children, `text beside elements in <${top.name}>`).toEqual([]);
      top.textContent += decode(m[6]);
    }
  }
  expect(at, html.slice(at, at + 40)).toBe(html.length);
  expect(open).toEqual([root]);
  return root;
}
const textOf = (el: El): string => el.textContent + el.children.map(textOf).join("");

interface Opened {
  root: El;
  doc: FakeDocument;
  sentences: string[];
  // Paragraphs between the table and the first section.
  after: string[];
  columns: { name: string; marks: string | null; same: string | null }[];
  parts: string[];
  // The text of each cell that has text, as "<part>/<record>".
  cells: Record<string, string>;
  content(name: string): string[];
  sections(): El[];
  buttons(): El[];
  button(name: string): El;
  // What is shown, pressed and marked now.
  state(): { shown: string[]; pressed: string[]; active: string[] };
  press(key: string): void;
}

// Reads the HTML and runs its two scripts, as a browser would.
function open(html: string, storage = new Map<string, string>()): Opened {
  const doc = new FakeDocument();
  const root = parse(html, doc);
  const all = () => root.all();
  const named = (name: string) => all().filter((e) => e.name === name);
  const main = named("main")[0]!;
  const table = all().filter((e) => e.getAttribute("data-role") === "records");
  expect(table).toHaveLength(1);
  const [head, ...rows] = table[0]!.children;
  const box = main.children.findIndex((c) => c.name === "div");
  const sections = () => all().filter((e) => e.name === "section");
  const heads = head!.children.filter((c) => c.hasAttribute("data-record"));
  expect(head!.children[0]!.textContent).toBe("Part");
  const cells: Record<string, string> = {};
  for (const row of rows) {
    expect(row.children).toHaveLength(head!.children.length);
    expect(row.children[0]!.textContent).toBe(row.getAttribute("data-part"));
    head!.children.forEach((h, i) => {
      const cell = row.children[i]!;
      if (i === 0) return;
      expect(cell.name).toBe("td");
      expect(cell.children).toEqual([]);
      if (h.hasAttribute("data-same")) expect(cell.textContent).toBe("");
      else if (cell.textContent !== "") cells[`${row.getAttribute("data-part")}/${h.getAttribute("data-record")}`] = cell.textContent;
    });
  }
  for (const h of heads) expect(h.children.filter((c) => c.name === "button")).toHaveLength(1);
  for (const s of sections()) expect(s.getAttribute("data-role")).toBe("record");
  expect(sections().map((s) => s.getAttribute("data-record"))).toEqual(heads.map((h) => h.getAttribute("data-record")));

  const select = (selector: string) => {
    const m = /^([a-z]+)\[([a-z-]+)(?:="([^"]*)")?\]$/.exec(selector)!;
    return all().filter((e) => e.name === m[1] && e.hasAttribute(m[2]!) && (m[3] === undefined || e.getAttribute(m[2]!) === m[3]));
  };
  Object.assign(doc, { documentElement: named("html")[0]!, querySelectorAll: select });
  const localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, String(v)),
    removeItem: (k: string) => void storage.delete(k),
  };
  const scripts = named("script").map((s) => s.textContent);
  expect(scripts).toHaveLength(2);
  for (const script of scripts) runInNewContext(script, { document: doc, localStorage });

  const buttons = () => heads.map((h) => h.children[0]!);
  return {
    root,
    doc,
    sentences: main.children.slice(0, box).map(textOf),
    after: main.children.slice(box + 1).filter((c) => c.name === "p").map(textOf),
    columns: heads.map((h) => {
      const next = head!.children[head!.children.indexOf(h) + 1];
      const same = next?.hasAttribute("data-same") ? next : undefined;
      if (same) expect(same.textContent).toBe(`${same.getAttribute("data-same")} same records`);
      expect(h.children[0]!.textContent).toBe(h.getAttribute("data-record"));
      // The words shown are the marks, with a space inside a mark.
      expect((h.children[1]?.textContent ?? "").replace(/not (measured|compared)/, "not-$1")).toBe(h.getAttribute("data-marks") ?? "");
      return { name: h.getAttribute("data-record")!, marks: h.getAttribute("data-marks"), same: same?.getAttribute("data-same") ?? null };
    }),
    parts: rows.map((r) => r.getAttribute("data-part")!),
    cells,
    content(name) {
      const section = sections().find((s) => s.getAttribute("data-record") === name)!;
      return section.children.map((block) =>
        block.name === "table" ? block.children.map((r) => `| ${r.children.map(textOf).join(" | ")} |`).join("\n") : textOf(block),
      );
    },
    sections,
    buttons,
    button: (name) => heads.find((h) => h.getAttribute("data-record") === name)!.children[0]!,
    state() {
      const active = all().filter((e) => e.hasAttribute("data-active"));
      // The marked elements are the head and the cells of one column.
      const marked = heads.filter((h) => h.hasAttribute("data-active"));
      const column = marked.flatMap((h) => [h, ...rows.map((r) => r.children[head!.children.indexOf(h)]!)]);
      expect(new Set(active)).toEqual(new Set(column));
      return {
        shown: sections().filter((s) => !s.hasAttribute("hidden")).map((s) => s.getAttribute("data-record")!),
        pressed: all().filter((e) => e.getAttribute("aria-pressed") === "true").map(textOf),
        active: marked.map((h) => h.getAttribute("data-record")!),
      };
    },
    press(key) {
      for (const fn of doc.listeners.get("keydown") ?? []) fn({ key });
    },
  };
}

// history for a directory that it can read, with nothing on standard error
// unless `stderr` is given.
function view(dir: string, stderr = ""): Opened {
  const out = history(dir);
  expect(out.code, out.stderr).toBe(0);
  expect(out.stderr).toBe(stderr);
  return open(out.stdout);
}

// K with plan P; r1 after update, r2 the same, r3 after a new file.
function sameThenMore(): string {
  const repo = repoWith(planOf([SHOP, AUTH]));
  const dir = folder();
  take(repo, dir, "r1", true);
  take(repo, dir, "r2");
  add(repo, "src/shop/extra.ts", 7);
  take(repo, dir, "r3");
  return dir;
}
const FIRST = "This is the first record, so there is nothing to compare.";
const PARTS = "| Part | Files | Lines | Change |";
const TASKS = "| Task | Status | Files | Change |";

describe("history: arguments and the directory", () => {
  test("a wrong argument or a directory with no snapshot: exit 2, one line, nothing printed", () => {
    const dir = sameThenMore();
    const empty = folder();
    const notes = folder();
    put(notes, "notes.md", "x\n");
    const marker = folder();
    put(marker, "x.failed", "x\n");
    const cwd = tempDir();
    const missing = join(cwd, "nowhere");
    const cases: string[][] = [
      ["history"],
      ["history", dir, dir],
      ["history", missing],
      ["history", join(dir, "r1.json")],
      ["history", "--repo", ".", dir],
      ["--repo", ".", "history", dir],
      ["history", dir, "--mermaid"],
      ["history", "-x", dir],
      ["history", empty],
      ["history", notes],
      ["history", marker],
    ];
    for (const args of cases) {
      const out = run(args, cwd);
      expect(out.code, args.join(" ")).toBe(2);
      expect(out.stdout).toBe("");
      expect(out.stderr, args.join(" ")).toMatch(/^codeplan: [^\n]+\n$/);
    }
    expect(run(["history", missing], cwd).stderr).toContain(missing);
  });

  test("a directory with only a skipped file: its line, then the reason", () => {
    const dir = folder();
    put(dir, "index.json", "[]");
    const out = history(dir);
    expect(out).toMatchObject({ code: 2, stdout: "" });
    expect(out.stderr).toMatch(/^history: skipped index\.json: not a snapshot\ncodeplan: [^\n]+\n$/);
  });

  test("help lists history", () => {
    expect(run(["help"], tempDir()).stdout).toContain("history <records-dir>");
  });
});

describe("history: records and columns", () => {
  test("a record that is the same as the one before is folded; a cell has the change in lines", () => {
    const v = view(sameThenMore());
    expect(v.sentences).toEqual(["The plan was not out of date in any record.", "The page was outdated in r3."]);
    expect(v.columns).toEqual([
      { name: "r1", marks: null, same: "1" },
      { name: "r3", marks: "page", same: null },
    ]);
    expect(v.parts).toEqual(["shop"]);
    expect(v.cells).toEqual({ "shop/r3": "+7" });
    expect(v.after).toEqual(["Parts not in the table: auth."]);
    expect(v.content("r1")).toEqual(["r1", "check: ok", "The next 1 records are the same: r2.", FIRST]);
    expect(v.content("r3")).toEqual(["r3", "check: fails (page outdated)", "Compared with r2.", `${PARTS}\n| shop | 2 → 3 | 5 → 12 | changed |`]);
    expect(v.sections()).toHaveLength(2);
    expect(v.sections().every((s) => s.hasAttribute("hidden"))).toBe(true);
    expect(v.state()).toEqual({ shown: [], pressed: [], active: [] });
  });

  function withOthers(): string {
    const dir = sameThenMore();
    put(dir, "r2b.failed", "codeplan: codeplan.json is not valid JSON\nsecond line\n");
    put(dir, "r2c.json", text(dir, "r1.json"));
    put(dir, "index.json", "[]");
    put(dir, "bad.json", "{");
    put(dir, "old.json", text(dir, "r1.json").replace('"snapshot": 1', '"snapshot": 2'));
    put(dir, "r1.failed", "late\n");
    put(dir, "notes.md", "x\n");
    put(dir, ".json", "");
    mkdirSync(join(dir, "sub.json"));
    symlinkSync(join(dir, "r1.json"), join(dir, "link.json"));
    return dir;
  }
  const SKIPPED = [
    "history: skipped bad.json: not JSON",
    "history: skipped index.json: not a snapshot",
    "history: skipped old.json: another version",
    "history: skipped r1.failed: a snapshot has the same name",
  ];
  const NOT_READ =
    "Files not read: bad.json (not JSON), index.json (not a snapshot), old.json (another version), r1.failed (a snapshot has the same name).";
  const expectOthers = (v: Opened) => {
    expect(v.sentences).toEqual(["The plan was not out of date in any record.", "The page was outdated in r3.", "Not measured: r2b.", NOT_READ]);
    expect(v.columns).toEqual([
      { name: "r1", marks: null, same: "1" },
      { name: "r2b", marks: "not-measured", same: null },
      { name: "r2c", marks: null, same: null },
      { name: "r3", marks: "page", same: null },
    ]);
    expect(v.cells).toEqual({ "shop/r3": "+7" });
    expect(v.content("r2b")).toEqual(["r2b", "Not measured: codeplan: codeplan.json is not valid JSON"]);
    expect(v.content("r2c")).toEqual(["r2c", "check: ok", "Compared with r2.", "No part changed."]);
    expect(v.content("r3")[2]).toBe("Compared with r2c.");
  };

  test("marker files, skipped files and names that are not read", () => {
    const dir = withOthers();
    expectOthers(view(dir, `${SKIPPED.join("\n")}\n`));

    // A marker beside a skipped candidate of the same name is skipped too.
    put(dir, "bad.failed", "x\n");
    const out = history(dir);
    expect(out.stderr).toBe(`history: skipped bad.failed: a snapshot has the same name\n${SKIPPED.join("\n")}\n`);
    expect(open(out.stdout).columns.map((c) => c.name)).toEqual(["r1", "r2b", "r2c", "r3"]);
  });

  test("an empty marker file; a first line that is long or has control characters", () => {
    const dir = withOthers();
    put(dir, "r2b.failed", "");
    expect(view(dir, `${SKIPPED.join("\n")}\n`).content("r2b")).toEqual(["r2b", "Not measured."]);
    put(dir, "r2b.failed", `a\tb${"가".repeat(300)}\r\nnext`);
    expect(view(dir, `${SKIPPED.join("\n")}\n`).content("r2b")).toEqual(["r2b", `Not measured: a�b${"가".repeat(197)}`]);
  });

  test("the same values with the keys in another order and an unknown key are the same record", () => {
    const dir = withOthers();
    const value = JSON.parse(text(dir, "r1.json")) as Item;
    const turned = Object.fromEntries([...Object.entries(value).reverse(), ["extra", 1]]);
    put(dir, "r2c.json", JSON.stringify(turned));
    expectOthers(view(dir, `${SKIPPED.join("\n")}\n`));
  });

  test("config keys in another order, or an unknown config key, are not a config change", () => {
    const dir = sameThenMore();
    const value = JSON.parse(text(dir, "r3.json")) as { config: Item };
    value.config = { ...Object.fromEntries(Object.entries(value.config).reverse()), extra: 1 };
    put(dir, "r3.json", JSON.stringify(value));
    const v = view(dir);
    expect(v.columns[1]).toEqual({ name: "r3", marks: "page", same: null });
    expect(v.content("r3")).toHaveLength(4);
    // With no other change it is the same record.
    put(dir, "r2.json", JSON.stringify({ ...JSON.parse(text(dir, "r1.json")), config: value.config }));
    expect(view(dir).columns[0]).toEqual({ name: "r1", marks: null, same: "1" });
  });

  test("a name with a control character and a file that cannot be read are skipped", () => {
    const dir = sameThenMore();
    put(dir, "a\tb.json", text(dir, "r1.json"));
    put(dir, "c\td.failed", "x\n");
    put(dir, "locked.json", text(dir, "r1.json"));
    put(dir, "shut.failed", "x\n");
    chmodSync(join(dir, "locked.json"), 0);
    chmodSync(join(dir, "shut.failed"), 0);
    const out = run(["history", dir], tempDir());
    chmodSync(join(dir, "locked.json"), 0o644);
    chmodSync(join(dir, "shut.failed"), 0o644);
    expect(out.code).toBe(0);
    expect(out.stderr).toBe(
      "history: skipped a\ufffdb.json: unsupported name\n" +
        "history: skipped c\ufffdd.failed: unsupported name\n" +
        "history: skipped locked.json: cannot read\n" +
        "history: skipped shut.failed: cannot read\n",
    );
    const v = open(out.stdout);
    expect(v.columns.map((c) => c.name)).toEqual(["r1", "r3"]);
    expect(v.sentences[2]).toBe(
      "Files not read: a\ufffdb.json (unsupported name), c\ufffdd.failed (unsupported name), locked.json (cannot read), shut.failed (cannot read).",
    );
  });

  test("a candidate that is not what snapshot prints is skipped", () => {
    const base = sameThenMore();
    const original = JSON.parse(text(base, "r1.json")) as Item & { parts: Item[] };
    const changed = (change: (value: Item & { parts: Item[] }) => void) => {
      const value = structuredClone(original);
      change(value);
      return JSON.stringify(value, null, 2);
    };
    const cases: [string, string][] = [
      [changed((v) => (v.page = "fine")), "not a snapshot"],
      [changed((v) => (v.parts[1]!.id = v.parts[0]!.id)), "not a snapshot"],
      [changed((v) => (v.parts[0]!.lines = -1)), "not a snapshot"],
      [changed((v) => (v.parts[0]!.files = 1.5)), "not a snapshot"],
      [changed((v) => delete v.rules), "not a snapshot"],
      [changed((v) => (v.diagnostics = [{ at: "plan", code: "x", severity: 1 }])), "not a snapshot"],
      [changed((v) => (v.rules = 2)), "another version"],
    ];
    for (const [file, reason] of cases) {
      const dir = folder();
      put(dir, "r1.json", text(base, "r1.json"));
      put(dir, "x.json", file);
      expect(history(dir).stderr, file).toBe(`history: skipped x.json: ${reason}\n`);
    }
  });
});

describe("history: marks, cells and what a record shows", () => {
  test("a plan that is out of date over several records", () => {
    const repo = repoWith(planOf([SHOP, AUTH]));
    const dir = folder();
    take(repo, dir, "a", true);
    add(repo, "src/misc/x.ts", 1);
    take(repo, dir, "b");
    add(repo, "src/misc/y.ts", 1);
    take(repo, dir, "b2");
    setPlan(repo, planOf([SHOP, AUTH, part("misc", ["src/misc/**"])]));
    take(repo, dir, "c", true);
    const v = view(dir);
    expect(v.sentences).toEqual(["The plan was out of date from b to b2.", "The page was outdated from b to b2."]);
    expect(v.columns).toEqual([
      { name: "a", marks: null, same: null },
      { name: "b", marks: "plan page", same: null },
      { name: "b2", marks: "plan", same: null },
      { name: "c", marks: "plan page", same: null },
    ]);
    expect(v.parts).toEqual(["misc"]);
    expect(v.cells).toEqual({ "misc/c": "new" });
    expect(v.after).toEqual(["Parts not in the table: shop, auth."]);
    expect(v.content("b")).toEqual(["b", "check: fails (1 orphan files, page outdated)", "Compared with a.", "No part changed."]);
    expect(v.content("b2")[1]).toBe("check: fails (2 orphan files, page outdated)");
    expect(v.content("c")).toEqual(["c", "check: ok", "Compared with b2.", `${PARTS}\n| misc | 2 | 2 | new |`]);
  });

  test("a config change marks the column and adds the sentence", () => {
    const repo = repoWith(planOf([SHOP, AUTH]));
    const dir = folder();
    take(repo, dir, "a", true);
    writeFileSync(join(repo, "codeplan.json"), '{"tests": true}');
    take(repo, dir, "b", true);
    const v = view(dir);
    expect(v.sentences).toEqual(["The plan was not out of date in any record.", "The page was up to date in every record."]);
    expect(v.columns[1]).toEqual({ name: "b", marks: "config", same: null });
    expect(v.cells).toEqual({ "shop/b": "+1" });
    expect(v.after).toEqual(["Parts not in the table: auth."]);
    expect(v.content("b")).toEqual([
      "b",
      "check: ok",
      "Compared with a.",
      `${PARTS}\n| shop | 2 → 3 | 5 → 6 | changed |`,
      "The config or part patterns changed, so some changes come from new rules, not new code.",
    ]);
  });

  test("a planned part that gets code, a change of no lines, a removed part, and the order of the rows", () => {
    const refund = part("refund", ["src/refund/**"], { planned: true });
    const repo = repoWith(planOf([SHOP, AUTH, refund]));
    const dir = folder();
    take(repo, dir, "a", true);
    add(repo, "src/refund/give.ts", 2);
    take(repo, dir, "b", true);
    add(repo, "src/shop/empty.ts", 0);
    take(repo, dir, "c", true);
    rmSync(join(repo, "src/auth"), { recursive: true });
    setPlan(repo, planOf([SHOP, refund]));
    take(repo, dir, "d", true);
    const v = view(dir);
    expect(v.sentences).toEqual(["The plan was out of date from b to d.", "The page was up to date in every record."]);
    expect(v.columns.map((c) => c.marks)).toEqual([null, "plan", null, "plan"]);
    expect(v.parts).toEqual(["shop", "refund", "auth"]);
    expect(v.cells).toEqual({ "refund/b": "+2", "shop/c": "+0", "auth/d": "removed" });
    expect(v.after).toEqual([]);
    expect(v.content("b")[3]).toBe(`${PARTS}\n| refund | 0 → 1 | 0 → 2 | planned, has code |`);
    expect(v.content("c")[3]).toBe(`${PARTS}\n| shop | 2 → 3 | 5 → 5 | changed |`);
    expect(v.content("d")[3]).toBe(`${PARTS}\n| auth | 1 | 4 | removed |`);
    for (const name of ["b", "c", "d"]) expect(v.content(name)[1]).toBe("check: fails (1 warnings)");
  });

  test("fewer lines have a minus sign", () => {
    const repo = repoWith(planOf([SHOP, AUTH]));
    const dir = folder();
    take(repo, dir, "a", true);
    rmSync(join(repo, "src/shop/pay.ts"));
    take(repo, dir, "b", true);
    expect(view(dir).cells).toEqual({ "shop/b": "-2" });
  });

  test("columns that are not compared", () => {
    const repo = repoWith(null);
    const dir = folder();
    take(repo, dir, "a");
    add(repo, PLAN_FILE, 0);
    setPlan(repo, planOf([SHOP, AUTH]));
    take(repo, dir, "b", true);
    setPlan(repo, planOf([SHOP, part("auth", [""])]));
    take(repo, dir, "c");
    setPlan(repo, planOf([SHOP, AUTH]));
    take(repo, dir, "d");
    const v = view(dir);
    expect(v.sentences).toEqual([
      "The plan was out of date in a.",
      "The plan was out of date in c.",
      "The page was not compared in a.",
      "The page was not compared in c.",
    ]);
    expect(v.columns.map((c) => c.marks)).toEqual(["plan page", "plan page not-compared", "plan page not-compared", "plan page not-compared"]);
    expect(v.parts).toEqual([]);
    expect(v.after).toEqual(["Parts not in the table: shop, auth."]);
    expect(v.content("a")).toEqual(["a", "check: fails (1 warnings, 3 orphan files)", FIRST]);
    expect(v.content("b")).toEqual(["b", "check: ok", "Compared with a.", "No plan in the record before, so there is nothing to compare."]);
    expect(v.content("c")).toEqual([
      "c",
      "check: fails (1 errors, measurement incomplete)",
      "Compared with b.",
      "Measurement is incomplete in this record, so changes are not shown.",
    ]);
    expect(v.content("d")).toEqual(["d", "check: ok", "Compared with c.", "Measurement is incomplete in the record before, so changes are not shown."]);
  });

  test("a record with no plan file is compared: every part is removed", () => {
    const repo = repoWith(planOf([SHOP, AUTH]));
    const dir = folder();
    take(repo, dir, "a", true);
    rmSync(join(repo, PLAN_FILE));
    take(repo, dir, "b");
    const v = view(dir);
    expect(v.sentences).toEqual(["The plan was out of date in b.", "The page was not compared in b."]);
    expect(v.columns[1]).toEqual({ name: "b", marks: "plan page", same: null });
    expect(v.parts).toEqual(["shop", "auth"]);
    expect(v.cells).toEqual({ "shop/b": "removed", "auth/b": "removed" });
    expect(v.content("b")).toEqual([
      "b",
      "check: fails (1 warnings, 3 orphan files)",
      "Compared with a.",
      `${PARTS}\n| shop | 2 | 5 | removed |\n| auth | 1 | 4 | removed |`,
    ]);
  });

  test("tasks that change", () => {
    const task = (status: string) => ({ tasks: [{ id: "limit", name: "", status, makes: ["src/auth/limit.ts"] }] });
    const repo = repoWith(planOf([SHOP, AUTH], task("todo")));
    const dir = folder();
    take(repo, dir, "a", true);
    setPlan(repo, planOf([SHOP, AUTH], task("doing")));
    take(repo, dir, "b", true);
    add(repo, "src/auth/limit.ts", 2);
    take(repo, dir, "c", true);
    const v = view(dir);
    expect(v.columns.map((c) => c.marks)).toEqual([null, "tasks", "tasks"]);
    expect(v.parts).toEqual(["auth"]);
    expect(v.cells).toEqual({ "auth/c": "+2" });
    expect(v.after).toEqual(["Parts not in the table: shop."]);
    expect(v.content("b")).toEqual(["b", "check: ok", "Compared with a.", "No part changed.", `${TASKS}\n| limit | todo → doing | 0 of 1 → 0 of 1 | changed |`]);
    expect(v.content("c")).toEqual([
      "c",
      "check: ok",
      "Compared with b.",
      `${PARTS}\n| auth | 1 → 2 | 4 → 6 | changed |`,
      `${TASKS}\n| limit | doing → doing | 0 of 1 → 1 of 1 | changed |`,
    ]);

    // A record from before tasks has no tasks key.
    const old = JSON.parse(text(dir, "a.json")) as Item;
    delete old.tasks;
    put(dir, "a.json", JSON.stringify(old, null, 2));
    const w = view(dir);
    expect(w.columns[1]!.marks).toBe("tasks");
    expect(w.content("b")[4]).toBe(`${TASKS}\n| limit | doing | 0 of 1 | new |`);
  });

  test("the task table has 30 rows and says how many more; a plan with errors shows no task changes", () => {
    const dir = sameThenMore();
    const value = JSON.parse(text(dir, "r1.json")) as Item;
    value.tasks = Array.from({ length: 31 }, (_, i) => ({ id: `t${i}`, status: "todo", makes: [], missing: [] }));
    put(dir, "r2.json", JSON.stringify(value));
    const blocks = view(dir).content("r2");
    expect(blocks[3]).toBe("No part changed.");
    expect(blocks[4]!.split("\n")).toHaveLength(31);
    expect(blocks[5]).toBe("And 1 more rows.");

    put(dir, "r2.json", JSON.stringify({ ...value, plan: "invalid" }));
    const v = view(dir);
    expect(v.columns[1]).toEqual({ name: "r2", marks: "plan tasks", same: null });
    expect(v.content("r2").slice(3)).toEqual(["No part changed.", "The plan has errors, so task changes are not shown."]);
  });
});

describe("history: the file", () => {
  const TOKENS = [
    "--cp-bg", "--cp-text", "--cp-text-dim", "--cp-part-fill", "--cp-part-line", "--cp-ext-fill", "--cp-ext-line",
    "--cp-zone-fill", "--cp-zone-line", "--cp-zone-title", "--cp-edge", "--cp-connector", "--cp-active",
    "--cp-control-fill", "--cp-control-line", "--cp-control-text",
  ];

  test("starts with its mark, loads nothing, and has no path or directory name", () => {
    const dir = sameThenMore();
    const html = history(dir).stdout;
    expect(html.startsWith("<!doctype html><!-- codeplan history -->")).toBe(true);
    expect(html).not.toContain("\r");
    expect(html).toContain("<title>codeplan history</title>");
    for (const absent of ["http://", "https://", "//", "setInterval", "requestAnimationFrame", "src/shop", dir, basename(join(dir, ".."))]) {
      expect(html).not.toContain(absent);
    }
    expect(html).not.toMatch(/transition|dashed|dotted|dasharray|scroll-snap|text-transform|letter-spacing|<select/);

    const copy = join(tempDir(), "another-name");
    cpSync(dir, copy, { recursive: true });
    expect(history(copy).stdout).toBe(html);

    // At the page place it is not a codeplan page.
    const repo = repoWith(planOf([SHOP, AUTH]));
    writeFileSync(join(repo, "docs/codeplan/codeplan.html"), html);
    const out = run(["check"], repo);
    expect(out.code).toBe(2);
    expect(out.stderr).toContain("not a codeplan page");
  });

  test("the frame keeps colours in token definitions", () => {
    const html = history(sameThenMore()).stdout;
    const css = html.slice(html.indexOf("<style>") + 7, html.indexOf("</style>"));
    const defined = [...css.matchAll(/(--cp-[a-z-]+)\s*:/g)].map((m) => m[1]!);
    expect([...new Set(defined)].sort()).toEqual([...TOKENS].sort());
    const uses = [...html.matchAll(/var\(([^)]*)\)/g)].map((m) => m[1]!.trim());
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(TOKENS, u).toContain(u);
    const withoutDefs = html.replace(/--cp-[a-z-]+\s*:\s*[^;]+;/g, "");
    expect(withoutDefs).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/);
    for (const m of withoutDefs.matchAll(/(?:^|[;{\s])(fill|stroke|color|background(?:-color)?|border(?:-(?:top|right|bottom|left|color))?|box-shadow)\s*:\s*([^;}]+)/g)) {
      const value = m[2]!
        .replace(/var\(--cp-[a-z-]+\)/g, "")
        .replace(/\b(none|transparent|currentColor|inherit|solid|inset|\d+(\.\d+)?(px)?)\b|[,-]/g, "")
        .trim();
      expect(value, `${m[1]}: ${m[2]}`).toBe("");
    }
    for (const rule of [
      /html, body \{[^}]*background: var\(--cp-bg\)[^}]*color: var\(--cp-text\)/,
      /th span \{[^}]*color: var\(--cp-text-dim\)/,
      /th span \{ display: block; width: min-content; white-space: normal;/,
      /th\[data-record\] button \{ writing-mode: vertical-rl; padding: 8px 2px; font-variant-numeric: tabular-nums; \}/,
      /th\[data-same\] \{ color: var\(--cp-text-dim\); white-space: normal; width: 4\.5em; max-width: 4\.5em; \}/,
      /td:not\(:empty\) \{ background: var\(--cp-part-fill\); box-shadow: [^;]*var\(--cp-part-line\)/,
      /\[data-active\] \{ box-shadow: [^;]*var\(--cp-active\)[^}]*font-weight: 700/,
      /button \{ background: var\(--cp-control-fill\); color: var\(--cp-control-text\); border: 1px solid var\(--cp-control-line\)/,
      /:root \{ color-scheme: light dark;/,
      /@media \(prefers-color-scheme: dark\) \{ :root:not\(\[data-theme\]\)/,
    ]) {
      expect(css).toMatch(rule);
    }
    expect(html.indexOf("codeplan-theme")).toBeLessThan(html.indexOf("<body>"));
  });

  test("one theme button that cycles auto, light, dark and stores light or dark only", () => {
    const html = history(sameThenMore()).stdout;
    const storage = new Map<string, string>();
    const v = open(html, storage);
    const buttons = v.root.all().filter((e) => e.getAttribute("data-role") === "theme");
    expect(buttons).toHaveLength(1);
    const now = () => [v.doc.documentElement.getAttribute("data-theme"), buttons[0]!.textContent, storage.get("codeplan-theme")];
    expect(now()).toEqual([null, "auto", undefined]);
    buttons[0]!.dispatch("click");
    expect(now()).toEqual(["light", "light", "light"]);
    buttons[0]!.dispatch("click");
    expect(now()).toEqual(["dark", "dark", "dark"]);
    expect(v.state()).toEqual({ shown: [], pressed: [], active: [] });
    // A stored theme is applied by the script in the head.
    expect(open(html, storage).doc.documentElement.getAttribute("data-theme")).toBe("dark");
    buttons[0]!.dispatch("click");
    expect(now()).toEqual([null, "auto", undefined]);
  });

  test("choosing a record shows its section and marks its column; again, or Esc, ends it", () => {
    const repo = repoWith(planOf([SHOP, AUTH]));
    const dir = folder();
    take(repo, dir, "a", true);
    add(repo, "src/misc/x.ts", 1);
    take(repo, dir, "b");
    setPlan(repo, planOf([SHOP, AUTH, part("misc", ["src/misc/**"])]));
    take(repo, dir, "c", true);
    const v = view(dir);
    const none = { shown: [], pressed: [], active: [] };
    expect(v.state()).toEqual(none);
    expect(v.buttons().map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "false"]);
    v.button("b").dispatch("click");
    expect(v.state()).toEqual({ shown: ["b"], pressed: ["b"], active: ["b"] });
    v.button("c").dispatch("click");
    expect(v.state()).toEqual({ shown: ["c"], pressed: ["c"], active: ["c"] });
    expect(v.buttons().map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "true"]);
    v.button("c").dispatch("click");
    expect(v.state()).toEqual(none);
    expect(v.buttons().map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "false"]);
    v.button("a").dispatch("click");
    expect(v.state().shown).toEqual(["a"]);
    v.press("Escape");
    expect(v.state()).toEqual(none);
    const all = v.root.all();
    expect(all.filter((e) => e.name === "select")).toEqual([]);
    for (const el of all.filter((e) => e.name === "td" || e.hasAttribute("data-same"))) expect(el.children).toEqual([]);
  });

  test("names are written as text and ordered by code unit", () => {
    const base = sameThenMore();
    const dir = folder();
    for (const name of ["Z", "a", 'a<b>&"c']) put(dir, `${name}.json`, text(base, "r1.json"));
    for (const name of ['b<i>&"d', "가"]) put(dir, `${name}.json`, text(base, "r3.json"));
    const out = history(dir);
    expect(out.stdout).not.toMatch(/<[bi]>/);
    const v = open(out.stdout);
    expect(v.columns).toEqual([
      { name: "Z", marks: null, same: "2" },
      { name: 'b<i>&"d', marks: "page", same: "1" },
    ]);
    expect(v.content("Z")[2]).toBe('The next 2 records are the same: a, a<b>&"c.');
    expect(v.content('b<i>&"d').slice(2, 4)).toEqual(["The next 1 records are the same: 가.", 'Compared with a<b>&"c.']);
    expect(v.sentences[1]).toBe('The page was outdated from b<i>&"d to 가.');
  });

  test("long lists stop at 30 names", () => {
    const base = sameThenMore();
    const dir = folder();
    const two = (n: number) => String(n).padStart(2, "0");
    for (let i = 1; i <= 40; i++) put(dir, `n${two(i)}.json`, text(base, "r1.json"));
    for (let i = 1; i <= 31; i++) put(dir, `m${two(i)}.failed`, "x");
    const v = view(dir);
    const names = (prefix: string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${two(from + i)}`).join(", ");
    expect(v.sentences[2]).toBe(`Not measured: ${names("m", 1, 30)}, and 1 more.`);
    expect(v.columns).toHaveLength(32);
    expect(v.columns.slice(0, 31).every((c) => c.marks === "not-measured")).toBe(true);
    expect(v.columns[31]).toEqual({ name: "n01", marks: null, same: "39" });
    expect(v.content("n01")[2]).toBe(`The next 39 records are the same: ${names("n", 2, 31)}, and 9 more.`);
  });
});
