// The stamp of an evidence line: its form, how it is made, the two info
// findings, and the stamps command.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { run } from "../src/cli.js";
import * as stamp from "../src/stamp.js";
import { makeRepo, type Tree } from "./helpers.js";

const PLAN_FILE = "docs/codeplan/plan.json";
// The stamp worked out here from the bytes, not with the tool's code.
const H = (content: string | Buffer) => createHash("sha256").update(content).digest("hex").slice(0, 8);

type Item = Record<string, any>;
const part = (id: string, paths: string[], more: Item = {}): Item => ({ id, name: id, about: "", paths, ...more });
const planOf = (parts: Item[]) => JSON.stringify({ format: 1, name: "", about: "", parts });

// A JS repository with part a (src/**) whose use of b has the evidence.
function repoWith(evidence: unknown[], files: Record<string, string | Buffer> = {}): string {
  const repo = makeRepo({
    "package.json": "{}\n",
    "src/a.ts": "x\n",
    "lib/b.ts": "x\n",
    [PLAN_FILE]: planOf([part("a", ["src/**", "f"], { uses: [{ to: "b", evidence }] }), part("b", ["lib/**"])]),
  });
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  return repo;
}

const EVIDENCE_CODE = /^(\S+): (evidence-\S+) \[(\w+)\] (?:part "[a-z0-9-]+": )?(.*)$/;
// The evidence findings check prints: [index of the evidence, code].
function findings(repo: string): [number, string][] {
  const out = run(["check", "--no-page"], repo);
  const found: [number, string][] = [];
  for (const line of out.stderr.split("\n")) {
    const m = EVIDENCE_CODE.exec(line);
    if (m === null) continue;
    expect(m[3]).toBe("info");
    found.push([Number(/evidence\[(\d+)\]$/.exec(m[1]!)![1]), m[2]!]);
  }
  return found;
}

function stampLines(repo: string): Item[] {
  const out = run(["stamps"], repo);
  expect(out.code, out.stderr).toBe(0);
  expect(out.stderr).toBe("");
  if (out.stdout === "") return [];
  expect(out.stdout.endsWith("\n")).toBe(true);
  return out.stdout.slice(0, -1).split("\n").map((l) => JSON.parse(l));
}

const STATE_CODE: Record<string, string | null> = {
  same: null,
  "no-stamp": null,
  elsewhere: "evidence-stamp-elsewhere",
  differs: "evidence-stamp-differs",
  "no-line": "evidence-no-line",
  "no-file": "evidence-no-file",
};
// Each element's state in stamps and its finding in check agree, by place.
function expectPaired(repo: string): void {
  const byPlace = new Map<string, string>();
  for (const line of run(["check", "--no-page"], repo).stderr.split("\n")) {
    const m = EVIDENCE_CODE.exec(line);
    if (m !== null) byPlace.set(m[1]!, m[2]!);
  }
  for (const l of stampLines(repo)) {
    expect(byPlace.get(l.at) ?? null, l.at).toBe(STATE_CODE[l.state]);
    byPlace.delete(l.at);
  }
  // The rest are strings stamps leaves out: not-read only.
  for (const code of byPlace.values()) expect(code).toBe("evidence-not-read");
}

describe("the findings", () => {
  const x = H("x");
  // The table of the spec: evidence, file lines, finding.
  const TABLE: [string, string, string | null][] = [
    [`f:1#${x}`, "x\nx\n", null],
    [`f:1#${x}`, "y\nx\n", "evidence-stamp-elsewhere"],
    [`f:99#${x}`, "y\nx\n", "evidence-stamp-elsewhere"],
    [`f:99#${x}`, "x\nx\n", "evidence-no-line"],
    [`f:1#${x}`, "y\nx\nx\n", "evidence-stamp-differs"],
    [`f:1#${x}`, "y\n", "evidence-stamp-differs"],
    ["f:1#e3b0c442", "y\n\n", "evidence-stamp-elsewhere"],
  ];
  test.each(TABLE)("%s on %j: %s", (evidence, file, code) => {
    const repo = repoWith([evidence], { f: file });
    expect(findings(repo)).toEqual(code === null ? [] : [[0, code]]);
    expectPaired(repo);
  });

  test("the sentences, and info only: check passes", () => {
    const repo = repoWith([`f:1#${x}`, `f:2#${H("z")}`, `f:2#${x}`], { f: "y\nx\n" });
    const out = run(["check"], repo);
    run(["update"], repo);
    expect(run(["check"], repo).code).toBe(0);
    const lines = out.stderr.split("\n").filter((l) => l.includes("evidence-stamp"));
    expect(lines).toEqual([
      `parts[0].uses[0].evidence[0]: evidence-stamp-elsewhere [info] part "a": one other line of the file has the stamp of evidence "f:1#${x}"`,
      `parts[0].uses[0].evidence[1]: evidence-stamp-differs [info] part "a": the line of evidence "f:2#${H("z")}" does not have its stamp`,
      expect.stringMatching(/^ {2}fix: evidence-stamp-elsewhere: read the line the stamps command gives/),
      expect.stringMatching(/^ {2}fix: evidence-stamp-differs: read the line: /),
    ]);
  });

  test("a stamped evidence of a file with no file there, and a file not read", () => {
    // src is a directory.
    const repo = repoWith([`none:1#${x}`, "src:1#00000000", "none:1"]);
    expect(findings(repo)).toEqual([
      [0, "evidence-no-file"],
      [1, "evidence-no-file"],
      [2, "evidence-no-file"],
    ]);
    expectPaired(repo);
  });

  test("a stampless evidence of a file that a stamped one names uses the same line count", () => {
    const repo = repoWith(["f:3", `f:1#${x}`, "f:2", "f:4"], { f: "x\ny\nz" });
    expect(findings(repo)).toEqual([[3, "evidence-no-line"]]);
    expectPaired(repo);
  });
});

describe("the stamp of a line", () => {
  // The stamp of line 1 of a file with these bytes.
  const first = (bytes: number[]) => stamp.fileLines(Buffer.from(bytes)).stamps[0];
  test("line counts: no LF at the end, an empty file, a file of one LF", () => {
    expect(stamp.fileLines(Buffer.from("")).stamps).toEqual([]);
    expect(stamp.fileLines(Buffer.from("\n")).stamps).toEqual(["e3b0c442"]);
    expect(stamp.fileLines(Buffer.from("a\nb")).stamps).toEqual([H("a"), H("b")]);
    expect(stamp.fileLines(Buffer.from("a\nb\n")).stamps).toEqual([H("a"), H("b")]);
    expect(stamp.fileLines(Buffer.from("a\r\nb\r")).stamps).toEqual([H("a"), H("b")]);
  });
  test("CR, spaces and tabs", () => {
    expect(first([0x78, 0x0a])).toBe(H("x"));
    expect(first([0x78, 0x0d, 0x0a])).toBe(H("x"));
    expect(first([0x78, 0x0d])).toBe(H("x"));
    // The CR goes first, then the spaces: here the CR is not at the end.
    expect(first([0x78, 0x0d, 0x20, 0x0a])).toBe(H("x\r"));
    expect(first([0x20, 0x09, 0x78, 0x20, 0x09, 0x0a])).toBe(H("x"));
    expect(first([0x78, 0x0d, 0x0d])).toBe(H("x\r"));
    expect(H("x\r")).not.toBe(H("x"));
  });
  test("other bytes are content: a full-width space, a BOM, NBSP, NUL", () => {
    for (const lead of ["　", "﻿", " ", "\u0000"]) {
      expect(first([...Buffer.from(`${lead}x`)])).toBe(H(Buffer.from(`${lead}x`)));
      expect(first([...Buffer.from(`${lead}x`)])).not.toBe(H("x"));
    }
  });
  test("bytes that are not UTF-8 are not decoded: ff and ef bf bd differ", () => {
    expect(first([0xff])).toBe(H(Buffer.from([0xff])));
    expect(first([0xef, 0xbf, 0xbd])).toBe(H(Buffer.from([0xef, 0xbf, 0xbd])));
    expect(first([0xff])).not.toBe(first([0xef, 0xbf, 0xbd]));
  });
  test("a file whose lines end with CR only is one line", () => {
    expect(stamp.fileLines(Buffer.from("a\rb\r")).stamps).toEqual([H("a\rb")]);
  });
  test("the stamps of a file on disk, through the command", () => {
    const repo = repoWith(["f:1", "f:2", "f:3"], { f: Buffer.from([0x20, 0x78, 0x0d, 0x0a, 0x0a, 0xff]) });
    expect(stampLines(repo).map((l) => l.stamp)).toEqual([H("x"), "e3b0c442", H(Buffer.from([0xff]))]);
  });
});

describe("the form of an evidence string", () => {
  test("strings that are not read", () => {
    const not = [`a.ts:01#12345678`, "a.ts:1#ABCDEF12", "a.ts:1#123456789", "a.ts:1#1234567", "a.ts:1#12345678#12345678", "a.ts:1#", "a.ts#12345678"];
    expect(findings(repoWith(not))).toEqual(not.map((_, i) => [i, "evidence-not-read"]));
    expect(stampLines(repoWith(not))).toEqual([]);
  });
  test("the path is everything before the last colon", () => {
    expect(stamp.readEvidence("c:d.ts:12#12345678")).toEqual({ path: "c:d.ts", line: 12, stamp: "12345678" });
    expect(stamp.readEvidence("c:d.ts:12")).toEqual({ path: "c:d.ts", line: 12, stamp: null });
  });
  test("evidence-not-read keeps its message and fix, byte for byte", () => {
    const out = run(["check"], repoWith(["a.ts:1#ABCDEF12"]));
    expect(out.stderr).toContain(
      'parts[0].uses[0].evidence[0]: evidence-not-read [info] part "a": evidence "a.ts:1#ABCDEF12" is not written as file:line\n',
    );
    expect(out.stderr).toContain(
      "  fix: evidence-not-read: write the evidence as a path from the repository root, a colon and a line number of 1 or more\n",
    );
  });
});

describe("the stamps command", () => {
  const x = H("x");
  test("the keys, their order and the states", () => {
    const repo = repoWith([`f:1#${x}`, "f:2", `f:1#${H("q")}`, `f:9#${H("y")}`, "f:9", "none:1", `f:2#${x}`, "bad"], {
      f: "x\ny\n",
    });
    const at = (j: number) => `parts[0].uses[0].evidence[${j}]`;
    const row = (j: number, evidence: string, state: string, line: number | null, s: string | null) =>
      ({ at: at(j), part: "a", to: "b", evidence, state, line, stamp: s });
    const out = run(["stamps"], repo);
    expect(out.stdout.split("\n")[0]).toBe(
      `{"at":"${at(0)}","part":"a","to":"b","evidence":"f:1#${x}","state":"same","line":1,"stamp":"${x}"}`,
    );
    expect(stampLines(repo)).toEqual([
      row(0, `f:1#${x}`, "same", 1, x),
      row(1, "f:2", "no-stamp", 2, H("y")),
      row(2, `f:1#${H("q")}`, "differs", 1, x),
      row(3, `f:9#${H("y")}`, "elsewhere", 2, H("y")),
      row(4, "f:9", "no-line", null, null),
      row(5, "none:1", "no-file", null, null),
      row(6, `f:2#${x}`, "elsewhere", 1, x),
    ]);
    expectPaired(repo);
  });

  test("tabs and LF in a path stay in one line; the same string twice is told apart by at", () => {
    const path = "src/a\tb\nc.ts";
    const repo = repoWith([`${path}:1`, `${path}:1`], { [path]: "x\n" });
    const out = run(["stamps"], repo);
    expect(out.stdout.split("\n")).toHaveLength(3);
    expect(out.stdout.indexOf("\n")).toBe(out.stdout.split("\n")[0]!.length);
    const lines = stampLines(repo);
    expect(lines.map((l) => [l.at, l.evidence, l.state])).toEqual([
      ["parts[0].uses[0].evidence[0]", `${path}:1`, "no-stamp"],
      ["parts[0].uses[0].evidence[1]", `${path}:1`, "no-stamp"],
    ]);
  });

  test("which elements are listed: part and to that are not ids are null; a repeated part is left out", () => {
    const repo = makeRepo({
      "package.json": "{}\n",
      f: "x\n",
      [PLAN_FILE]: JSON.stringify({
        format: 1,
        name: "",
        about: "",
        parts: [
          part("Bad Id", ["src/**"], { uses: [{ to: "No", evidence: ["f:1"] }, { evidence: ["f:1"] }] }),
          part("a", ["a/**"], { uses: [{ to: "a", evidence: ["f:1", 3, "nope"] }, "x", { to: "a", evidence: "f:1" }] }),
          part("a", ["b/**"], { uses: [{ to: "a", evidence: ["f:1"] }] }),
          "not a part",
          part("c", ["c/**"], { uses: { to: "a" } }),
        ],
      }),
    });
    expect(stampLines(repo).map((l) => [l.at, l.part, l.to])).toEqual([
      ["parts[0].uses[0].evidence[0]", null, null],
      ["parts[0].uses[1].evidence[0]", null, null],
      ["parts[1].uses[0].evidence[0]", "a", "a"],
    ]);
    expectPaired(repo);
  });

  test("no evidence: no bytes and exit 0; a plan that is not an object too", () => {
    expect(run(["stamps"], repoWith([]))).toEqual({ code: 0, stdout: "", stderr: "" });
    const repo = makeRepo({ "package.json": "{}\n", [PLAN_FILE]: "[1, 2]" });
    expect(run(["stamps"], repo)).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  test("errors: no plan file, a plan file that is not JSON, an option, an extra argument", () => {
    const none = makeRepo({ "package.json": "{}\n" });
    expect(run(["stamps"], none)).toEqual({ code: 2, stdout: "", stderr: "codeplan: docs/codeplan/plan.json not found\n" });
    const broken = makeRepo({ "package.json": "{}\n", [PLAN_FILE]: "{" });
    const out = run(["stamps"], broken);
    expect(out.code).toBe(2);
    expect(out.stdout).toBe("");
    expect(out.stderr).toMatch(/^codeplan: docs\/codeplan\/plan\.json is not valid JSON: [^\n]*\n$/);
    const config = makeRepo({ "codeplan.json": "{", [PLAN_FILE]: planOf([]) });
    expect(run(["stamps"], config)).toMatchObject({ code: 2, stdout: "" });
    for (const args of [["stamps", "--no-page"], ["stamps", "more"]]) {
      const bad = run(args, repoWith([]));
      expect(bad.code).toBe(2);
      expect(bad.stdout).toBe("");
      expect(bad.stderr).toContain("Usage:");
    }
  });

  test("something else at the page place, and files it does not read, do not stop it", () => {
    const repo = repoWith(["f:1"], { f: "x\n", "docs/codeplan/codeplan.html": "not a page\n" });
    expect(run(["check"], repo).code).toBe(2);
    expect(stampLines(repo)).toHaveLength(1);
  });

  test("the plan file is not changed, and the output is the same twice", () => {
    const repo = repoWith([`f:1#${H("y")}`], { f: "x\ny\n" });
    const out = run(["stamps"], repo);
    expect(run(["stamps"], repo)).toEqual(out);
    expect(out.stdout).not.toContain(repo);
  });
});

describe("reading", () => {
  test("500 evidence entries of one file make its lines once", () => {
    const evidence = Array.from({ length: 500 }, (_, i) => (i % 2 === 0 ? `f:${i + 1}#${H("x")}` : `f:${i + 1}`));
    const repo = repoWith(evidence, { f: "x\n".repeat(600) });
    for (const command of ["check", "stamps"]) {
      const before = stamp.built;
      run([command], repo);
      expect(stamp.built - before, command).toBe(1);
    }
  });

  test("a stampless evidence alone does not read the lines", () => {
    const repo = repoWith(["f:1", "g:1"], { f: "x\n", g: "x\n" });
    const before = stamp.built;
    run(["check"], repo);
    expect(stamp.built).toBe(before);
  });
});

describe("a tree with evidence of every kind", () => {
  test("states and findings agree", () => {
    const tree: Tree = { a: "x\ny\nx\n", b: "\n\n}\n", c: "z" };
    const evidence = [
      `a:1#${H("x")}`, `a:2#${H("x")}`, `a:9#${H("y")}`, `a:9#${H("x")}`, "a:3", "a:4",
      `b:3#${H("")}`, `b:1#${H("}")}`, `c:1#${H("z")}`, `c:2#${H("q")}`, `d:1#${H("q")}`, "d:1", "c:1#Z",
    ];
    expectPaired(repoWith(evidence, tree));
  });

  test("files a part owns, and evidence in two parts and two uses", () => {
    const repo = makeRepo({
      "package.json": "{}\n",
      "src/a.ts": "x\ny\n",
      "lib/b.ts": "x\nx\n",
      [PLAN_FILE]: planOf([
        part("a", ["src/**"], {
          uses: [
            { to: "b", evidence: [`src/a.ts:1#${H("x")}`, "src/a.ts:1", "src/a.ts:9", `src/a.ts:9#${H("y")}`] },
            { to: "b", evidence: [`lib/b.ts:1#${H("y")}`, "lib/b.ts:3"] },
          ],
        }),
        part("b", ["lib/**"], { uses: [{ to: "a", evidence: [`src/a.ts:2#${H("x")}`, `lib/b.ts:9#${H("x")}`, "lib/b.ts:2"] }] }),
      ]),
    });
    expect(stampLines(repo).map((l) => [l.at, l.state])).toEqual([
      ["parts[0].uses[0].evidence[0]", "same"],
      ["parts[0].uses[0].evidence[1]", "no-stamp"],
      ["parts[0].uses[0].evidence[2]", "no-line"],
      ["parts[0].uses[0].evidence[3]", "elsewhere"],
      ["parts[0].uses[1].evidence[0]", "differs"],
      ["parts[0].uses[1].evidence[1]", "no-line"],
      ["parts[1].uses[0].evidence[0]", "elsewhere"],
      ["parts[1].uses[0].evidence[1]", "no-line"],
      ["parts[1].uses[0].evidence[2]", "no-stamp"],
    ]);
    expectPaired(repo);
  });
});
