// The values that report shows: control and format characters, the length
// of one value, and the row limit of the part table.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { run } from "../src/cli.js";
import { reportText, type Snapshot } from "../src/report.js";
import { makeRepo, tempDir } from "./helpers.js";

const PLAN_FILE = "docs/codeplan/plan.json";
const H = (content: string) => createHash("sha256").update(content).digest("hex").slice(0, 8);
const ch = (...points: number[]) => String.fromCodePoint(...points);
const ESC = ch(0x1b);
const RLO = ch(0x202e);
const FFFD = ch(0xfffd);

type Item = Record<string, any>;
const part = (id: string, paths: string[], more: Item = {}): Item => ({ id, name: id, about: "", paths, ...more });
const planOf = (parts: Item[]) => JSON.stringify({ format: 1, name: "", about: "", parts });

// Part a uses part b with one evidence entry with a stamp.
function repoOf(more: Record<string, string> = {}): string {
  return makeRepo({
    "package.json": "{}\n",
    "src/a.ts": "x\n",
    "lib/b.ts": "x\n",
    "f.ts": "x\ny\n",
    [PLAN_FILE]: planOf([
      part("a", ["src/**"], { uses: [{ to: "b", evidence: [`f.ts:1#${H("q")}`] }] }),
      part("b", ["lib/**"]),
    ]),
    ...more,
  });
}

function snap(repo: string): Item {
  const out = run(["snapshot"], repo);
  expect(out.code, out.stderr).toBe(0);
  return JSON.parse(out.stdout);
}

function reportWith(repo: string, base: Item): string {
  const file = join(tempDir(), "base.json");
  writeFileSync(file, JSON.stringify(base));
  const out = run(["report", "--base", file], repo);
  expect([out.code, out.stderr]).toEqual([0, ""]);
  return out.stdout;
}

// The report shows one value: the head's only file in no part.
function shownAs(value: string): string {
  const head = snap(repoOf()) as Snapshot;
  head.orphans = [value];
  const text = reportText(head, null);
  const line = text.split("\n").find((l) => l.startsWith("- ") && text.indexOf(l) > text.indexOf("### Files in no part"))!;
  return line.slice(2);
}

// tempDir removes each repository after its test, so each test makes its own.
describe("values from the base file", () => {
  let repo = "";
  let normal: Item = {};
  beforeEach(() => {
    repo = repoOf();
    normal = snap(repo);
  });
  const expectSafe = (out: string) => {
    expect(out.includes(ESC)).toBe(false);
    expect(out.includes(RLO)).toBe(false);
    expect(out.split("\n").some((l) => l.startsWith("### FORGED"))).toBe(false);
    expect(Buffer.byteLength(out)).toBeLessThan(5000);
  };

  test("a part id with a line break, a heading, ESC and 1,000,000 characters", () => {
    const base = structuredClone(normal);
    base.parts.push({ id: `x\n### FORGED RESULT\n${ESC}${"Z".repeat(1_000_000)}`, paths: [], planned: false, files: 1, lines: 1 });
    const out = reportWith(repo, base);
    expectSafe(out);
    expect(out).toContain(` (${1_000_000 + 21 - 300} more characters) | 1 | 1 | removed |`);
  });

  test("a part id with U+202E and four |", () => {
    const base = structuredClone(normal);
    base.parts.push({ id: `${RLO}||||`, paths: [], planned: false, files: 1, lines: 1 });
    const out = reportWith(repo, base);
    expectSafe(out);
    expect(out).toContain(`| ${FFFD}\\|\\|\\|\\| | 1 | 1 | removed |`);
  });

  test("a task id with ESC, U+202E and 50,000 characters", () => {
    const base = structuredClone(normal);
    base.tasks.push({ id: `${ESC}${RLO}${"Q".repeat(50_000)}`, status: null, makes: [], missing: [] });
    const out = reportWith(repo, base);
    expectSafe(out);
    expect(out).toContain(`| ${FFFD}${FFFD}${"Q".repeat(298)} (49702 more characters) |`);
  });

  test("the evidence of an entry with ESC, U+202E and 200,000 characters", () => {
    const base = structuredClone(normal);
    const d = base.diagnostics.find((d: Item) => "entry" in d);
    d.entry.evidence = `${ESC}${RLO}${"E".repeat(200_000)}`;
    const out = reportWith(repo, base);
    expectSafe(out);
    expect(out).toContain(`: ${FFFD}${FFFD}${"E".repeat(298)} (199702 more characters)\n`);
  });
});

describe("values from the head", () => {
  test("a file name with ESC in Files in no part", () => {
    const repo = repoOf({ [`o${ESC}.ts`]: "x\n" });
    const out = run(["report"], repo).stdout;
    const block = out.split("### Files in no part\n\n")[1]!.split("\n\n")[0]!;
    expect(block.split("\n")).toContain(`- o${FFFD}.ts`);
    expect(out.includes(ESC)).toBe(false);
  });

  test("a file name with ESC in Unwatched files", () => {
    const head = snap(repoOf()) as Snapshot;
    head.unwatched = [`u${ESC}.bin`];
    expect(reportText(head, null)).toContain(`### Unwatched files\n\n- u${FFFD}.bin\n`);
  });
});

describe("one value", () => {
  const smile = ch(0x1f600);

  test("300 code points as they are, 301 cut to 300", () => {
    expect(shownAs("a".repeat(300))).toBe("a".repeat(300));
    expect(shownAs("a".repeat(301))).toBe(`${"a".repeat(300)} (1 more characters)`);
  });

  test("a surrogate pair at 300 and 301 is one code point and not split", () => {
    expect(shownAs(`${"a".repeat(299)}${smile}`)).toBe(`${"a".repeat(299)}${smile}`);
    expect(shownAs(`${"a".repeat(299)}${smile}b`)).toBe(`${"a".repeat(299)}${smile} (1 more characters)`);
    expect(shownAs(`${"a".repeat(300)}${smile}`)).toBe(`${"a".repeat(300)} (1 more characters)`);
  });

  test("tab, U+200D, U+FEFF and U+009F as U+FFFD; Hangul, an emoji and a combining mark as they are", () => {
    expect(shownAs(`a${ch(0x9)}b${ch(0x200d)}c${ch(0xfeff)}d${ch(0x9f)}e`)).toBe(`a${FFFD}b${FFFD}c${FFFD}d${FFFD}e`);
    const kept = `한글${smile}e${ch(0x301)}`;
    expect(shownAs(kept)).toBe(kept);
  });

  test("CR LF, LF and CR as one space", () => {
    expect(shownAs("a\r\nb\nc\rd")).toBe("a b c d");
  });

  test("the cut comes before the Markdown escape and the added text is not escaped", () => {
    expect(shownAs("*".repeat(301))).toBe(`${"\\*".repeat(300)} (1 more characters)`);
  });

  test("work in proportion to the length", () => {
    const start = Date.now();
    expect(shownAs("x".repeat(1_000_000))).toBe(`${"x".repeat(300)} (999700 more characters)`);
    expect(Date.now() - start).toBeLessThan(5000);
  });
});

describe("the part table", () => {
  let repo = "";
  let head: Item = {};
  beforeEach(() => {
    repo = repoOf();
    head = snap(repo);
  });
  const withRemoved = (n: number) => {
    const base = structuredClone(head);
    for (let i = 0; i < n; i++) base.parts.push({ id: `r${i}`, paths: [], planned: false, files: 1, lines: 1 });
    return base;
  };
  const changes = (out: string) => out.slice(out.indexOf("### Changes"));

  test("30 changed parts: 30 rows and no And paragraph", () => {
    const out = changes(reportWith(repo, withRemoved(30)));
    expect(out.split("\n").filter((l) => l.endsWith("| removed |"))).toHaveLength(30);
    expect(out).not.toContain("more rows.");
  });

  test("31 changed parts: 30 rows, And 1 more rows., then the config paragraph and the tasks", () => {
    const base = withRemoved(31);
    base.config = { ...base.config, skip: [...base.config.skip, "zz/**"] };
    base.tasks = [{ id: "t1", status: null, makes: [], missing: [] }];
    const out = changes(reportWith(repo, base));
    expect(out.split("\n").filter((l) => l.endsWith("| removed |"))).toHaveLength(31);
    const blocks = out.split("\n\n");
    const table = blocks.findIndex((b) => b.startsWith("| Part |"));
    expect(blocks[table]!.split("\n")).toHaveLength(32);
    expect(blocks.slice(table + 1, table + 4)).toEqual([
      "And 1 more rows.",
      "The config or part patterns changed, so some changes come from new rules, not new code.",
      "| Task | Status | Files | Change |\n|---|---|---|---|\n| t1 |  |  | removed |\n",
    ]);
  });

  test("a part id with | does not change the number of cells", () => {
    const base = structuredClone(head);
    base.parts.push({ id: "x|y", paths: [], planned: false, files: 1, lines: 1 });
    const row = reportWith(repo, base).split("\n").find((l) => l.endsWith("| removed |"))!;
    expect(row).toBe("| x\\|y | 1 | 1 | removed |");
    expect(row.split(/(?<!\\)\|/)).toHaveLength(6);
  });

  test("a long part id on both sides is paired by its whole value", () => {
    const long = "p".repeat(400);
    const base = structuredClone(head);
    const both = structuredClone(head);
    for (const s of [base, both]) s.parts.push({ id: long, paths: [], planned: false, files: 1, lines: 1 });
    const other = structuredClone(head);
    other.parts.push({ id: `${long}q`, paths: [], planned: false, files: 1, lines: 1 });
    expect(changes(reportText(both as Snapshot, base as Snapshot))).toContain("No part changed.");
    const out = changes(reportText(other as Snapshot, base as Snapshot));
    expect(out.split("\n").filter((l) => l.includes(" more characters) |")).map((l) => l.split(" | ").pop())).toEqual([
      "new |",
      "removed |",
    ]);
  });
});

test("two evidence strings with the same first 300 characters are two entries and two lines", () => {
  const head = snap(repoOf());
  const d = head.diagnostics.find((d: Item) => "entry" in d);
  const base = structuredClone(head);
  base.diagnostics = base.diagnostics.filter((x: Item) => !("entry" in x));
  const same = "e".repeat(300);
  head.diagnostics = [
    ...head.diagnostics.filter((x: Item) => !("entry" in x)),
    { ...d, entry: { ...d.entry, evidence: `${same}1` } },
    { ...d, entry: { ...d.entry, evidence: `${same}2` } },
  ];
  const out = reportText(head as Snapshot, base as Snapshot);
  const line = `- part a to b: ${same} (1 more characters)`;
  expect(out.split("\n").filter((l) => l === line)).toHaveLength(2);
});

describe("what stays as in 62fb0a3", () => {
  // What the bundle of 62fb0a3 printed for these inputs.
  const oldOutput = (name: string) => readFileSync(join(import.meta.dirname, "old-output", name), "utf8");
  const bundle = join(import.meta.dirname, "..", "skill/codeplan/codeplan.mjs");
  const ran = (args: string[], cwd: string) => spawnSync(process.execPath, [bundle, ...args], { cwd, encoding: "utf8" });

  test("report and report --base on values with no control character, none longer than 300", () => {
    const repo = repoOf();
    const baseFile = join(tempDir(), "base.json");
    writeFileSync(baseFile, JSON.stringify(snap(repo)));
    mkdirSync(join(repo, "src/new"));
    writeFileSync(join(repo, "src/new/c.ts"), "x\n");
    writeFileSync(join(repo, "o.ts"), "x\n");
    for (const [args, name] of [[["report"], "62fb0a3-report.stdout"], [["report", "--base", baseFile], "62fb0a3-report-base.stdout"]] as const) {
      const b = ran([...args], repo);
      expect([b.status, b.stdout, b.stderr]).toEqual([0, oldOutput(name), ""]);
    }
  });
});

// Each place where report puts a value of a snapshot: the value has ESC and
// 302 code points, so the line differs if that place skips the rules.
test("each place shows its value with the rules", () => {
  const value = (tag: string) => `${tag}${ESC}${"x".repeat(300)}`;
  const seen = (v: string) => {
    const points = [...v.replace(ESC, FFFD)];
    return points.length > 300 ? `${points.slice(0, 300).join("")} (${points.length - 300} more characters)` : v;
  };
  const head = snap(repoOf());
  const dir = `d${ESC}${"x".repeat(299)}/n`;
  const pattern = `d${ESC}${"x".repeat(299)}/**`;
  const part8 = value("p");
  head.parts.push({ id: part8, paths: [pattern], planned: false, files: 1, lines: 1 });
  const base = structuredClone(head);
  const d0 = head.diagnostics[0];
  head.diagnostics = [
    { ...d0, at: value("a"), message: value("m") },
    { ...head.diagnostics.find((d: Item) => "entry" in d), entry: { part: value("e"), to: value("t"), evidence: "ev" } },
  ];
  head.contested = [{ path: value("c"), parts: [value("i")] }];
  head.tasks = [{ id: value("k"), status: null, makes: [], missing: [] }];
  head.owned.push({ path: `${dir}/f.ts`, part: part8, pattern });
  const out = reportText(head as Snapshot, base as Snapshot);
  const lines = out.split("\n");
  expect(out.includes(ESC)).toBe(false);
  expect(lines).toContain(`- ${seen(value("a"))}: ${d0.code} [${d0.severity}] ${seen(value("m"))}`);
  expect(lines).toContain(`- ${seen(value("c"))}: ${seen(value("i"))}`);
  expect(lines).toContain(`| ${seen(value("k"))} |  |  |`);
  expect(lines).toContain(`- part ${seen(value("e"))} to ${seen(value("t"))}: ev`);
  expect(lines).toContain(`- ${seen(dir)}/: 1 files went to part ${seen(part8)} through ${seen(pattern)}`);
});
