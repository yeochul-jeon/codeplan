// The imports of JS and TS files: the blanked text and the five
// expressions, the reading of the text as written, resolution with the
// nearest tsconfig.json or jsconfig.json, three info diagnostics, and the
// jsImports of snapshot and report.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { check, run } from "../src/cli.js";
import { erased, fileImports, parseConfigJson } from "../src/jsimports.js";
import { makeRepo, tempDir, type Tree } from "./helpers.js";

const PLAN_FILE = "docs/codeplan/plan.json";
type Item = Record<string, any>;
const part = (id: string, paths: string[], more: Item = {}): Item => ({ id, name: "", about: "", paths, ...more });
const planOf = (parts: Item[]) => JSON.stringify({ format: 1, name: "", about: "", parts });
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|vue)$/;
const idOf = (path: string) => path.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// What check finds when part "a" owns `from` and every other code file of
// the tree is a part of its own, named after its path (`src/b.ts` is
// "src-b-ts"), except the files in `orphans`.
function judge(tree: Tree, options: { from?: string; orphans?: string[]; config?: Item; parts?: Item[] } = {}) {
  const from = options.from ?? "src/x.ts";
  const parts =
    options.parts ??
    [
      part("a", [from]),
      ...Object.keys(tree)
        .filter((p) => p !== from && CODE.test(p) && !(options.orphans ?? []).includes(p))
        .map((p) => part(idOf(p), [p])),
    ];
  const full: Tree = { "package.json": "{}\n", ...tree, [PLAN_FILE]: planOf(parts) };
  if (options.config !== undefined) full["codeplan.json"] = JSON.stringify(options.config);
  return found(makeRepo(full));
}

function found(repo: string) {
  const result = check(repo, "skip");
  if (result.kind !== "measured") throw new Error(result.message);
  const lines = result.diagnostics.filter((d) => d.severity === "info");
  return {
    repo,
    lines: lines.map((d) => `${d.at}: ${d.code} ${d.message}`),
    // The parts that part "a" imports, by import-without-use.
    pairs: lines.filter((d) => d.code === "import-without-use").map((d) => /files of part "([^"]+)"/.exec(d.message)![1]),
    // The parts and import paths of import-needs-check.
    checks: lines
      .filter((d) => d.code === "import-needs-check")
      .map((d) => /files of part "([^"]+)" through (".*?"), found/.exec(d.message)!.slice(1).join(" ")),
    configs: lines.filter((d) => d.at === "plan").map((d) => `${d.code} ${d.message}`),
    js: result.jsImports,
  };
}

describe("reading a file: the blanked text and the text as written", () => {
  // Probe, file name, text, import paths in the blanked text, import paths
  // only in the text as written.
  const probes: [string, string, string, string[], string[]][] = [
    ["P2", "x.ts", 'if (ok) /`/.test(s);\nconst Page = lazy(()=>import("./Page"));', [], ["./Page"]],
    ["P3", "x.tsx", 'const A = () => <p>use `x` here</p>;\nconst Page = lazy(() => import("./Page"));', ["./Page"], []],
    ["P4", "x.tsx", 'const A = () => <p>a /* b</p>;\nconst Page = lazy(() => import("./Page"));', [], ["./Page"]],
    ["P5", "x.tsx", 'const X = <b>x</b>; const P = lazy(() => import("./Page"));', ["./Page"], []],
    ["P13", "x.tsx", 'const r = <Route path="/a" element={<A/>} />; import("./Late");', ["./Late"], []],
    ["Pstr", "x.js", "const help = \"require('./real')\";", [], ["./real"]],
    // TS files read `import x = require()` only, not a plain require call.
    ["Pstr-ts", "x.ts", "const help = \"require('./real')\";", [], []],
    // A known hole: text like an import in JSX text is read as an import.
    ["JSX text", "x.tsx", "const A = () => <p>import x from './real'</p>;", ["./real"], []],
    ["Pdyn", "x.ts", "const m = await import('./real', { with: { type: 'json' } });", ["./real"], []],
    // A known hole: a regular expression after ")" is read as a division,
    // and the template that follows holds an import in both readings.
    ["reverse", "x.ts", "if (ok) /`/.test(s);\nconst doc = `import x from './real'`;\nconst y = 1;", ["./real"], []],
    ["reverse JSX", "x.tsx", "const A = () => <p>a /* b</p>;\nconst doc = `import x from './real'`;", [], ["./real"]],
  ];
  test.each(probes)("%s", (_name, file, text, read, onlyWritten) => {
    const ts = file.endsWith(".ts") || file.endsWith(".tsx");
    const found = fileImports(text, ts);
    expect(found.read.map((f) => f.path)).toEqual(read);
    expect(found.onlyWritten.map((f) => f.path)).toEqual(onlyWritten);
  });

  test.each(probes)("%s in a repository: an import pair, or an import-needs-check line", (_name, file, text, read, onlyWritten) => {
    const tree: Tree = { [`src/${file}`]: text, "src/Page.ts": "", "src/Late.ts": "", "src/real.ts": "" };
    const out = judge(tree, { from: `src/${file}` });
    expect(out.pairs).toEqual(read.map((p) => idOf(`src/${p.slice(2)}.ts`)));
    expect(out.checks).toEqual(onlyWritten.map((p) => `${idOf(`src/${p.slice(2)}.ts`)} ${JSON.stringify(p)}`));
  });

  test("the blanked text keeps every line break and the length; a / right after a template is a division", () => {
    const text = "a // c\n's'\n`t${'u'}v`\n/r/.x /* d\ne */ b";
    const out = erased(text);
    expect(out.length).toBe(text.length);
    expect(out.split("\n").length).toBe(text.split("\n").length);
    expect(out).toBe("a     \n' '\n` ${' '} `\n/r/.x     \n     b");
  });

  test("the forms the expressions read", () => {
    const paths = (text: string, ts = true) => fileImports(text, ts).read.map((f) => f.path);
    expect(paths('import {\n  a,\n  b\n} from "./x";')).toEqual(["./x"]);
    expect(paths('export * from "./x";\nexport { y } from "./y";')).toEqual(["./x", "./y"]);
    expect(paths('import type { T } from "./t";')).toEqual(["./t"]);
    expect(paths('import x = require("./x");')).toEqual(["./x"]);
    expect(paths('let v: import("./x").T;')).toEqual(["./x"]);
    expect(paths('import "./side";')).toEqual(["./side"]);
    expect(paths('const b = require("./b");')).toEqual([]);
    expect(paths('const b = require("./b");', false)).toEqual(["./b"]);
    // A first argument that is not one string is not read.
    expect(paths("import(name); require(`./b`);", false)).toEqual([]);
    expect(paths('a.import("./x"); x.require("./y");', false)).toEqual([]);
  });

  test("a / after a comment, a string or a word is a division; after a symbol it starts a regular expression", () => {
    expect(erased("x /* c */ / 2; 'import(\"./a\")'")).toBe("x         / 2; '             '");
    expect(erased('"a" / 2 / "b"')).toBe('" " / 2 / " "');
    expect(erased("a = /i'mport/; b")).toBe("a = /       /; b");
    expect(erased("return /x'/; f")).toBe("return /  /; f");
    // A regular expression with no closing / ends at the end of the line.
    expect(erased("a = /x'y\nb")).toBe("a = /   \nb");
    expect(erased("a = /[/]'/ b")).toBe("a = /    / b");
  });

  test("templates read the code in ${…}, nested", () => {
    expect(fileImports("`${ `${ import('./deep') }` }` + `import('./text')`", true).read.map((f) => f.path)).toEqual(["./deep"]);
  });

  test("an import path only in the text as written comes once, at its first place", () => {
    const found = fileImports('// import "./b";\nimport "./a";\n// import "./a"; import "./b";', true);
    expect(found.read.map((f) => f.path)).toEqual(["./a"]);
    expect(found.onlyWritten.map((f) => f.path)).toEqual(["./b", "./a"]);
  });
});

describe("resolving an import path", () => {
  test("a .js path takes a .ts file of the same name first", () => {
    expect(judge({ "src/x.ts": 'import "./b.js";', "src/b.ts": "", "src/b.js": "" }).pairs).toEqual(["src-b-ts"]);
    expect(judge({ "src/x.ts": 'import "./b.js";', "src/b.js": "" }).pairs).toEqual(["src-b-js"]);
    expect(judge({ "src/x.ts": 'import "./b.jsx";', "src/b.tsx": "", "src/b.jsx": "" }).pairs).toEqual(["src-b-tsx"]);
  });

  test("endings are added in order, but not .mjs or .cjs", () => {
    expect(judge({ "src/x.ts": 'import "./c";', "src/c.d.ts": "", "src/c.js": "" }).pairs).toEqual(["src-c-d-ts"]);
    const mjs = judge({ "src/x.ts": 'import "./c";', "src/c.mjs": "" });
    expect(mjs.pairs).toEqual([]);
    expect(mjs.js?.notResolved).toBe(1);
  });

  test("a directory is read through its index file", () => {
    expect(judge({ "src/x.ts": 'import "./lib";', "src/lib/index.tsx": "", "src/lib/index.js": "" }).pairs).toEqual(["src-lib-index-tsx"]);
    expect(judge({ "src/x.ts": 'import "..";', "index.ts": "" }).pairs).toEqual(["index-ts"]);
  });

  const TS = (options: Item, more: Item = {}) => JSON.stringify({ ...more, compilerOptions: options });

  test("paths: a key with no * wins, then the longest text before the *, then the first written", () => {
    const tree = (paths: Item) => ({
      "src/x.ts": 'import "@app/util";',
      "tsconfig.json": TS({ paths }),
      "exact/u.ts": "",
      "long/util.ts": "",
      "short/app/util.ts": "",
      "first/util.ts": "",
      "second/util.ts": "",
    });
    expect(judge(tree({ "@*": ["./short/*"], "@app/util": ["./exact/u.ts"], "@app/*": ["./long/*"] })).pairs).toEqual(["exact-u-ts"]);
    expect(judge(tree({ "@*": ["./short/*"], "@app/*": ["./long/*"] })).pairs).toEqual(["long-util-ts"]);
    expect(judge(tree({ "@app/*": ["./first/*"], "@app/*l": ["./second/*l"] })).pairs).toEqual(["first-util-ts"]);
    // The values of a key are tried in order.
    expect(judge(tree({ "@app/*": ["./none/*", "./second/*"] })).pairs).toEqual(["second-util-ts"]);
  });

  test("a relative path that gives no file does not go on to paths or baseUrl", () => {
    const out = judge({ "src/x.ts": 'import "./gone";', "tsconfig.json": TS({ baseUrl: "src", paths: { "./gone": ["gone.ts"] } }), "gone.ts": "" });
    expect(out.pairs).toEqual([]);
    expect(out.js?.notResolved).toBe(1);
  });

  test("a paths key that matches and gives no file does not go on to baseUrl", () => {
    const tree = { "src/x.ts": 'import "lib/b";', "lib/b.ts": "" };
    const matched = judge({ ...tree, "tsconfig.json": TS({ baseUrl: ".", paths: { "lib/*": ["none/*"] } }) });
    expect(matched.pairs).toEqual([]);
    expect(matched.js?.notResolved).toBe(1);
    // With no key that matches, baseUrl is used.
    expect(judge({ ...tree, "tsconfig.json": TS({ baseUrl: ".", paths: { "other/*": ["none/*"] } }) }).pairs).toEqual(["lib-b-ts"]);
    // With no baseUrl, a package name is left, and not counted.
    const left = judge({ ...tree, "tsconfig.json": TS({ paths: { "other/*": ["none/*"] } }) });
    expect(left.pairs).toEqual([]);
    expect(left.js?.notResolved).toBe(0);
  });

  test("files that give no import pair and are not counted as not resolved", () => {
    const tree: Tree = {
      "src/x.ts": ['import "./style.css";', 'import "./data.json";', 'import "./x.test";', 'import "./vendor/v";', 'import "./lone";', 'import "../out/o";'].join("\n"),
      "src/style.css": "",
      "src/data.json": "{}",
      "src/x.test.ts": "",
      "src/vendor/v.ts": "",
      "src/lone.ts": "",
      "out/o.ts": "",
    };
    const out = judge(tree, { orphans: ["src/lone.ts"], config: { skip: ["src/vendor/**"], watch: ["src/**/*.ts", "src/**/*.test.ts"] } });
    expect(out.pairs).toEqual([]);
    expect(out.js).toEqual({ files: 1, notResolved: 0 });
  });

  test("a relative path with nothing on the disk counts once for each file and import path", () => {
    const out = judge({ "src/x.ts": 'import "./gone";\nimport("./gone");\nimport "./also";', "src/y.ts": 'import "./gone";' });
    expect(out.js).toEqual({ files: 2, notResolved: 3 });
  });

  test("a path out of the repository is no file", () => {
    expect(judge({ "src/x.ts": 'import "../../up";' }).js?.notResolved).toBe(1);
  });
});

describe("the config of a file", () => {
  const TS = (options: Item, more: Item = {}) => JSON.stringify({ ...more, compilerOptions: options });
  const B = { "lib/b.ts": "", "other/b.ts": "" };

  test("the nearest tsconfig.json wins, and tsconfig.json wins over jsconfig.json in one directory", () => {
    const tree = { "src/x.ts": 'import "b";', ...B };
    expect(judge({ ...tree, "tsconfig.json": TS({ baseUrl: "other" }), "src/tsconfig.json": TS({ baseUrl: "../lib" }) }).pairs).toEqual(["lib-b-ts"]);
    expect(judge({ ...tree, "src/jsconfig.json": TS({ baseUrl: "../other" }), "src/tsconfig.json": TS({ baseUrl: "../lib" }) }).pairs).toEqual(["lib-b-ts"]);
    expect(judge({ ...tree, "tsconfig.json": TS({ baseUrl: "lib" }), "src/jsconfig.json": TS({ baseUrl: "../other" }) }).pairs).toEqual(["other-b-ts"]);
  });

  test("a relative extends passes paths on: a list, a name with no .json, and a loop", () => {
    const tree = { "src/x.ts": 'import "@b";', ...B };
    const paths = { "@b": ["lib/b.ts"] };
    expect(judge({ ...tree, "tsconfig.json": JSON.stringify({ extends: ["./base/one", "./base/two.json"] }), "base/one.json": TS({}), "base/two.json": TS({ paths: { "@b": ["../lib/b.ts"] } }) }).pairs).toEqual(["lib-b-ts"]);
    // A loop stops where a file comes again on the way.
    const loop = judge({ ...tree, "tsconfig.json": JSON.stringify({ extends: "./a.json" }), "a.json": TS({ paths }, { extends: "./tsconfig.json" }) });
    expect(loop.pairs).toEqual(["lib-b-ts"]);
    expect(loop.configs).toEqual([]);
    // Two parents with one ancestor are no loop: the ancestor applies again.
    const diamond = judge({
      ...tree,
      "tsconfig.json": JSON.stringify({ extends: ["./l.json", "./r.json"] }),
      "l.json": TS({ paths }, { extends: "./top.json" }),
      "r.json": JSON.stringify({ extends: "./top.json" }),
      "top.json": TS({ paths: { "@b": ["other/b.ts"] } }),
    });
    expect(diamond.pairs).toEqual(["other-b-ts"]);
    // The config's own values win over what it extends.
    expect(judge({ ...tree, "tsconfig.json": TS({ paths }, { extends: "./top.json" }), "top.json": TS({ paths: { "@b": ["other/b.ts"] } }) }).pairs).toEqual(["lib-b-ts"]);
  });

  test("paths start from baseUrl when there is one, else from the config that wrote them", () => {
    const tree = { "src/x.ts": 'import "@b";', "cfg/lib/b.ts": "", "base/lib/b.ts": "", "lib/b.ts": "" };
    const paths = { "@b": ["lib/b.ts"] };
    expect(judge({ ...tree, "tsconfig.json": JSON.stringify({ extends: "./cfg/c.json" }), "cfg/c.json": TS({ paths }) }).pairs).toEqual(["cfg-lib-b-ts"]);
    expect(judge({ ...tree, "tsconfig.json": TS({ paths }, { extends: "./cfg/c.json" }), "cfg/c.json": TS({ baseUrl: "../base" }) }).pairs).toEqual(["base-lib-b-ts"]);
    expect(judge({ ...tree, "tsconfig.json": TS({ baseUrl: "base" }, { extends: "./cfg/c.json" }), "cfg/c.json": TS({ paths }) }).pairs).toEqual(["base-lib-b-ts"]);
  });

  test("comments and trailing commas are read", () => {
    expect(parseConfigJson('{ // c\n "a": "//x", /* d */ "b": [1, 2,], }')).toEqual({ a: "//x", b: [1, 2] });
    expect(parseConfigJson('{"a": "\\"/*"}')).toEqual({ a: '"/*' });
    expect(parseConfigJson("{ x }")).toBe(undefined);
    const tree = { "src/x.ts": 'import "b";', ...B, "tsconfig.json": '{\n  // the root\n  "compilerOptions": { "baseUrl": "lib", },\n}\n' };
    expect(judge(tree).pairs).toEqual(["lib-b-ts"]);
  });

  test("tsconfig-not-read: a config that is not JSON is not used and the search stops there", () => {
    const out = judge({ "src/x.ts": 'import "b";', ...B, "tsconfig.json": TS({ baseUrl: "lib" }), "src/tsconfig.json": "{ nope" });
    expect(out.pairs).toEqual([]);
    expect(out.configs).toEqual(["tsconfig-not-read src/tsconfig.json is not read: it is not JSON"]);
  });

  test("tsconfig-not-read: a relative extends with no file; the config keeps its own values and the other extends", () => {
    const out = judge({
      "src/x.ts": 'import "@b";\nimport "b";',
      ...B,
      "tsconfig.json": TS({ baseUrl: "other" }, { extends: ["./gone", "./p.json"] }),
      // The baseUrl of tsconfig.json is where these paths start.
      "p.json": TS({ paths: { "@b": ["../lib/b.ts"] } }),
    });
    expect(out.pairs).toEqual(["lib-b-ts", "other-b-ts"]);
    expect(out.configs).toEqual(['tsconfig-not-read tsconfig.json is not read: extends "./gone" is not a file']);
  });

  test("tsconfig-not-read: a parent that is not JSON is named itself", () => {
    const out = judge({ "src/x.ts": 'import "b";', ...B, "tsconfig.json": TS({ baseUrl: "lib" }, { extends: "./p.json" }), "p.json": "[" });
    expect(out.pairs).toEqual(["lib-b-ts"]);
    expect(out.configs).toEqual(["tsconfig-not-read p.json is not read: it is not JSON"]);
  });

  test("an extends that is a package name is not read and gives no line", () => {
    const out = judge({ "src/x.ts": 'import "b";', ...B, "tsconfig.json": TS({ baseUrl: "lib" }, { extends: "@tsconfig/node22" }) });
    expect(out.pairs).toEqual(["lib-b-ts"]);
    expect(out.configs).toEqual([]);
  });

  test("tsconfig-references-not-followed: references with no paths or baseUrl", () => {
    const refs = { references: [{ path: "./tsconfig.app.json" }], files: [] };
    const out = judge({ "src/x.ts": 'import "@b";', ...B, "tsconfig.json": JSON.stringify(refs), "tsconfig.app.json": TS({ paths: { "@b": ["lib/b.ts"] } }) });
    expect(out.pairs).toEqual([]);
    expect(out.js?.notResolved).toBe(0);
    expect(out.configs).toEqual([
      "tsconfig-references-not-followed tsconfig.json has references, which are not followed, and no paths or baseUrl, so aliases in the referenced configs are not used",
    ]);
    const withPaths = judge({ "src/x.ts": 'import "@b";', ...B, "tsconfig.json": TS({ paths: { "@b": ["lib/b.ts"] } }, refs) });
    expect(withPaths.pairs).toEqual(["lib-b-ts"]);
    expect(withPaths.configs).toEqual([]);
  });

  test("config findings come first, by code and then by path", () => {
    const out = judge(
      {
        "z/x.ts": "",
        "a/y.ts": "",
        "m/w.ts": "",
        "z/tsconfig.json": "{",
        "a/tsconfig.json": "{",
        "m/tsconfig.json": JSON.stringify({ references: [{ path: "x" }] }),
      },
      { from: "z/x.ts", parts: [part("a", ["z/**"], { uses: [{ to: "zz" }] }), part("b", ["a/**"]), part("c", ["m/**"])] },
    );
    expect(out.lines.map((l) => l.split(" ").slice(0, 3).join(" "))).toEqual([
      "plan: tsconfig-not-read a/tsconfig.json",
      "plan: tsconfig-not-read z/tsconfig.json",
      "plan: tsconfig-references-not-followed m/tsconfig.json",
    ]);
  });
});

describe("the findings", () => {
  test("import-needs-check comes before import-without-use at one place, each in the order of the parts", () => {
    const out = judge(
      { "src/x.ts": '// import "./c";\nimport "./b";\n// import "./b2";', "src/b.ts": "", "src/b2.ts": "", "src/c.ts": "" },
      { parts: [part("a", ["src/x.ts"]), part("c", ["src/c.ts"]), part("b", ["src/b.ts", "src/b2.ts"])] },
    );
    expect(out.lines).toEqual([
      'parts[0].uses: import-needs-check part "a": src/x.ts may import files of part "c" through "./c", found only when comments and strings are read too, and the plan has no use of it',
      'parts[0].uses: import-without-use part "a": files of this part import files of part "b" and the plan has no use of it, for example src/x.ts',
    ]);
  });

  test("no import-needs-check for a planned part, a part whose uses is not an array, or a use already there", () => {
    const tree = { "src/x.ts": '// import "./b";', "src/b.ts": "" };
    const base = (a: Item, b: Item = {}) => judge(tree, { parts: [part("a", ["src/x.ts"], a), part("b", ["src/b.ts"], b)] }).checks;
    expect(base({})).toEqual(['b "./b"']);
    expect(base({ planned: true })).toEqual([]);
    expect(base({}, { planned: true })).toEqual([]);
    expect(base({ uses: [{ to: "b" }] })).toEqual([]);
    expect(base({ uses: {} })).toEqual([]);
  });

  test("an import-needs-check names the first file and its first import path that reaches the part", () => {
    const out = judge(
      { "src/y.ts": '// import "./b2"\n// import "./b"', "src/x.ts": '// import "./b"', "src/b.ts": "", "src/b2.ts": "" },
      { parts: [part("a", ["src/x.ts", "src/y.ts"]), part("b", ["src/b.ts", "src/b2.ts"])] },
    );
    expect(out.lines[0]).toContain("src/x.ts may import files of part \"b\" through \"./b\"");
    // A file whose import pair is there gives no import-needs-check.
    const both = judge({ "src/x.ts": '// import "./b"', "src/y.ts": 'import "./b"', "src/b.ts": "" }, { parts: [part("a", ["src/x.ts", "src/y.ts"]), part("b", ["src/b.ts"])] });
    expect(both.checks).toEqual([]);
    expect(both.pairs).toEqual(["b"]);
  });

  test("with a part left out of counting or a contested file, nothing is judged and snapshot has no jsImports", () => {
    const tree = { "src/x.ts": 'import "./b";', "src/b.ts": "", "tsconfig.json": "{" };
    const left = judge(tree, { parts: [part("a", ["src/x.ts"]), part("b", ["src/b.ts"]), part("c", [""])] });
    expect(left.lines.filter((l) => !l.includes("bad-shape"))).toEqual([]);
    expect(left.js).toBe(null);
    const contested = judge(tree, { parts: [part("a", ["src/x.ts"]), part("b", ["src/b.ts"]), part("c", ["src/b.ts"])] });
    expect(contested.lines).toEqual([]);
    expect(contested.js).toBe(null);
    expect(JSON.parse(run(["snapshot"], contested.repo).stdout)).not.toHaveProperty("jsImports");
  });
});

describe("java and js together", () => {
  const JAVA = "src/main/java/app";
  const tree = (more: Tree = {}): Tree => ({
    "pom.xml": "<project/>\n",
    [`${JAVA}/web/Web.java`]: "package app.web;\nimport app.core.Core;\nclass Web {}\n",
    [`${JAVA}/core/Core.java`]: "package app.core;\nclass Core {}\n",
    "src/main/js/web/a.ts": 'import "../core/b";',
    "src/main/js/core/b.ts": "",
    ...more,
  });
  const parts = (webUses?: Item[]) => [
    part("web", [`${JAVA}/web/**`, "src/main/js/web/**"], webUses === undefined ? {} : { uses: webUses }),
    part("core", [`${JAVA}/core/**`, "src/main/js/core/**"]),
  ];
  const config = { languages: ["java", "js"], watch: ["src/main/java/**/*.java", "src/main/js/**/*.ts"] };

  test("the pairs of the two languages give one line, with the first file of both as the example", () => {
    const out = judge(tree(), { from: "-", parts: parts(), config });
    expect(out.lines).toEqual([
      'parts[0].uses: import-without-use part "web": files of this part import files of part "core" and the plan has no use of it, for example src/main/java/app/web/Web.java',
    ]);
    const jsFirst = judge(tree({ "src/a/web.ts": 'import "../main/js/core/b";' }), {
      from: "-",
      parts: [part("web", [`${JAVA}/web/**`, "src/main/js/web/**", "src/a/**"]), part("core", [`${JAVA}/core/**`, "src/main/js/core/**"])],
      config: { ...config, watch: [...config.watch, "src/a/*.ts"] },
    });
    expect(jsFirst.lines[0]).toMatch(/for example src\/a\/web\.ts$/);
  });

  test("with only the js judgment, only the JS pairs count, and the other way round", () => {
    const javaOnly = tree({ [`${JAVA}/web/Web.java`]: "package app.web;\nclass Web {}\n" });
    expect(judge(javaOnly, { from: "-", parts: parts(), config }).lines[0]).toMatch(/for example src\/main\/js\/web\/a\.ts$/);
    expect(judge(tree(), { from: "-", parts: parts(), config: { ...config, languages: ["java"] } }).lines[0]).toMatch(/Web\.java$/);
    const noJava = judge(tree({ "src/main/js/web/a.ts": "" }), { from: "-", parts: parts(), config: { ...config, languages: ["js"] } });
    expect(noJava.lines).toEqual([]);
  });

  test("a JS import pair keeps use-without-import away", () => {
    const javaOnly = tree({ [`${JAVA}/web/Web.java`]: "package app.web;\nclass Web {}\n" });
    expect(judge(javaOnly, { from: "-", parts: parts([{ to: "core" }]), config }).lines).toEqual([]);
    const noImport = judge(tree({ [`${JAVA}/web/Web.java`]: "package app.web;\nclass Web {}\n", "src/main/js/web/a.ts": "" }), {
      from: "-",
      parts: parts([{ to: "core" }]),
      config,
    });
    expect(noImport.lines).toEqual(['parts[0].uses[0].to: use-without-import part "web": no file of this part imports a file of part "core"']);
  });

  test("a repository without js prints the snapshot it printed before: no jsImports key", () => {
    const repo = makeRepo({ ...tree(), [PLAN_FILE]: planOf(parts()), "codeplan.json": JSON.stringify({ ...config, languages: ["java"] }) });
    const keys = Object.keys(JSON.parse(run(["snapshot"], repo).stdout));
    expect(keys).toEqual(["snapshot", "rules", "config", "plan", "complete", "page", "parts", "owned", "orphans", "contested", "unwatched", "tasks", "diagnostics"]);
  });
});

describe("snapshot and report", () => {
  const tree = (): Tree => ({ "package.json": "{}\n", "src/x.ts": 'import "./gone";\n// import "./b";', "src/b.ts": "", [PLAN_FILE]: planOf([part("a", ["src/x.ts"]), part("b", ["src/b.ts"])]) });

  test("jsImports comes after parts, with the three counts", () => {
    const s = JSON.parse(run(["snapshot"], makeRepo(tree())).stdout);
    expect(Object.keys(s).slice(6, 8)).toEqual(["parts", "jsImports"]);
    expect(s.jsImports).toEqual({ files: 2, notResolved: 1, toCheck: 1 });
  });

  test("no plan file: no file is read", () => {
    const s = JSON.parse(run(["snapshot"], makeRepo({ "package.json": "{}\n", "src/x.ts": "" })).stdout);
    expect(s.jsImports).toEqual({ files: 0, notResolved: 0, toCheck: 0 });
  });

  const baseWith = (repo: string, change: (s: Item) => void) => {
    const s = JSON.parse(run(["snapshot"], repo).stdout);
    change(s);
    const file = join(tempDir(), "base.json");
    writeFileSync(file, JSON.stringify(s));
    return file;
  };

  test.each([
    ["not an object", (s: Item) => void (s.jsImports = [1])],
    ["a count that is not a whole number", (s: Item) => void (s.jsImports.files = 1.5)],
    ["a negative count", (s: Item) => void (s.jsImports.toCheck = -1)],
    ["a missing count", (s: Item) => void delete s.jsImports.notResolved],
  ])("a base whose jsImports is %s ends report with exit code 2", (_what, change) => {
    const repo = makeRepo(tree());
    const out = run(["report", "--base", baseWith(repo, change)], repo);
    expect(out.code).toBe(2);
    expect(out.stdout).toBe("");
    expect(out.stderr).toMatch(/jsImports/);
  });

  test("history does not look at jsImports", () => {
    const repo = makeRepo(tree());
    const records = tempDir();
    const s = JSON.parse(run(["snapshot"], repo).stdout);
    writeFileSync(join(records, "1.json"), JSON.stringify(s));
    writeFileSync(join(records, "2.json"), JSON.stringify({ ...s, jsImports: "not counts" }));
    const out = run(["history", records], repo);
    expect(out.code).toBe(0);
    expect(out.stderr).toBe("");
  });

  test("the paragraph, with the base's counts when the base has them", () => {
    const repo = makeRepo(tree());
    run(["update"], repo);
    const paragraph = "### JS and TS imports\n\n2 files read, 1 import paths not resolved, 1 imports to check.";
    expect(run(["report"], repo).stdout).toContain(`${paragraph}\n`);
    expect(run(["report", "--base", baseWith(repo, (s) => void (s.jsImports.files = 7))], repo).stdout).toContain(`${paragraph} In the base: 7, 1, 1.\n`);
    expect(run(["report", "--base", baseWith(repo, (s) => void delete s.jsImports)], repo).stdout).toContain(`${paragraph}\n`);
    // The paragraph does not change the state line.
    expect(run(["report"], repo).stdout.split("\n")[2]).toBe("check: ok");
  });
});
