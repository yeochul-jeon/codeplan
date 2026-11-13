// The evidence of a use and the imports of .java files: five info
// diagnostics, and check --no-page.
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { run } from "../src/cli.js";
import { importFacts, javaFile } from "../src/imports.js";
import { makeRepo, type Tree } from "./helpers.js";

const JAVA = "src/main/java/app";
const PLAN_FILE = "docs/codeplan/plan.json";
const PAGE_FILE = "docs/codeplan/codeplan.html";

// Tree J: a Java repository whose plan has every kind of the five findings.
const J = (): Tree => ({
  "notes/mapper.xml": "<mapper/>\n",
  "pom.xml": "<project/>\n",
  [`${JAVA}/core/Engine.java`]: "package app.core;\nimport app.store.Repo.Row;\nimport java.util.List;\nclass Engine {}\n",
  [`${JAVA}/kt/K.kt`]: "package app.kt\nimport app.util.Text\nclass K\n",
  [`${JAVA}/shared/A1.java`]: "package app.shared;\nclass A1 { B1 b; }\n",
  [`${JAVA}/shared/B1.java`]: "package app.shared;\nclass B1 {}\n",
  [`${JAVA}/store/Cache.java`]: "package app.store;\nclass Cache {}\n",
  [`${JAVA}/store/Repo.java`]: "package app.store;\nclass Repo { static class Row {} }\n",
  [`${JAVA}/util/Text.java`]: "package app.util;\nclass Text {}\n",
  [`${JAVA}/web/WebA.java`]: "package app.web;\n\nimport app.core.Engine;\nimport static app.util.Text.trim;\n\nclass WebA {}\n",
  [`${JAVA}/web/WebB.java`]: "package app.web;\nimport app.store.*;\nclass WebB {}\n",
});

type Item = Record<string, any>;
const part = (id: string, name: string, paths: string[], more: Item = {}): Item => ({ id, name, about: "", paths, ...more });
const planJ = (): Item => ({
  format: 1,
  name: "javatree",
  about: "",
  parts: [
    part("web", "Web", [`${JAVA}/web/**`], {
      uses: [
        { to: "core", evidence: [`${JAVA}/web/WebA.java:3`] },
        { to: "store", evidence: [`${JAVA}/web/WebB.java:2`] },
      ],
    }),
    part("core", "Core", [`${JAVA}/core/**`], {
      uses: [
        { to: "util", evidence: [`${JAVA}/core/Engine.java:1`] },
        {
          to: "db",
          evidence: [
            `${JAVA}/core/Gone.java:1`,
            `${JAVA}/core/Engine.java`,
            `${JAVA}/core/Engine.java:999`,
            "notes/mapper.xml:1",
            `../${JAVA}/core/Engine.java:1`,
          ],
        },
      ],
    }),
    part("store", "Store", [`${JAVA}/store/**`], { uses: [{ to: "kt" }, { to: "later" }] }),
    part("util", "Util", [`${JAVA}/util/**`], { uses: [{ to: "web" }] }),
    part("kt", "Kt", [`${JAVA}/kt/**`]),
    part("split-a", "Split A", [`${JAVA}/shared/A*.java`], { uses: [{ to: "split-b", evidence: [`${JAVA}/shared/A1.java:2`] }] }),
    part("split-b", "Split B", [`${JAVA}/shared/B*.java`]),
    part("later", "Later", [`${JAVA}/later/**`], { planned: true }),
  ],
  externals: [{ id: "db", name: "DB", about: "" }],
  scenarios: [],
});

// J with a change to its plan or tree; update has run when it can write.
function repoJ(change: (plan: Item, tree: Tree) => void = () => {}): string {
  const plan = planJ();
  const tree = J();
  change(plan, tree);
  const repo = makeRepo({ ...tree, [PLAN_FILE]: JSON.stringify(plan, null, 2) });
  run(["update"], repo);
  return repo;
}

const FIVE = ["evidence-not-read", "evidence-no-file", "evidence-no-line", "import-without-use", "use-without-import"];
type Row = [at: string, code: string, sentence: string];
// The lines of the five codes that check prints, in its order, each without
// the head that names the part. All are info.
function rows(stderr: string): Row[] {
  const found: Row[] = [];
  for (const line of stderr.split("\n")) {
    const m = /^(\S+): (\S+) \[(\w+)\] (?:part "[a-z0-9-]+": )?(.*)$/.exec(line);
    if (m === null || !FIVE.includes(m[2]!)) continue;
    expect(m[3], line).toBe("info");
    found.push([m[1]!, m[2]!, m[4]!]);
  }
  return found;
}
function checked(repo: string, ...more: string[]): { code: number; rows: Row[]; stdout: string; stderr: string } {
  const out = run(["check", ...more], repo);
  expect(run(["check", ...more], repo)).toEqual(out);
  return { code: out.code, rows: rows(out.stderr), stdout: out.stdout, stderr: out.stderr };
}

const noUse = (at: string, to: string, example: string): Row => [
  at,
  "import-without-use",
  `files of this part import files of part "${to}" and the plan has no use of it, for example ${example}`,
];
const noImport = (at: string, to: string): Row => [at, "use-without-import", `no file of this part imports a file of part "${to}"`];
const EVIDENCE: Row[] = [
  ["parts[1].uses[1].evidence[0]", "evidence-no-file", `the file of evidence "${JAVA}/core/Gone.java:1" is not a file in the repository`],
  ["parts[1].uses[1].evidence[1]", "evidence-not-read", `evidence "${JAVA}/core/Engine.java" is not written as file:line`],
  ["parts[1].uses[1].evidence[2]", "evidence-no-line", `the file of evidence "${JAVA}/core/Engine.java:999" does not have that line`],
  ["parts[1].uses[1].evidence[4]", "evidence-not-read", `evidence "../${JAVA}/core/Engine.java:1" is not written as file:line`],
];
const WEB_UTIL = noUse("parts[0].uses", "util", `${JAVA}/web/WebA.java`);
const CORE_STORE = noUse("parts[1].uses", "store", `${JAVA}/core/Engine.java`);
const CORE_UTIL = noImport("parts[1].uses[0].to", "util");
const UTIL_WEB = noImport("parts[3].uses[0].to", "web");
const EIGHT: Row[] = [WEB_UTIL, CORE_STORE, CORE_UTIL, ...EVIDENCE, UTIL_WEB];

describe("evidence and imports: tree J", () => {
  test("the eight findings, in the order of their places, and check passes", () => {
    const out = checked(repoJ());
    expect(out.rows).toEqual(EIGHT);
    expect(out.code, out.stderr).toBe(0);
    expect(out.stdout.endsWith("check: ok\n")).toBe(true);
    // One fix line for each code, after the findings.
    for (const code of FIVE) expect(out.stderr.split(`  fix: ${code}: `)).toHaveLength(2);
    // Nothing else is found.
    expect(out.stderr.split("\n").filter((l) => /\[(error|warning|info)\]/.test(l))).toHaveLength(8);
  });

  test("with a contested file, imports are not judged and the evidence findings stay", () => {
    const out = checked(repoJ((plan) => plan.parts[3].paths.push(`${JAVA}/store/**`)));
    expect(out.stderr).toContain("contested files: two or more parts own them with equally strong patterns (2)");
    expect(out.rows).toEqual(EVIDENCE);
  });

  test("a full name that two files have is the name of neither", () => {
    const out = checked(
      repoJ((plan, tree) => {
        tree["m2/src/main/java/app/util/Text.java"] = "package app.util;\nclass Text {}\n";
        plan.parts.push(part("util2", "Util 2", ["m2/src/main/java/app/util/**"]));
      }),
    );
    expect(out.rows).toEqual([CORE_STORE, CORE_UTIL, ...EVIDENCE, UTIL_WEB]);
  });

  test("a part with a repeated id has none of the five, and no import is judged", () => {
    const out = checked(
      repoJ((plan) => {
        plan.parts[3].id = "web";
        plan.parts[3].uses[0].evidence = ["not file and line"];
      }),
    );
    expect(out.stderr).toContain("parts[3].id: repeated-id [error]");
    expect(out.rows).toEqual(EVIDENCE);
  });

  test("a use that is not an object has no evidence findings; the other uses keep theirs", () => {
    const out = checked(repoJ((plan) => (plan.parts[1].uses[1] = "db")));
    expect(out.stderr).toContain("parts[1].uses[1]: bad-shape [error]");
    expect(out.rows).toEqual([WEB_UTIL, CORE_STORE, CORE_UTIL, UTIL_WEB]);
  });

  test("the five stand at their places among the other findings", () => {
    const out = checked(repoJ((plan) => (plan.parts[0].start = "none.java")));
    const places = out.stderr
      .split("\n")
      .filter((l) => /\[(error|warning|info)\]/.test(l))
      .map((l) => l.slice(0, l.indexOf(" [")));
    expect(places.slice(0, 3)).toEqual([
      "parts[0].start: start-missing",
      "parts[0].uses: import-without-use",
      "parts[1].uses: import-without-use",
    ]);
    expect(out.rows).toEqual(EIGHT);
  });

  test("snapshot has the eight as info with a fix, and report says check: ok", () => {
    const repo = repoJ();
    const snapshot = JSON.parse(run(["snapshot"], repo).stdout);
    expect([snapshot.snapshot, snapshot.rules]).toEqual([1, 1]);
    expect(snapshot.diagnostics.map((d: Item) => [d.at, d.code, d.severity])).toEqual(EIGHT.map(([at, code]) => [at, code, "info"]));
    for (const d of snapshot.diagnostics) {
      expect(typeof d.fix).toBe("string");
      expect(d.fix).not.toBe("");
    }
    expect(Object.keys(snapshot).sort()).not.toContain("java");
    expect(run(["report"], repo).stdout).toContain("check: ok");
  });

  test("the example is the first file by code unit; one more import line of the same pair changes nothing", () => {
    const first = checked(
      repoJ((_plan, tree) => (tree[`${JAVA}/web/Aaa.java`] = "package app.web;\nimport app.util.Text;\nclass Aaa {}\n")),
    );
    expect(first.rows).toEqual([noUse("parts[0].uses", "util", `${JAVA}/web/Aaa.java`), ...EIGHT.slice(1)]);
    const more = checked(
      repoJ((_plan, tree) => {
        tree[`${JAVA}/web/WebA.java`] = tree[`${JAVA}/web/WebA.java`]!.replace("class WebA", "import app.util.Text;\nclass WebA");
      }),
    );
    expect(more.rows).toEqual(EIGHT);
  });

  test("a part with no uses key, a planned part, and a use written twice", () => {
    const out = checked(
      repoJ((plan) => {
        delete plan.parts[0].uses;
        plan.parts[3].uses.push({ to: "web" });
        plan.parts[2].planned = true;
      }),
    );
    expect(out.rows).toEqual([
      noUse("parts[0].uses", "core", `${JAVA}/web/WebA.java`),
      WEB_UTIL,
      // store is planned now: core's import of it is not told.
      CORE_UTIL,
      ...EVIDENCE,
      UTIL_WEB,
      noImport("parts[3].uses[1].to", "web"),
    ]);
  });
});

describe("evidence: a repository that is not java, and the form of the string", () => {
  const jsRepo = (evidence: unknown[], more: Tree = {}): string =>
    makeRepo({
      "package.json": "{}\n",
      "src/a.ts": "x\nx\nx\n",
      "lib/b.ts": "x\n",
      ...more,
      [PLAN_FILE]: JSON.stringify({
        format: 1,
        name: "",
        about: "",
        parts: [part("a", "A", ["src/**"], { uses: [{ to: "b", evidence }] }), part("b", "B", ["lib/**"])],
      }),
    });
  const codes = (repo: string) => checked(repo).rows.map(([at, code]) => [Number(/evidence\[(\d+)\]$/.exec(at)![1]), code]);

  test("the file and the line are looked at; imports are not", () => {
    const repo = jsRepo(["src/a.ts:1", "src/a.ts:99", "src/none.ts:1", "src/a.ts", "src/a.ts:3", "src/a.ts:4"]);
    expect(codes(repo)).toEqual([
      [1, "evidence-no-line"],
      [2, "evidence-no-file"],
      [3, "evidence-not-read"],
      [5, "evidence-no-line"],
    ]);
  });

  test("without the java language, .java files that are watched have no import findings", () => {
    const repo = makeRepo({
      "package.json": "{}\n",
      "codeplan.json": JSON.stringify({ languages: ["js"], watch: ["src/**", "lib/**"] }),
      "src/a/A.java": "package a;\nimport b.B;\nclass A {}\n",
      "lib/b/B.java": "package b;\nclass B {}\n",
      [PLAN_FILE]: JSON.stringify({
        format: 1,
        name: "",
        about: "",
        parts: [part("a", "A", ["src/**"]), part("b", "B", ["lib/**"], { uses: [{ to: "a", evidence: ["src/a/A.java:4"] }] })],
      }),
    });
    const out = checked(repo);
    expect(out.stdout).toContain("part a: 1 files, 3 lines");
    expect(out.rows).toEqual([["parts[1].uses[0].evidence[0]", "evidence-no-line", 'the file of evidence "src/a/A.java:4" does not have that line']]);
  });

  test("strings that are not written as file:line, and strings that are", () => {
    const not = ["", "a.java", "a.java:", "a.java:0", "a.java:01", "a.java:1a", "/a.java:1", "a//b.java:1", "./a.java:1", "a/../b.java:1", "a\\b.java:1", ":3"];
    expect(codes(jsRepo(not))).toEqual(not.map((_, i) => [i, "evidence-not-read"]));
    const out = checked(jsRepo(["a\\b.java:1", ""]));
    expect(out.rows.map((r) => r[2])).toEqual([
      'evidence "a\\\\b.java:1" is not written as file:line',
      'evidence "" is not written as file:line',
    ]);
    // These have the form, so the file is looked for.
    expect(codes(jsRepo(["a.java:1", "dir/a b.java:12", "c:d.java:7"]))).toEqual([0, 1, 2].map((i) => [i, "evidence-no-file"]));
    expect(codes(jsRepo(["dir/a b.java:12"], { "dir/a b.java": "x\n".repeat(12) }))).toEqual([]);
  });

  test("a directory, a symbolic link and a file outside the watch set", () => {
    const repo = jsRepo(["src:1", "link.ts:1", "linked/a.ts:1", "notes/n.txt:2", "notes/n.txt:3"], { "notes/n.txt": "x\nx\n" });
    symlinkSync(join(repo, "src/a.ts"), join(repo, "link.ts"));
    symlinkSync(join(repo, "src"), join(repo, "linked"));
    expect(codes(repo)).toEqual([
      [0, "evidence-no-file"],
      [1, "evidence-no-file"],
      [2, "evidence-no-file"],
      [4, "evidence-no-line"],
    ]);
  });

  test("evidence is judged whatever `to` is, and not where the shape is wrong", () => {
    const repo = makeRepo({
      "package.json": "{}\n",
      "src/a.ts": "x\n",
      [PLAN_FILE]: JSON.stringify({
        format: 1,
        name: "",
        about: "",
        parts: [
          part("a", "A", ["src/**"], {
            uses: [{ evidence: ["x"] }, { to: "nowhere", evidence: ["x"] }, { to: "a", evidence: ["x", 3] }, { to: "db", evidence: "x" }],
          }),
        ],
        externals: [{ id: "db", name: "", about: "" }],
      }),
    });
    expect(checked(repo).rows.map((r) => r[0])).toEqual([
      "parts[0].uses[0].evidence[0]",
      "parts[0].uses[1].evidence[0]",
      "parts[0].uses[2].evidence[0]",
    ]);
  });
});

describe("imports: the lines that are read and the file of a name", () => {
  test("package and import lines", () => {
    const file = javaFile(
      [
        "// import a.Comment;",
        "\tpackage  a.b ;",
        "package c.d;",
        "import a.b.C;",
        " \timport\tstatic  a.b.C.m ;",
        "import a.b.*; import x.Y;",
        "import static a.b.C.*;",
        "import module java.base;",
        "import a.b.C",
        "import 1a.B;",
        "import a.한글_$1;\r",
      ].join("\n"),
    );
    expect(file.package).toBe("a.b");
    expect(file.imports).toEqual([
      { name: "a.b.C", isStatic: false, all: false },
      { name: "a.b.C.m", isStatic: true, all: false },
      { name: "a.b", isStatic: false, all: true },
      { name: "a.b.C", isStatic: true, all: true },
      { name: "a.한글_$1", isStatic: false, all: false },
    ]);
    expect(javaFile("class A {}\n").package).toBeNull();
  });

  const facts = (files: Record<string, [owner: string, text: string]>) => {
    const paths = Object.keys(files).sort();
    return importFacts(new Map(paths.map((p) => [p, files[p]![0]])), new Map(paths.map((p) => [p, javaFile(files[p]![1])])));
  };
  const pairsOf = (f: ReturnType<typeof facts>) => [...f.pairs].flatMap(([from, row]) => [...row].map(([to, path]) => `${from} ${to} ${path}`));

  test("a name that two files have ends the search for a type", () => {
    const found = facts({
      "x/a/T.java": ["one", "package a;\n"],
      "y/a/T.java": ["two", "package a;\n"],
      // The file of the name `a`, which the search would come to next.
      "a.java": ["three", "class a {}\n"],
      "q/Q.java": ["q", "package q;\nimport static a.T.m;\nimport a.T;\n"],
    });
    expect(pairsOf(found)).toEqual([]);
  });

  test("a name of one piece is looked for; a file with no package is in no package", () => {
    const found = facts({
      "Solo.java": ["one", "class Solo {}\n"],
      "Other.java": ["two", "import static Solo.m;\n"],
      "q/Q.java": ["q", "package q;\nimport static Solo.Inner.m;\nimport q.*;\nimport none.*;\n"],
    });
    expect(pairsOf(found)).toEqual(["two one Other.java", "q one q/Q.java"]);
    expect([...found.packages].map(([id, set]) => [id, [...set]])).toEqual([["two", []], ["one", []], ["q", ["q"]]]);
    expect([...found.possible].map(([id, set]) => [id, [...set]])).toEqual([["q", ["q"]]]);
  });

  test("a .* import of a nested type is an import pair; a static .* is not read as a package", () => {
    const found = facts({
      "a/Outer.java": ["one", "package a;\n"],
      "b/B.java": ["two", "package b;\nimport a.Outer.*;\n"],
      "c/C.java": ["three", "package c;\nimport static a.*;\n"],
    });
    expect(pairsOf(found)).toEqual(["two one b/B.java"]);
    expect(found.possible.size).toBe(0);
  });
});

describe("check --no-page", () => {
  test("the page place is not read, and a line before the last says so", () => {
    const repo = repoJ();
    rmSync(join(repo, PAGE_FILE));
    const plain = checked(repo);
    expect(plain.code).toBe(1);
    expect(plain.stdout.endsWith(", page outdated\n")).toBe(true);
    expect(plain.stdout).not.toContain("page: not compared");

    const without = checked(repo, "--no-page");
    expect(without.code, without.stderr).toBe(0);
    expect(without.stdout.split("\n").slice(-3)).toEqual(["page: not compared", "check: ok", ""]);
    expect(without.stdout + without.stderr).not.toContain("outdated");
    expect(without.rows).toEqual(EIGHT);

    // Something that is not a codeplan page at the page place.
    writeFileSync(join(repo, PAGE_FILE), "<html></html>\n");
    expect(checked(repo).code).toBe(2);
    expect(checked(repo, "--no-page").code).toBe(0);
    rmSync(join(repo, PAGE_FILE));
    mkdirSync(join(repo, PAGE_FILE));
    expect(checked(repo).code).toBe(2);
    expect(checked(repo, "--no-page").stdout.split("\n").slice(-3)).toEqual(["page: not compared", "check: ok", ""]);
  });

  test("the other problems count as before", () => {
    const repo = repoJ((_plan, tree) => (tree[`${JAVA}/loose/L.java`] = "package app.loose;\n"));
    const out = checked(repo, "--no-page");
    expect(out.code).toBe(1);
    expect(out.stdout.split("\n").slice(-3)).toEqual(["page: not compared", "check: 1 orphan, 0 contested, 0 unwatched, 0 errors, 0 warnings", ""]);

    // A run with no measurement report prints nothing on standard output.
    writeFileSync(join(repo, PLAN_FILE), "{");
    const broken = run(["check", "--no-page"], repo);
    expect([broken.code, broken.stdout]).toEqual([2, ""]);
    // No plan file: the line is there.
    rmSync(join(repo, PLAN_FILE));
    const none = run(["check", "--no-page"], repo);
    expect(none.code).toBe(1);
    expect(none.stdout.split("\n").slice(-3, -2)).toEqual(["page: not compared"]);
  });

  test("the config is checked as before, and the option is of check only", () => {
    const repo = repoJ((_plan, tree) => (tree["codeplan.json"] = JSON.stringify({ page: "elsewhere/codeplan.html" })));
    const out = run(["check", "--no-page"], repo);
    expect([out.code, out.stdout]).toEqual([2, ""]);
    for (const command of ["snapshot", "update", "summary", "report", "draft"]) {
      const other = run([command, "--no-page"], repoJ());
      expect(other.code, command).toBe(2);
      expect(other.stdout).toBe("");
      expect(other.stderr).toContain("--no-page is an option of check only");
    }
    expect(run(["history", "--no-page"], repoJ()).code).toBe(2);
  });
});
