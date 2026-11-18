// Findings of evidence entries with a stamp in snapshot (`entry`,
// `stampEntries`) and their comparison in report --base.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { run } from "../src/cli.js";
import { reportText, type Snapshot } from "../src/report.js";
import { plain } from "../src/summary.js";
import { makeRepo, tempDir } from "./helpers.js";

const PLAN_FILE = "docs/codeplan/plan.json";
const H = (content: string) => createHash("sha256").update(content).digest("hex").slice(0, 8);

type Item = Record<string, any>;
const part = (id: string, paths: string[], more: Item = {}): Item => ({ id, name: id, about: "", paths, ...more });
const planOf = (parts: Item[]) => JSON.stringify({ format: 1, name: "", about: "", parts });
const use = (to: string, evidence: unknown[]): Item => ({ to, evidence });

// f.ts has the lines x, y, z.
function repoOf(parts: Item[] | string | null, more: Record<string, string> = {}): string {
  return makeRepo({
    "package.json": "{}\n",
    "src/a.ts": "x\n",
    "lib/b.ts": "x\n",
    "f.ts": "x\ny\nz\n",
    ...(parts === null ? {} : { [PLAN_FILE]: typeof parts === "string" ? parts : planOf(parts) }),
    ...more,
  });
}
const withUses = (uses: Item[], more: Item[] = []) => repoOf([part("a", ["src/**"], { uses }), part("b", ["lib/**"]), ...more]);

function snap(repo: string): Item {
  const out = run(["snapshot"], repo);
  expect(out.code, out.stderr).toBe(0);
  return JSON.parse(out.stdout);
}
function stampsOf(repo: string): Item[] {
  const out = run(["stamps"], repo).stdout;
  return out === "" ? [] : out.slice(0, -1).split("\n").map((l) => JSON.parse(l));
}

const ELSEWHERE = `f.ts:1#${H("y")}`;
const DIFFERS = `f.ts:1#${H("q")}`;
const NO_LINE = `f.ts:9#${H("q")}`;
const NO_FILE = `g.ts:1#${H("q")}`;
const SAME = `f.ts:1#${H("x")}`;

describe("entry", () => {
  test("on each of the four codes of an entry with a stamp, last, and the same as the stamps line", () => {
    const repo = withUses([use("b", [SAME, ELSEWHERE, DIFFERS, NO_LINE, NO_FILE, "f.ts:9", "g.ts:2", "f.ts:x"])]);
    const s = snap(repo);
    const byAt = new Map(stampsOf(repo).map((l) => [l.at, l]));
    const found = s.diagnostics.filter((d: Item) => d.code.startsWith("evidence-"));
    expect(found.map((d: Item) => [d.code, "entry" in d])).toEqual([
      ["evidence-stamp-elsewhere", true],
      ["evidence-stamp-differs", true],
      ["evidence-no-line", true],
      ["evidence-no-file", true],
      ["evidence-no-line", false],
      ["evidence-no-file", false],
      ["evidence-not-read", false],
    ]);
    for (const d of found.filter((d: Item) => "entry" in d)) {
      expect(Object.keys(d)).toEqual(["at", "code", "severity", "message", "fix", "entry"]);
      const l = byAt.get(d.at)!;
      expect(d.entry).toEqual({ part: l.part, to: l.to, evidence: l.evidence });
    }
    expect(s.diagnostics.filter((d: Item) => !d.code.startsWith("evidence-") && "entry" in d)).toEqual([]);
  });

  test("the evidence string as written: tab, LF, # and : in the path", () => {
    const path = "d\tx\ny#z:w.ts";
    const evidence = `${path}:1#${H("q")}`;
    const repo = withUses([use("b", [evidence])]);
    mkdirSync(join(repo, "d\tx\ny#z:w.ts", ".."), { recursive: true });
    writeFileSync(join(repo, path), "a\n");
    const d = snap(repo).diagnostics.find((d: Item) => d.code === "evidence-stamp-differs");
    expect(d.entry).toEqual({ part: "a", to: "b", evidence });
    expect(stampsOf(repo)[0]).toMatchObject({ part: "a", to: "b", evidence });
  });

  test("none when the part id or to is not of the id form; still counted", () => {
    const repo = repoOf([part("A b", ["src/**"], { uses: [use("b", [DIFFERS])] }), part("b", ["lib/**"], { uses: [use("Q!", [DIFFERS])] })]);
    const s = snap(repo);
    const found = s.diagnostics.filter((d: Item) => d.code === "evidence-stamp-differs");
    expect(found).toHaveLength(2);
    expect(found.some((d: Item) => "entry" in d)).toBe(false);
    expect(s.stampEntries).toEqual({ entries: 2, elsewhere: 0, differs: 2, noLine: 0, noFile: 0 });
  });

  test("the same three values twice: none on either; another to: both", () => {
    const twice = (uses: Item[]) =>
      snap(withUses(uses, [part("c", ["c/**"])])).diagnostics.filter((d: Item) => d.code === "evidence-stamp-differs").map((d: Item) => "entry" in d);
    expect(twice([use("b", [DIFFERS, DIFFERS])])).toEqual([false, false]);
    expect(twice([use("b", [DIFFERS]), use("b", [DIFFERS])])).toEqual([false, false]);
    expect(twice([use("b", [DIFFERS]), use("c", [DIFFERS])])).toEqual([true, true]);
    // Other codes with the same three values are the same entry too.
    expect(twice([use("b", [DIFFERS]), use("b", [`f.ts:1#${H("q")}`, NO_LINE])])).toEqual([false, false]);
  });
});

describe("stampEntries", () => {
  test("no key without an evidence entry with a stamp, no plan file, or a plan that is not an object", () => {
    expect("stampEntries" in snap(withUses([use("b", ["f.ts:1"])]))).toBe(false);
    expect("stampEntries" in snap(withUses([use("b", ["gone.ts:1"])]))).toBe(false);
    expect("stampEntries" in snap(repoOf(null))).toBe(false);
    expect("stampEntries" in snap(repoOf("[]"))).toBe(false);
  });

  test("there with zeros; each count; entries is the ones with no finding plus the rest", () => {
    expect(snap(withUses([use("b", [SAME, "f.ts:2"])])).stampEntries).toEqual({ entries: 1, elsewhere: 0, differs: 0, noLine: 0, noFile: 0 });
    const s = snap(withUses([use("b", [SAME, SAME, ELSEWHERE, DIFFERS, NO_LINE, NO_LINE, NO_FILE])]));
    expect(s.stampEntries).toEqual({ entries: 7, elsewhere: 1, differs: 1, noLine: 2, noFile: 1 });
    expect(Object.keys(s)).toEqual([
      "snapshot", "rules", "config", "plan", "complete", "page", "parts", "jsImports", "stampEntries",
      "owned", "orphans", "contested", "unwatched", "tasks", "diagnostics",
    ]);
  });

  test("after parts when there is no jsImports", () => {
    const repo = withUses([use("b", [SAME])]);
    writeFileSync(join(repo, "codeplan.json"), JSON.stringify({ languages: ["java"] }));
    const keys = Object.keys(snap(repo));
    expect(keys.slice(keys.indexOf("parts"), keys.indexOf("parts") + 3)).toEqual(["parts", "stampEntries", "owned"]);
  });

  test("the later part of repeated-id is not counted, the first is", () => {
    const s = snap(repoOf([part("a", ["src/**"], { uses: [use("b", [DIFFERS])] }), part("b", ["lib/**"]), part("a", ["c/**"], { uses: [use("b", [NO_LINE])] })]));
    expect(s.stampEntries).toEqual({ entries: 1, elsewhere: 0, differs: 1, noLine: 0, noFile: 0 });
  });

  test("counted with counting incomplete, a contested file and an invalid plan", () => {
    const counts = { entries: 1, elsewhere: 1, differs: 0, noLine: 0, noFile: 0 };
    const incomplete = snap(repoOf([part("a", ["src/**"], { uses: [use("b", [ELSEWHERE])] }), part("b", ["lib/**"]), { id: "c", name: "c", about: "", paths: 5 }]));
    expect(incomplete.complete).toBe(false);
    expect(incomplete.stampEntries).toEqual(counts);
    const contested = snap(repoOf([part("a", ["src/**"], { uses: [use("b", [ELSEWHERE])] }), part("b", ["lib/**", "src/**"])]));
    expect(contested.contested).not.toEqual([]);
    expect(contested.stampEntries).toEqual(counts);
    const invalid = snap(repoOf([part("a", ["src/**"], { uses: [use("b", [ELSEWHERE])] }), part("b", ["lib/**"]), { id: "x" }]));
    expect(invalid.plan).toBe("invalid");
    expect(invalid.stampEntries).toEqual(counts);
  });
});

// A base snapshot file changed by `change`, and report with it.
function reportWith(head: string, change: (s: Item) => void): ReturnType<typeof run> {
  const s = snap(withUses([use("b", [DIFFERS])]));
  change(s);
  const file = join(tempDir(), "base.json");
  writeFileSync(file, JSON.stringify(s));
  return run(["report", "--base", file], head);
}

describe("--base", () => {
  const head = () => withUses([use("b", [DIFFERS])]);
  const refused = "codeplan: cannot use the base snapshot";

  test.each([
    ["counts not an object", (s: Item) => (s.stampEntries = [1, 0, 0, 0, 0])],
    ["a count missing", (s: Item) => delete s.stampEntries.noFile],
    ["a negative count", (s: Item) => (s.stampEntries.differs = -1)],
    ["a fraction", (s: Item) => (s.stampEntries.differs = 0.5)],
    ["1e100", (s: Item) => (s.stampEntries.entries = 1e100)],
    ["a string", (s: Item) => (s.stampEntries.entries = "1")],
    ["entry null", (s: Item) => (s.diagnostics.at(-1).entry = null)],
    ["entry a number", (s: Item) => (s.diagnostics.at(-1).entry = 5)],
    ["a value not a string", (s: Item) => (s.diagnostics.at(-1).entry.to = 1)],
    ["on another code", (s: Item) => (s.diagnostics.push({ at: "x", code: "bad-shape", severity: "error", message: "", fix: "", entry: [] }))],
  ])("refused: %s", (_name, change) => {
    const out = reportWith(head(), change);
    expect(out.code).toBe(2);
    expect(out.stdout).toBe("");
    expect(out.stderr.startsWith(refused) || out.stderr.startsWith("codeplan: ")).toBe(true);
    expect(out.stderr).toContain("stampEntries or an entry of its diagnostics");
  });

  test("unknown keys in entry are read; an entry on another code is not compared", () => {
    const out = reportWith(head(), (s) => {
      s.diagnostics.at(-1).entry.more = 1;
      s.diagnostics.push({ at: "x", code: "bad-shape", severity: "error", message: "", fix: "", entry: { part: "p", to: "q", evidence: "e" } });
    });
    expect(out.code, out.stderr).toBe(0);
    expect(out.stdout).toContain("No entry is newly reported or no longer reported.");
  });
});

// Snapshots made by hand for report.
const BLANK = (() => {
  const s = snap(withUses([use("b", [SAME])]));
  delete s.jsImports;
  delete s.stampEntries;
  s.diagnostics = [];
  s.tasks = [];
  return s as Snapshot;
})();
const counts = (entries: number, elsewhere = 0, differs = 0, noLine = 0, noFile = 0) => ({ entries, elsewhere, differs, noLine, noFile });
let n = 0;
const finding = (code: string, entry?: Item) => ({
  at: `parts[0].uses[0].evidence[${n++}]`,
  code: `evidence-${code}`,
  severity: "info",
  message: "m",
  fix: "f",
  ...(entry && { entry }),
});
const e = (evidence: string, part = "a", to = "b") => ({ part, to, evidence });
const side = (stampEntries: Item | undefined, diagnostics: Item[] = [], more: Item = {}): Snapshot =>
  ({ ...BLANK, ...(stampEntries && { stampEntries }), diagnostics, ...more }) as Snapshot;
// The stamp block of the report, or null.
function block(head: Snapshot, base: Snapshot | null): string | null {
  const text = reportText(head, base);
  const at = text.indexOf("### Evidence entries with a stamp\n");
  if (at < 0) return null;
  const end = text.indexOf("\n\n### ", at + 1);
  return text.slice(at, end < 0 ? -1 : end);
}

const TITLE = "### Evidence entries with a stamp";
const SCOPE =
  "Entries are paired only when the part id, the `to` value and the evidence string are the same; writing any of them differently makes another entry. That an entry is no longer reported does not mean it was fixed.";
const EMPTY = "No entry is newly reported or no longer reported. An entry whose finding changed is not listed.";
const COUNTS = (c: number[]) =>
  `${c[0]} evidence entries with a stamp, ${c[1]} with the stamp on one other line, ${c[2]} without the stamp on the written line, ${c[3]} with no such line, ${c[4]} with no such file.`;
const lines = (...items: Item[]) => items.map((x) => `- part ${plain(x.part)} to ${plain(x.to)}: ${plain(x.evidence)}`).join("\n");

describe("report: the four cases", () => {
  test("without --base: the counts only", () => {
    expect(block(side(counts(3, 1, 0, 2)), null)).toBe(`${TITLE}\n\n${COUNTS([3, 1, 0, 2, 0])}`);
  });

  test("both: the base's counts, the lists or the empty sentence, the scope paragraph", () => {
    const head = side(counts(2, 1), [finding("stamp-elsewhere", e("f:1#00000000"))]);
    const base = side(counts(4, 0, 1, 1, 1), []);
    expect(block(head, base)).toBe(
      `${TITLE}\n\n${COUNTS([2, 1, 0, 0, 0])} In the base: 4, 0, 1, 1, 1.\n\nReported in the head and not in the base:\n\n${lines(e("f:1#00000000"))}\n\n${SCOPE}`,
    );
    expect(block(side(counts(1)), side(counts(1)))).toBe(`${TITLE}\n\n${COUNTS([1, 0, 0, 0, 0])} In the base: 1, 0, 0, 0, 0.\n\n${EMPTY}\n\n${SCOPE}`);
  });

  test("only the head: one sentence, no list, no scope paragraph", () => {
    const head = side(counts(1, 1), [finding("stamp-elsewhere", e("x:1#00000000"))]);
    expect(block(head, side(undefined, [finding("stamp-differs", e("y:1#00000000"))]))).toBe(
      `${TITLE}\n\n${COUNTS([1, 1, 0, 0, 0])}\n\nThe base snapshot does not have these counts, so the entries are not compared.`,
    );
  });

  test("only the base: one sentence with the base's number", () => {
    expect(block(side(undefined), side(counts(5, 1)))).toBe(
      `${TITLE}\n\nThe head snapshot does not have these counts. The base had 5 evidence entries with a stamp.`,
    );
  });

  test("neither: the report is as before", () => {
    expect(block(side(undefined), side(undefined))).toBeNull();
    expect(block(side(undefined), null)).toBeNull();
  });

  test("not held back by a base with no plan or a head with counting incomplete", () => {
    expect(block(side(counts(1), [], { complete: false }), side(counts(1), [], { plan: "missing" }))).toContain(EMPTY);
  });
});

describe("report: the lists", () => {
  const A = e("a.ts:1#00000001");
  const B = e("b.ts:1#00000002");
  const C = e("c.ts:1#00000003");
  test("only the first list, only the second, both; a changed code is in neither", () => {
    const head = side(counts(3, 1, 1), [finding("stamp-elsewhere", A), finding("stamp-differs", C)]);
    const base = side(counts(3, 0, 1, 0, 1), [finding("no-file", B), finding("stamp-elsewhere", C)]);
    expect(block(head, base)).toBe(
      `${TITLE}\n\n${COUNTS([3, 1, 1, 0, 0])} In the base: 3, 0, 1, 0, 1.\n\n` +
        `Reported in the head and not in the base:\n\n${lines(A)}\n\nReported in the base and not in the head:\n\n${lines(B)}\n\n${SCOPE}`,
    );
    const onlyGone = block(side(counts(1)), base)!;
    expect(onlyGone).not.toContain("Reported in the head");
    expect(onlyGone).toContain(`Reported in the base and not in the head:\n\n${lines(B, C)}`);
    // elsewhere → differs and differs → no-file: in neither list.
    expect(block(side(counts(2), [finding("stamp-differs", A), finding("no-file", C)]), side(counts(2), [finding("stamp-elsewhere", A), finding("stamp-differs", C)]))).toContain(EMPTY);
  });

  test("30 items, then the number of the rest, in each list", () => {
    const many = (p: string) => Array.from({ length: 31 }, (_, i) => finding("stamp-differs", e(`${p}${i}.ts:1#00000000`)));
    const text = block(side(counts(31), many("h")), side(counts(31), many("b")))!;
    expect(text.match(/^- and 1 more$/gm)).toHaveLength(2);
    expect(text.match(/^- part /gm)).toHaveLength(60);
  });

  test("the three values go through the Markdown escape", () => {
    const odd = { part: "p|*", to: "<t>", evidence: "a\nb|c*:1#00000000" };
    const text = block(side(counts(1)), side(counts(1), [finding("stamp-differs", odd)]))!;
    expect(text).toContain(`- part ${plain(odd.part)} to ${plain(odd.to)}: ${plain(odd.evidence)}`);
    expect(text).not.toContain("<t>");
  });

  test("the counts come from the key, the lists from diagnostics", () => {
    expect(block(side(counts(0)), side(counts(9, 9), [finding("no-line", A)]))).toBe(
      `${TITLE}\n\n${COUNTS([0, 0, 0, 0, 0])} In the base: 9, 9, 0, 0, 0.\n\nReported in the base and not in the head:\n\n${lines(A)}\n\n${SCOPE}`,
    );
  });
});

describe("report: not compared", () => {
  const notCompared = (k: number) =>
    `${k} entries were not compared: their part id or \`to\` value is not of the right form, or the same entry is written more than once.`;
  const A = e("a.ts:1#00000001");

  test("the same entry two or three times in the base: all left out and counted", () => {
    const base = side(counts(4), [finding("stamp-differs", A), finding("no-line", A), finding("stamp-elsewhere", A), finding("no-file", e("z:1#00000000"))]);
    const text = block(side(counts(1), [finding("stamp-differs", A)]), base)!;
    expect(text).toContain(`Reported in the head and not in the base:\n\n${lines(A)}`);
    expect(text).toContain(`Reported in the base and not in the head:\n\n${lines(e("z:1#00000000"))}`);
    expect(text.endsWith(`${SCOPE}\n\n${notCompared(3)}`)).toBe(true);
  });

  test("findings with no entry: elsewhere and differs on both sides, not no-line or no-file", () => {
    const head = side(counts(3), [finding("stamp-elsewhere"), finding("no-line"), finding("no-file")]);
    const base = side(counts(2), [finding("stamp-differs"), finding("no-line")]);
    expect(block(head, base)!.endsWith(`${SCOPE}\n\n${notCompared(2)}`)).toBe(true);
    expect(block(side(counts(1), [finding("no-line")]), side(counts(1)))!.endsWith(SCOPE)).toBe(true);
  });

  test("100,000 of the same entry, and 100,000 different ones on each side, end in time", () => {
    const same = Array.from({ length: 100_000 }, () => finding("stamp-differs", A));
    let start = Date.now();
    expect(block(side(counts(1)), side(counts(100_000), same))!.endsWith(notCompared(100_000))).toBe(true);
    const many = (p: string) => Array.from({ length: 100_000 }, (_, i) => finding("stamp-differs", e(`${p}${i}:1#00000000`)));
    const head = side(counts(100_000), many("h"));
    const base = side(counts(100_000), many("b"));
    expect(Date.now() - start).toBeLessThan(5000);
    start = Date.now();
    expect(block(head, base)).toContain("- and 99970 more");
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe("what stays as in f143f50", () => {
  // The bundle before this release, from git.
  const shown = spawnSync("git", ["show", "f143f50:skill/codeplan/codeplan.mjs"], { encoding: "utf8", maxBuffer: 1 << 24 });
  const oldBundle = () => {
    const file = join(tempDir(), "old.mjs");
    writeFileSync(file, shown.stdout);
    return file;
  };
  const bundle = join(import.meta.dirname, "..", "skill/codeplan/codeplan.mjs");
  const ran = (file: string, args: string[], cwd: string) => spawnSync(process.execPath, [file, ...args], { cwd, encoding: "utf8" });

  test("check, stamps, and report without its stamp block, with entries with a stamp", () => {
    const repo = withUses([use("b", [SAME, ELSEWHERE, DIFFERS, NO_LINE, NO_FILE, "f.ts:9"])]);
    const old = oldBundle();
    for (const args of [["check"], ["stamps"]]) {
      const [a, b] = [ran(old, args, repo), ran(bundle, args, repo)];
      expect([b.status, b.stdout, b.stderr]).toEqual([a.status, a.stdout, a.stderr]);
    }
    const before = ran(old, ["report"], repo).stdout;
    const now = ran(bundle, ["report"], repo).stdout;
    expect(now.replace(/\n### Evidence entries with a stamp\n\n[^\n]*\n/, "")).toBe(before);
  });

  test("history: records that differ only in the new keys, or have them in another form", () => {
    const repo = withUses([use("b", [DIFFERS])]);
    const record = snap(repo);
    const historyOf = (second: Item) => {
      const dir = tempDir();
      writeFileSync(join(dir, "r1.json"), JSON.stringify(record));
      writeFileSync(join(dir, "r2.json"), JSON.stringify(second));
      return run(["history", dir], tempDir());
    };
    const plainRecord = structuredClone(record);
    delete plainRecord.stampEntries;
    for (const d of plainRecord.diagnostics) delete d.entry;
    const expected = historyOf(record);
    expect(historyOf(plainRecord)).toEqual(expected);
    expect(historyOf({ ...record, stampEntries: 5 })).toEqual(expected);
    // And as the bundle of f143f50 prints it.
    const old = oldBundle();
    const dir = tempDir();
    writeFileSync(join(dir, "r1.json"), JSON.stringify(record));
    writeFileSync(join(dir, "r2.json"), JSON.stringify({ ...record, stampEntries: 5 }));
    expect(ran(bundle, ["history", dir], dir).stdout).toBe(ran(old, ["history", dir], dir).stdout);
    expect(readFileSync(join(dir, "r1.json"), "utf8")).toBe(JSON.stringify(record));
  });
});
