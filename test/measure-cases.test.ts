import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { check, run } from "../src/cli.js";
import { expectCheck, lines, makeRepo, plan, tempDir, writeTree, type Tree } from "./helpers.js";

// A js tree with two parts, and a java tree with one.
const K: Tree = {
  "kit/paint/canvas.ts": lines(3),
  "kit/ledger/journal.ts": lines(5),
};
const K_PARTS = { paint: ["kit/paint/**"], ledger: ["kit/ledger/**"] };
const withPlanK = (more: Tree = {}, parts: Record<string, unknown> = K_PARTS): Tree => ({
  ...K,
  ...more,
  "docs/codeplan/plan.json": plan(parts),
});
const K_OK = { paint: [1, 3], ledger: [1, 5] } as Record<string, [number, number]>;

const V: Tree = {
  "build.gradle.kts": lines(2),
  "src/main/java/org/harbor/Dock.java": lines(4),
};
const V_PARTS = { harbor: ["src/*/*/org/harbor/**"] };
const withPlanV = (more: Tree = {}, parts: Record<string, unknown> = V_PARTS): Tree => ({
  ...V,
  ...more,
  "docs/codeplan/plan.json": plan(parts),
});

describe("the two base trees", () => {
  test("the js tree measures both parts", () => {
    expectCheck(makeRepo(withPlanK()), { parts: K_OK, code: 0 });
  });
  test("the java tree measures its part", () => {
    expectCheck(makeRepo(withPlanV()), { parts: { harbor: [1, 4] }, code: 0 });
  });
});

describe("ownership", () => {
  test("two patterns of equal strength contest, and measurement goes to the first id", () => {
    const repo = makeRepo(withPlanK({}, { paint: ["kit/**"], ledger: ["kit/*/*.ts"] }));
    expectCheck(repo, {
      parts: { paint: [0, 0], ledger: [2, 8] },
      contested: ["kit/ledger/journal.ts", "kit/paint/canvas.ts"],
      warnings: ["empty-part paint"],
      code: 1,
    });
  });

  test("an orphan appears, then goes away when a part takes it", () => {
    const repo = makeRepo(withPlanK());
    expectCheck(repo, { parts: K_OK, code: 0 });
    writeTree(repo, { "kit/atlas/globe.ts": lines(2) });
    expectCheck(repo, { parts: K_OK, orphans: ["kit/atlas/globe.ts"], code: 1 });
    writeTree(repo, { "docs/codeplan/plan.json": plan({ ...K_PARTS, atlas: ["kit/atlas/**"] }) });
    expectCheck(repo, { parts: { ...K_OK, atlas: [1, 2] }, code: 0 });
  });

  test("a file name with a single quote is listed as it is", () => {
    const repo = makeRepo(withPlanK({ "kit/d'accord.ts": lines(6) }));
    expectCheck(repo, { parts: K_OK, orphans: ["kit/d'accord.ts"], code: 1 });
  });
});

describe("the js watch set", () => {
  test("a watch that reaches a dependency directory does not enter it", () => {
    const repo = makeRepo({
      ...withPlanK({ "kit/ledger/node_modules/tally/tally.js": lines(7) }),
      "codeplan.json": '{ "watch": ["kit/**"] }',
    });
    expectCheck(repo, { parts: K_OK, code: 0 });
  });

  test("files under out and dist: a written watch counts them, the default watch skips them", () => {
    const more = { "kit/out/stamp.ts": lines(2), "kit/paint/dist/sprite.tsx": lines(4) };
    const written = makeRepo({ ...withPlanK(more), "codeplan.json": '{ "watch": ["kit/**"] }' });
    expectCheck(written, { parts: { paint: [2, 7], ledger: [1, 5] }, orphans: ["kit/out/stamp.ts"], code: 1 });
    expectCheck(makeRepo(withPlanK(more)), { parts: K_OK, code: 0 });
  });

  test("spec files and tests directories are measured only with tests on", () => {
    const more = { "kit/paint/canvas.spec.ts": lines(2), "kit/ledger/tests/fixture.ts": lines(3) };
    expectCheck(makeRepo(withPlanK(more)), { parts: K_OK, code: 0 });
    expectCheck(makeRepo({ ...withPlanK(more), "codeplan.json": '{ "tests": true }' }), {
      parts: { paint: [2, 5], ledger: [2, 8] },
      code: 0,
    });
  });

  test("bundles and coverage output are on no list", () => {
    const repo = makeRepo(withPlanK({ "thirdparty/chart/build/chart.min.js": lines(9), "coverage/lcov.js": lines(3) }));
    expectCheck(repo, { parts: K_OK, code: 0 });
  });

  test("code under home is not measured", () => {
    const repo = makeRepo(withPlanK({ "docs/codeplan/notes/sketch.ts": lines(4), "docs/codeplan/widget.vue": lines(2) }));
    expectCheck(repo, { parts: K_OK, code: 0 });
  });

  test("outside the parts: an orphan with the default watch, unwatched with a narrow one", () => {
    const more = { "site/home.svelte": lines(3), "site/NOTES.md": lines(2), "node_modules/glue/glue.js": lines(1) };
    expectCheck(makeRepo(withPlanK(more)), { parts: K_OK, orphans: ["site/home.svelte"], code: 1 });
    expectCheck(makeRepo({ ...withPlanK(more), "codeplan.json": '{ "watch": ["kit/**"] }' }), {
      parts: K_OK,
      unwatched: ["site/home.svelte"],
      code: 1,
    });
  });

  test("a skip pattern with ** leaves out the directories below too", () => {
    const repo = makeRepo({
      ...withPlanK({ "kit/schema/types.ts": lines(6), "kit/schema/v2/enums.ts": lines(2) }),
      "codeplan.json": '{ "skip": ["kit/schema/**"] }',
    });
    expectCheck(repo, { parts: K_OK, code: 0 });
  });
});

describe("line counts", () => {
  test("six edge cases of line ends", () => {
    const files: [string, string, number][] = [
      ["bare-lf", "\n", 1],
      ["lf-mid", "ok\nyes", 2],
      ["empty", "", 0],
      ["crlf", "ok\r\nyes\r\n", 2],
      ["plain", "ok", 1],
      ["lf-end", "ok\n", 1],
    ];
    const tree: Tree = { "docs/codeplan/plan.json": plan(Object.fromEntries(files.map(([id]) => [id, [`probe/${id}.ts`]]))) };
    for (const [id, content] of files) tree[`probe/${id}.ts`] = content;
    expectCheck(makeRepo(tree), { parts: Object.fromEntries(files.map(([id, , n]) => [id, [1, n]])), code: 0 });
  });
});

describe("finding the repository", () => {
  test("with --repo, a config file in the working directory is ignored", () => {
    const repo = makeRepo({
      ...K,
      "chart/plan.json": plan({ whole: ["kit/**"] }),
      "codeplan.json": '{ "home": "chart", "watch": ["kit/**/*.ts"] }',
    });
    const elsewhere = makeRepo({ "codeplan.json": '{"bogus": 1}' });
    expectCheck(repo, { parts: { whole: [2, 8] }, code: 0 }, elsewhere);
  });

  test("a repository directory name with characters that mean something in URLs and globs", () => {
    const repo = join(tempDir(), "r&d [v1] %7E #x?y");
    mkdirSync(repo);
    writeTree(repo, withPlanK());
    expectCheck(repo, { parts: K_OK, code: 0 });
  });

  test("a trailing slash on --repo changes nothing", () => {
    const repo = makeRepo(withPlanK());
    expect(run(["update", "--repo", repo], "/").code).toBe(0);
    const plain = run(["check", "--repo", repo], "/");
    expect(plain.code).toBe(0);
    expect(run(["check", "--repo", `${repo}/`], "/")).toEqual(plain);
  });
});

describe("java", () => {
  test("home and watch written in the config win over the java defaults", () => {
    const repo = makeRepo({
      "engine/org/harbor/Valve.java": lines(3),
      "src/main/java/org/harbor/Pump.java": lines(2),
      "blueprint/plan.json": plan({ harbor: ["engine/org/harbor/**", "src/main/java/org/harbor/**"] }),
      "codeplan.json": '{ "languages": ["java"], "home": "blueprint", "watch": ["engine/**/*.java"] }',
    });
    expectCheck(repo, { parts: { harbor: [1, 3] }, unwatched: ["src/main/java/org/harbor/Pump.java"], code: 1 });
  });

  test("roots written in the config replace the language source roots", () => {
    const repo = makeRepo({
      ...withPlanV({ "archive/src/org/harbor/out/Relay.java": lines(3), "src/main/java/org/harbor/target/Probe.java": lines(2) }),
      "codeplan.json": '{ "watch": ["src/main/java/org/harbor/Dock.java"], "roots": ["archive/src"] }',
    });
    expectCheck(repo, { parts: { harbor: [1, 4] }, unwatched: ["archive/src/org/harbor/out/Relay.java"], code: 1 });
  });

  const TIDE: Tree = {
    "pom.xml": lines(3),
    "src/main/java/net/tide/build/Gauge.java": lines(2),
    "src/main/java/net/tide/out/Buoy.java": lines(1),
    "src/main/java/net/tide/target/Mark.java": lines(3),
    "src/main/java/net/tide/tests/Tally.java": lines(2),
    "src/main/kotlin/net/tide/build/Swell.kt": lines(4),
    "out/stubs/net/tide/Stub.java": lines(1),
    "target/apt/Echo.java": lines(2),
  };

  test("build-output names inside a source root are package names", () => {
    const repo = makeRepo({
      ...TIDE,
      "docs/codeplan/plan.json": plan({ tide: ["src/main/java/net/tide/**"] }),
      "codeplan.json": '{ "watch": ["src/main/java/net/**"] }',
    });
    expectCheck(repo, { parts: { tide: [4, 8] }, unwatched: ["src/main/kotlin/net/tide/build/Swell.kt"], code: 1 });
  });

  test("with java and js, a java package named tests is not a test", () => {
    const repo = makeRepo({
      ...TIDE,
      "package.json": lines(1),
      "docs/codeplan/plan.json": plan({ tide: ["src/main/java/net/tide/**", "src/main/kotlin/net/tide/**"] }),
    });
    expectCheck(repo, { parts: { tide: [5, 12] }, code: 0 });
  });

  test("without a config: Kotlin and both mapper forms count, other XML does not", () => {
    const repo = makeRepo(
      withPlanV({
        "src/main/kotlin/org/harbor/Hull.kt": lines(3),
        "src/main/resources/org/harbor/mapper/CargoQuery.xml": lines(5),
        "src/main/resources/org/harbor/BerthMapper.xml": lines(2),
        "src/main/resources/org/harbor/ehcache.xml": lines(2),
      }),
    );
    expectCheck(repo, { parts: { harbor: [4, 14] }, code: 0 });
  });

  test("with a written watch, tests on does not add src/test to the watch set", () => {
    const repo = makeRepo({
      ...withPlanV({ "src/test/java/org/harbor/DockCheck.java": lines(2) }),
      "codeplan.json": '{ "tests": true, "watch": ["src/main/java/org/**/*.java"] }',
    });
    expectCheck(repo, { parts: { harbor: [1, 4] }, unwatched: ["src/test/java/org/harbor/DockCheck.java"], code: 1 });
  });

  test("java and kotlin under src/test join the part only with tests on", () => {
    const more = {
      "src/test/java/org/harbor/DockCheck.java": lines(2),
      "src/test/kotlin/org/harbor/HullCheck.kt": lines(3),
      "src/test/java/org/harbor/out/Drill.java": lines(1),
    };
    expectCheck(makeRepo(withPlanV(more)), { parts: { harbor: [1, 4] }, code: 0 });
    expectCheck(makeRepo({ ...withPlanV(more), "codeplan.json": '{ "tests": true }' }), { parts: { harbor: [4, 10] }, code: 0 });
  });

  test("Kotlin, mappers and tool code outside a narrow watch are unwatched", () => {
    const repo = makeRepo({
      ...withPlanV({
        "src/main/kotlin/org/harbor/Hull.kt": lines(3),
        "src/main/resources/mapper/berth.xml": lines(2),
        "src/main/resources/query/ManifestMapper.xml": lines(4),
        "src/main/resources/application.xml": lines(1),
        "scripts/Seed.java": lines(2),
      }),
      "codeplan.json": '{ "watch": ["src/main/java/org/**/*.java"] }',
    });
    expectCheck(repo, {
      parts: { harbor: [1, 4] },
      unwatched: [
        "scripts/Seed.java",
        "src/main/kotlin/org/harbor/Hull.kt",
        "src/main/resources/mapper/berth.xml",
        "src/main/resources/query/ManifestMapper.xml",
      ],
      code: 1,
    });
  });

  test("two languages together: the union of each language's watch set", () => {
    const tree: Tree = {
      "screen/panel.tsx": lines(4),
      "screen/panel.test.tsx": lines(1),
      "src/main/java/net/quay/Crane.java": lines(2),
      "src/test/java/net/quay/CraneCheck.java": lines(3),
      "docs/codeplan/plan.json": plan({ every: ["screen/*.tsx", "src/*/java/net/quay/*"] }),
    };
    for (const config of ['{ "skip": [], "languages": ["js", "java"] }', '{ "languages": ["java", "js"], "skip": [] }']) {
      expectCheck(makeRepo({ ...tree, "codeplan.json": config }), { parts: { every: [2, 6] }, code: 0 });
    }
  });
});

describe("errors in the config and plan files", () => {
  const exits2 = (repo: string, key?: string) => {
    for (const command of ["update", "check"]) {
      const out = run([command], repo);
      expect(out.code, `${command}\n${out.stderr}`).toBe(2);
      if (key) expect(out.stderr).toContain(key);
    }
  };

  test.each(['{ "home": "" }', '{ "home": "./" }'])("home at the repository root (%s)", (config) => {
    exits2(makeRepo({ ...K, "plan.json": plan(K_PARTS), "codeplan.json": config }), "home");
  });

  test.each(['{ "tests": false, "languages": [] }', '{ "languages": ["js", "java", "js"] }', '{ "languages": ["kotlin"] }'])(
    "languages that cannot be used (%s)",
    (config) => exits2(makeRepo({ ...withPlanV(), "codeplan.json": config })),
  );

  test("an unknown config key is named", () => {
    exits2(makeRepo({ ...withPlanK(), "codeplan.json": '{ "exclude": ["kit/schema/**"] }' }), "exclude");
  });

  test("paths written as one string: bad-shape and incomplete measurement", () => {
    const repo = makeRepo(withPlanK({}, { paint: "kit/paint/**", ledger: ["kit/ledger/**"] }));
    expect(run(["update"], repo).code).toBe(2);
    const out = run(["check"], repo);
    expect(out.code).toBe(2);
    expect(out.stderr.split("\n").filter((l) => / \[(error|warning)\] /.test(l)).map((l) => l.split(" ").slice(0, 3).join(" "))).toEqual([
      "parts[0].paths: bad-shape [error]",
    ]);
    expect(out.stderr).toContain("measurement incomplete");
    expect(out.stderr).not.toContain("kit/paint/canvas.ts");
    const result = check(repo);
    if (result.kind !== "measured") throw new Error(result.message);
    expect(result.measurement.parts.map((p) => [p.id, p.files, p.lines])).toEqual([["ledger", 1, 5]]);
  });

  test("a config file that is not JSON", () => {
    exits2(makeRepo({ ...withPlanK(), "codeplan.json": "{ tests: true }" }));
  });

  test("a watch pattern that starts inside home is an error; one that only reaches it is not", () => {
    const tree = { ...K, "kit/ledger/plan.json": plan(K_PARTS) };
    exits2(makeRepo({ ...tree, "codeplan.json": '{ "home": "kit/ledger", "watch": ["kit/ledger/*.ts"] }' }));
    expectCheck(makeRepo({ ...tree, "codeplan.json": '{ "home": "kit/ledger", "watch": ["kit/**"] }' }), {
      parts: { paint: [1, 3], ledger: [0, 0] },
      warnings: ["empty-part ledger"],
      code: 1,
    });
  });

  test("a config value of the wrong type names its key", () => {
    exits2(makeRepo({ ...withPlanK(), "codeplan.json": '{ "tests": "yes" }' }), "tests");
  });
});

describe("glob", () => {
  test("** matches zero directories as well", () => {
    const repo = makeRepo(withPlanK({}, { paint: ["kit/**/canvas.ts"], ledger: ["kit/ledger/**/journal.ts"] }));
    expectCheck(repo, { parts: K_OK, code: 0 });
  });
});

