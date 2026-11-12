import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { run } from "../src/cli.js";
import { tempDir } from "./helpers.js";
import { expectDraftInvariants, runDraft, writeRepo } from "./draft-helpers.js";
import { expectCheck, lines, makeRepo, plan } from "./helpers.js";

const MODULES = `
pom.xml 1
apps/billing/pom.xml 1
apps/billing/src/main/java/org/sample/billing/Bill.java 12
apps/catalog/pom.xml 1
apps/catalog/src/main/java/org/sample/catalog/Cat.java 3
apps/catalog/src/main/java/org/sample/catalog/view/View.java 2
libs/base/pom.xml 1
libs/base/src/main/java/org/sample/base/Util.java 1
libs/text/build.gradle 1
libs/text/src/main/kotlin/org/sample/text/Text.kt 4
ship/pom.xml 1
ship/src/main/java/org/sample/ship/Ship.java 9
ship/scripts/deep/Run.java 2
ship/track/pom.xml 1
ship/track/src/main/java/org/sample/track/Track.java 5
tools/Lint.java 6
`;

function entries(text: string): [string, string][] {
  return text
    .trim()
    .split("\n")
    .map((l) => l.trim().split(/\s+/) as [string, string])
    .map(([path, n]) => [path, "x\n".repeat(Number(n))]);
}

describe("draft output is the same for the same input", () => {
  test("twice on one tree, and on the tree written in reverse order in another place", () => {
    const files = entries(MODULES);
    const first = writeRepo(Object.fromEntries(files));
    const once = run(["draft", "--max-parts", "4"], first);
    expect(once.code).toBe(0);
    expect(run(["draft", "--max-parts", "4"], first)).toEqual(once);

    const other = join(tempDir(), "another-name");
    mkdirSync(other);
    writeRepo(Object.fromEntries([...files].reverse()), other);
    expect(run(["draft", "--max-parts", "4"], other)).toEqual(once);
    expect(once.stdout).not.toContain(first);
  });
});

// A small seeded generator: trees with and without modules, mapper XML,
// files outside modules, and names that are hard for ids and globs.
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ["a", "b", "core", "util", "top-2", "_", "Web_x", "web-x", "build", "lib[1]", "q{r}"];

function randomTree(seed: number): { files: Record<string, string>; roots: string[] } {
  const r = random(seed);
  const pick = <T>(items: T[]): T => items[Math.floor(r() * items.length)]!;
  const dirs = (max: number) =>
    Array.from({ length: Math.floor(r() * (max + 1)) }, () => pick(NAMES)).join("/");
  const files: Record<string, string> = {};
  const add = (path: string, n = 1 + Math.floor(r() * 9)) => {
    files[path.replace(/^\/+|\/\/+/g, "")] = lines(n);
  };
  const mapper = (path: string, ns: string) => {
    files[path] = `<mapper namespace="${ns}">\n</mapper>\n`;
  };
  const kind = pick(["js", "one", "many"]);
  if (kind === "js") {
    files["package.json"] = "{}";
    for (let i = 0; i < 2 + r() * 10; i++) add(`${dirs(3)}/f${i}.${pick(["ts", "js", "vue"])}`);
    return { files, roots: [] };
  }
  files["pom.xml"] = "x";
  // Sometimes the source roots are given on the command line instead, and
  // then module names often hold glob characters.
  const giveRoots = r() < 0.4;
  const names = giveRoots ? ["m[1]-", "k{2}-", "svc/m"] : ["m", "svc/m", "apps/m", "m[1]-", "k{2}-"];
  const modules =
    kind === "one"
      ? [giveRoots ? "lib[1]" : ""]
      : Array.from({ length: 2 + Math.floor(r() * 4) }, (_, i) =>
          i === 0 && r() < 0.3 ? "" : `${pick(names)}${i}`);
  const roots = new Set<string>();
  for (const m of new Set(modules)) {
    const base = m === "" ? "" : `${m}/`;
    if (m !== "") files[`${base}pom.xml`] = "x";
    const classes: string[] = [];
    for (let i = 0; i < 1 + r() * 6; i++) {
      const pkg = `org/x/${dirs(2)}`.replace(/\/$/, "");
      const name = `C${i}`;
      const root = `${base}src/main/${pick(["java", "kotlin"])}`;
      roots.add(root);
      add(`${root}/${pkg}/${name}.${pick(["java", "kt"])}`);
      classes.push(`${pkg.replace(/\//g, ".")}.${name}`);
    }
    for (let i = 0; i < r() * 4; i++) {
      const dir = pick(["mapper", "mapper/x", "sql", "", "org/x"]);
      const file = `${base}src/main/resources/${dir ? dir + "/" : ""}${pick(["A", "B", "CMapper"])}${i}.xml`;
      mapper(file.replace("//", "/"), r() < 0.5 ? pick(classes) : "none.N");
    }
    // Code beside the mapper XML, in the resources directory.
    if (r() < 0.4) add(`${base}src/main/resources/${pick(["mapper", "", "sql/x"])}/Helper.java`);
    if (r() < 0.3) add(`${base}notes/${dirs(1)}/N.java`);
  }
  for (let i = 0; i < r() * 4; i++) add(`${pick(["tools", "scripts", "x"])}/${dirs(2)}/T${i}.java`);
  if (r() < 0.3) add(`Root${seed}.java`);
  return { files, roots: giveRoots ? [...roots] : [] };
}

describe("draft invariants on generated trees", () => {
  const seeds = Array.from({ length: 30 }, (_, i) => i + 1);
  test.each(seeds)("seed %i", (seed) => {
    const { files, roots } = randomTree(seed);
    for (const max of ["1", "2", "3", "16"]) {
      const repo = writeRepo(files);
      const args = ["--max-parts", max, ...roots.flatMap((r) => ["--root", r])];
      const result = runDraft(repo, args);
      expectDraftInvariants(repo, result, null, args);
    }
  });
});

describe("glob", () => {
  test("[{] is the character { and does not open alternatives", () => {
    const repo = makeRepo({
      "{a,b}/f.ts": lines(2),
      "docs/codeplan/plan.json": plan({ p: ["[{]a,b}/**"] }),
    });
    expectCheck(repo, { parts: { p: [1, 2] }, code: 0 });
  });
});
