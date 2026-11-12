import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { check, run } from "../src/cli.js";
import type { MapperCounts } from "../src/draft.js";
import { expectDraftInvariants, noteFacts, runDraft, tree, writeRepo } from "./draft-helpers.js";
import { tempDir } from "./helpers.js";

type Row = [id: string, paths: string[], zone: string | null, files: number, lines: number];

interface Case {
  name: string;
  tree: string;
  existing?: Record<string, unknown>;
  args?: string[];
  languages: string[];
  languageSource: string;
  rootSource?: string;
  parts: Row[];
  total: [files: number, lines: number];
  config: Record<string, unknown>;
  // Notes other than "no zones" (which every one-module Java draft has).
  notes?: Record<string, Record<string, number>>;
  modules?: string[];
  mappers?: Partial<MapperCounts>;
}

const NO_MAPPERS: MapperCounts = {
  namespace: 0, fileName: 0, package: 0, rest: 0, restFiles: [], outsidePattern: 0,
};

const JAVA_WATCH = ["src/main/java/**/*.java", "src/main/java/**/*.kt"];
const LANGUAGE_ROOTS_WATCH = [
  "**/src/main/java/**/*.java",
  "**/src/main/java/**/*.kt",
  "**/src/main/kotlin/**/*.java",
  "**/src/main/kotlin/**/*.kt",
];
const BOTH_EXTENSIONS = ["astro", "cjs", "java", "js", "jsx", "kt", "mjs", "svelte", "ts", "tsx", "vue"];

function runCase(c: Case): void {
  const files = tree(c.tree);
  if (c.existing) files["codeplan.json"] = JSON.stringify(c.existing);
  const repo = writeRepo(files);
  const result = runDraft(repo, c.args);
  // The same tree written in reverse order under another name gives the same bytes.
  const elsewhere = join(tempDir(), "elsewhere");
  writeRepo(Object.fromEntries(Object.entries(files).reverse()), elsewhere);
  expect(run(["draft", ...(c.args ?? [])], elsewhere)).toEqual(run(["draft", ...(c.args ?? [])], repo));

  const rows: Row[] = result.plan.parts.map((p, i) => [
    p.id,
    p.paths,
    p.zone ?? null,
    result.measure.parts[i]!.files,
    result.measure.parts[i]!.lines,
  ]);
  expect(rows).toEqual(c.parts);
  for (const p of result.plan.parts) {
    expect(p).toEqual({ id: p.id, name: p.id, about: "", paths: p.paths, ...(p.zone ? { zone: p.zone } : {}) });
  }
  expect(result.measure.parts.map((p) => p.id)).toEqual(result.plan.parts.map((p) => p.id));
  expect([result.measure.files, result.measure.lines]).toEqual(c.total);
  expect(result.plan).toMatchObject({ format: 1, name: "", about: "", externals: [], scenarios: [] });
  expect(result.config).toEqual(c.config);
  expect(result.config.languages).toEqual(c.languages);
  expect(result.sources).toEqual({
    languages: c.languageSource,
    ...(c.rootSource ? { roots: c.rootSource } : {}),
  });

  const java = c.languages.includes("java");
  const modules = c.modules ?? (java ? ["."] : undefined);
  expect(result.modules).toEqual(modules);
  expect(result.mappers).toEqual(java ? { ...NO_MAPPERS, ...c.mappers } : undefined);
  const notes = { ...c.notes, ...(java && modules!.length === 1 ? { "no-zones": {} } : {}) };
  expect(noteFacts(result.notes)).toEqual(notes);

  expectDraftInvariants(repo, result, c.existing ?? null, c.args);
}

const ONE_JS = `
package.json  1
index.ts      3
cli.mjs       2
`;

const APP_WEB = `
app/main.ts            5
app/core/state.ts      3
app/core/deep/hook.ts  2
web/page.tsx           4
`;

const BOTH_LANGUAGES = `
build.gradle                              1
src/main/java/org/sample/App.java         2
src/main/java/org/sample/test/Probe.java  3
src/main/java/org/sample/ui/widget.ts     1
web/app.ts                                4
web/app.test.ts                           1
`;

const KIOSK = `
pom.xml                                                   1
src/main/java/org/sample/kiosk/App.java                   6
src/main/java/org/sample/kiosk/ticket/Ticket.java         20
src/main/java/org/sample/kiosk/ticket/TicketService.java  30
src/main/java/org/sample/kiosk/ticket/api/TicketApi.java  12
src/main/java/org/sample/kiosk/till/Till.java             15
src/main/java/org/sample/kiosk/till/gateway/Gate.java     9
src/main/java/org/sample/kiosk/user/User.java             4
src/main/java/org/sample/kiosk/user/role/Role.java        3
`;

const CARGO_TOLL = `
pom.xml                                               1
src/main/java/org/sample/App.java                     5
src/main/java/org/sample/cargo/CargoDao.java          10
src/main/java/org/sample/cargo/CargoView.java         4
src/main/java/org/sample/toll/TollDao.java            8
src/main/resources/mapper/cargo/CargoDao.xml          M org.sample.cargo.CargoDao
src/main/resources/mapper/cargo/CargoView.xml         M old.pkg.Nothing
src/main/resources/mapper/cargo/Spare.xml             M z.Spare
src/main/resources/mapper/extra/TrailMapper.xml       M a.b.Trail
src/main/resources/org/sample/toll/TollSqlMapper.xml  M x.y.Unknown
src/main/resources/RootMapper.xml                     M q.Root
src/main/resources/TollMapper.xml                     M org.sample.toll.TollDao
src/main/resources/sql/toll/TollQuery.xml             M org.sample.toll.TollDao
src/main/resources/sql/batch/Batch.xml                M org.sample.App
src/main/resources/sql/batch/settings.xml             XML
src/main/resources/log-setup.xml                      XML
src/main/resources/classic/Old.xml                    SQLMAP
`;

const NORTH_SOUTH = `
pom.xml                                          1
src/main/java/net/demo/north/NorthDao.java       6
src/main/java/net/demo/south/SouthDao.java       9
src/main/resources/mapper/north/NorthDao.xml     M net.demo.north.NorthDao
src/main/resources/mapper/south/SouthDao.xml     M net.demo.south.SouthDao
src/main/resources/mapper/loose/LooseMapper.xml  M none.Loose
`;

const BILLING_CATALOG = `
pom.xml                                                  1
billing/pom.xml                                          1
billing/src/main/java/org/sample/billing/Bill.java       8
billing/src/main/java/org/sample/billing/tax/Tax.java    3
catalog/pom.xml                                          1
catalog/src/main/java/org/sample/catalog/Cat.java        6
catalog/src/main/java/org/sample/catalog/view/View.java  2
tools[old]/Gen.java                                      1
`;

const SIX_MODULES = `
pom.xml                                                       1
apps/billing/pom.xml                                          1
apps/billing/src/main/java/org/sample/billing/Bill.java       12
apps/catalog/pom.xml                                          1
apps/catalog/src/main/java/org/sample/catalog/Cat.java        3
apps/catalog/src/main/java/org/sample/catalog/view/View.java  2
libs/base/pom.xml                                             1
libs/base/src/main/java/org/sample/base/Util.java             1
libs/text/build.gradle                                        1
libs/text/src/main/kotlin/org/sample/text/Text.kt             4
ship/pom.xml                                                  1
ship/src/main/java/org/sample/ship/Ship.java                  9
ship/scripts/deep/Run.java                                    2
ship/track/pom.xml                                            1
ship/track/src/main/java/org/sample/track/Track.java          5
tools/Lint.java                                               6
`;
const SIX_MODULES_LIST = ["apps/billing", "apps/catalog", "libs/base", "libs/text", "ship", "ship/track"];
const SIX_MODULES_WATCH = [...LANGUAGE_ROOTS_WATCH, "ship/scripts/deep/Run.java", "tools/Lint.java"];

const ROOT_AND_THREE = `
pom.xml                                      1
Bootstrap.java                               1
src/main/java/org/sample/root/Main.java      7
alpha/pom.xml                                1
alpha/src/main/java/org/sample/alpha/A.java  2
beta/pom.xml                                 1
beta/src/main/java/org/sample/beta/B.java    3
gamma/pom.xml                                1
gamma/src/main/java/org/sample/gamma/G.java  4
`;

const SVC = `
pom.xml                                                   1
svc/notify/pom.xml                                        1
svc/notify/src/main/java/net/demo/notify/Notify.java      1
svc/cargo/pom.xml                                         1
svc/cargo/src/main/java/net/demo/cargo/CargoDao.java      20
svc/cargo/src/main/java/net/demo/cargo/CargoItem.java     5
svc/cargo/src/main/resources/mapper/CargoDao.xml          M net.demo.cargo.CargoDao
svc/cargo/src/main/resources/mapper/CargoItem.xml         M nope.X
svc/cargo/src/main/resources/mapper/Extra.xml             M nope.Y
svc/cargo/src/main/resources/target/mapper/GenMapper.xml  M nope.Z
svc/toll/pom.xml                                          1
svc/toll/src/main/java/net/demo/toll/Toll.java            2
svc/toll/src/main/resources/mapper/TollMapper.xml         M net.demo.toll.Toll
svc/report/pom.xml                                        1
svc/report/src/main/resources/mapper/ReportMapper.xml     M r.Report
out/src/main/java/net/demo/Gen.java                       3
`;
const SVC_MODULES = ["svc/cargo", "svc/notify", "svc/report", "svc/toll"];
const SVC_WATCH = [
  ...LANGUAGE_ROOTS_WATCH,
  "out/src/main/java/net/demo/Gen.java",
  "svc/cargo/src/main/resources/**/*Mapper.xml",
  "svc/cargo/src/main/resources/**/mapper/**/*.xml",
  "svc/report/src/main/resources/**/*Mapper.xml",
  "svc/report/src/main/resources/**/mapper/**/*.xml",
  "svc/toll/src/main/resources/**/*Mapper.xml",
  "svc/toll/src/main/resources/**/mapper/**/*.xml",
];
const SVC_MAPPERS = {
  namespace: 2,
  fileName: 1,
  rest: 3,
  restFiles: [
    "svc/cargo/src/main/resources/mapper/Extra.xml",
    "svc/cargo/src/main/resources/target/mapper/GenMapper.xml",
    "svc/report/src/main/resources/mapper/ReportMapper.xml",
  ],
};

const kiosk = (path: string) => `src/main/java/org/sample/kiosk/${path}`;
const res = (path: string) => `src/main/resources/${path}`;

const CASES: Case[] = [
  // ---- repositories without modules ----
  {
    name: "only files at the repository root make one part",
    tree: ONE_JS,
    languages: ["js"],
    languageSource: "detected",
    parts: [["top", ["cli.mjs", "index.ts"], null, 2, 5]],
    total: [2, 5],
    config: { languages: ["js"] },
  },
  ...([
    [[], [
      ["app", ["app/**"], "app", 1, 5],
      ["app-core", ["app/core/**"], "app", 1, 3],
      ["app-core-deep", ["app/core/deep/**"], "app", 1, 2],
      ["web", ["web/**"], "web", 1, 4],
    ]],
    [["--max-parts", "3"], [
      ["app", ["app/**"], "app", 1, 5],
      ["app-core", ["app/core/**"], "app", 2, 5],
      ["web", ["web/**"], "web", 1, 4],
    ]],
    [["--max-parts", "2"], [
      ["app", ["app/**"], "app", 3, 10],
      ["web", ["web/**"], "web", 1, 4],
    ]],
    [["--max-parts", "1"], [["top", ["**"], null, 4, 14]]],
    [["--max-parts", "02"], [
      ["app", ["app/**"], "app", 3, 10],
      ["web", ["web/**"], "web", 1, 4],
    ]],
  ] as [string[], Row[]][]).map(([args, parts]): Case => ({
    name: `the start depth follows the maximum (${args.join(" ") || "default"})`,
    tree: APP_WEB,
    args,
    languages: ["js"],
    languageSource: "default",
    parts,
    total: [4, 14],
    config: { languages: ["js"] },
  })),
  {
    name: "a part for files at the root counts toward the start depth",
    tree: "main.ts 1\nlib/a.ts 2\nlib/sub/b.ts 3",
    args: ["--max-parts", "2"],
    languages: ["js"],
    languageSource: "default",
    parts: [
      ["top", ["main.ts"], null, 1, 1],
      ["lib", ["lib/**"], "lib", 2, 5],
    ],
    total: [3, 6],
    config: { languages: ["js"] },
  },
  {
    name: "without files at the root the next depth fits",
    tree: "lib/a.ts 2\nlib/sub/b.ts 3",
    args: ["--max-parts", "2"],
    languages: ["js"],
    languageSource: "default",
    parts: [
      ["lib", ["lib/**"], "lib", 1, 2],
      ["lib-sub", ["lib/sub/**"], "lib", 1, 3],
    ],
    total: [2, 5],
    config: { languages: ["js"] },
  },
  {
    name: "single-child directories are followed down",
    tree: "tools/gen/run.ts 3\ntools/gen/lib/util.ts 1",
    languages: ["js"],
    languageSource: "default",
    parts: [
      ["tools-gen", ["tools/gen/**"], "tools", 1, 3],
      ["tools-gen-lib", ["tools/gen/lib/**"], "tools", 1, 1],
    ],
    total: [2, 4],
    config: { languages: ["js"] },
  },
  {
    name: "fewest lines fold first, then path order",
    tree: "alpha/x.ts 3\nbeta/x.ts 1\ngamma/x.ts 2\ndelta/x.ts 2",
    args: ["--max-parts", "3"],
    languages: ["js"],
    languageSource: "default",
    parts: [
      ["top", ["**"], null, 2, 3],
      ["alpha", ["alpha/**"], "alpha", 1, 3],
      ["gamma", ["gamma/**"], "gamma", 1, 2],
    ],
    total: [4, 8],
    config: { languages: ["js"] },
  },
  {
    name: "glob characters in directory names are written as one-character sets",
    tree: "lab[1]/a.ts 1\nodd*name/c.ts 3\nq?/d.ts 4\nx(y)/e.ts 5\n{gen}/b.ts 2",
    languages: ["js"],
    languageSource: "default",
    parts: [
      ["lab-1", ["lab[[]1]/**"], "lab[1]", 1, 1],
      ["odd-name", ["odd[*]name/**"], "odd*name", 1, 3],
      ["q", ["q[?]/**"], "q?", 1, 4],
      ["x-y", ["x(y)/**"], "x(y)", 1, 5],
      ["gen", ["[{]gen}/**"], "{gen}", 1, 2],
    ],
    total: [5, 15],
    config: { languages: ["js"] },
  },
  {
    name: "ids are normalized and repeats get a number in part order",
    tree: "main.ts 1\nWeb_Admin/a.ts 1\nweb-admin/b.ts 2\nweb.admin/c.ts 3\n_/d.ts 4",
    languages: ["js"],
    languageSource: "default",
    parts: [
      ["top", ["main.ts"], null, 1, 1],
      ["web-admin", ["Web_Admin/**"], "Web_Admin", 1, 1],
      ["top-2", ["_/**"], "_", 1, 4],
      ["web-admin-2", ["web-admin/**"], "web-admin", 1, 2],
      ["web-admin-3", ["web.admin/**"], "web.admin", 1, 3],
    ],
    total: [5, 11],
    config: { languages: ["js"] },
  },
  ...([
    [undefined, [
      ["top", ["vite.config.ts"], null, 1, 1],
      ["src", ["src/**"], "src", 1, 2],
    ], [2, 3]],
    [{ tests: true }, [
      ["top", ["vite.config.ts"], null, 1, 1],
      ["src", ["src/**"], "src", 2, 3],
      ["src-tests", ["src/__tests__/**"], "src", 1, 1],
    ], [4, 5]],
  ] as [Record<string, unknown> | undefined, Row[], [number, number]][]).map(
    ([existing, parts, total]): Case => ({
      name: `non-code, dependencies, build output, dot names and tests are left out (${existing ? "tests on" : "no config"})`,
      tree: `
        vite.config.ts          1
        src/entry.ts            2
        src/entry.test.ts       1
        src/__tests__/probe.ts  1
        src/README.md           1
        src/theme.scss          1
        src/.hidden.ts          1
        .storybook/main.ts      1
        node_modules/x/i.js     1
        dist/bundle.js          1
        coverage/c.js           1`,
      existing,
      languages: ["js"],
      languageSource: "default",
      parts,
      total,
      config: { languages: ["js"] },
    }),
  ),
  {
    name: "a js repository without code has no parts",
    tree: "package.json 1\nREADME.md 2",
    languages: ["js"],
    languageSource: "detected",
    parts: [],
    total: [0, 0],
    config: { languages: ["js"] },
  },
  {
    name: "a java module with an empty source root has no parts and no watch",
    tree: "pom.xml 1\nsrc/main/java/ DIR",
    languages: ["java"],
    languageSource: "detected",
    parts: [],
    total: [0, 0],
    config: { languages: ["java"] },
  },

  // ---- where languages and roots come from ----
  {
    name: "a language on the command line wins over detection (js)",
    tree: "package.json 1\npom.xml 1\nsrc/main/java/org/sample/App.java 3\nweb/app.ts 2",
    args: ["--language", "js"],
    languages: ["js"],
    languageSource: "command line",
    parts: [["web", ["web/**"], "web", 1, 2]],
    total: [1, 2],
    config: { languages: ["js"] },
  },
  {
    name: "a language on the command line wins over detection (java)",
    tree: "package.json 1\npom.xml 1\nsrc/main/java/org/sample/App.java 3\nweb/app.ts 2",
    args: ["--language", "java"],
    languages: ["java"],
    languageSource: "command line",
    parts: [["sample", ["src/main/java/org/sample/App.java"], null, 1, 3]],
    total: [1, 3],
    config: { languages: ["java"], watch: JAVA_WATCH },
  },
  ...([
    ["detected", "package.json 1\n" + BOTH_LANGUAGES, []],
    ["command line", BOTH_LANGUAGES, ["--language", "java", "--language", "js"]],
    ["command line", BOTH_LANGUAGES, ["--language", "js", "--language", "java"]],
  ] as [string, string, string[]][]).map(([languageSource, text, args]): Case => ({
    name: `java and js together (${args.join(" ") || "two detection files"})`,
    tree: text,
    args,
    languages: ["java", "js"],
    languageSource,
    parts: [
      ["sample", ["src/main/java/org/sample/App.java"], null, 1, 2],
      ["test", ["src/main/java/org/sample/test/**"], null, 1, 3],
      ["ui", ["src/main/java/org/sample/ui/**"], null, 1, 1],
      ["web", ["web/**"], null, 1, 4],
    ],
    total: [4, 10],
    config: {
      languages: ["java", "js"],
      watch: [...BOTH_EXTENSIONS.map((e) => `src/main/java/**/*.${e}`), "web/app.ts"],
    },
    notes: { "exact-paths": { files: 1 } },
  })),
  {
    name: "an existing config gives languages, home, skip and roots, but not watch",
    tree: `
      package.json                             1
      pom.xml                                  1
      src/main/java/org/sample/App.java        2
      src/main/java/org/sample/core/Core.java  4
      src/main/java/org/sample/gen/Gen.java    5
      plan/Sketch.java                         1
      web/app.ts                               3`,
    existing: {
      languages: ["java"],
      home: "plan",
      page: "plan/view.html",
      skip: ["src/main/java/org/sample/gen/**"],
      tests: false,
      watch: ["src/main/java/org/sample/App.java"],
      roots: ["src/main/java"],
    },
    languages: ["java"],
    languageSource: "codeplan.json",
    rootSource: "codeplan.json",
    parts: [
      ["sample", ["src/main/java/org/sample/App.java"], null, 1, 2],
      ["core", ["src/main/java/org/sample/core/**"], null, 1, 4],
    ],
    total: [2, 6],
    config: { languages: ["java"], watch: JAVA_WATCH, roots: ["src/main/java"] },
  },
  {
    name: "roots from the command line, other code, and a resources-only directory",
    tree: `
      pom.xml                                          1
      core/src/main/java/org/sample/A.java             2
      extra/gen/B.java                                 3
      tools/C.java                                     1
      report/pom.xml                                   1
      report/src/main/resources/mapper/NoteMapper.xml  M n.Note`,
    args: ["--root", "extra/gen", "--root", "core/src/main/java"],
    languages: ["java"],
    languageSource: "detected",
    rootSource: "command line",
    modules: ["core", "extra/gen"],
    parts: [
      ["core", ["core/src/main/java/org/sample/A.java"], "core", 1, 2],
      ["extra-gen", ["extra/gen/B.java"], "extra/gen", 1, 3],
      ["report-src-main-resources-mapper", ["report/src/main/resources/mapper/**"], null, 1, 3],
      ["tools", ["tools/**"], null, 1, 1],
    ],
    total: [4, 9],
    config: {
      languages: ["java"],
      watch: [
        "core/src/main/java/**/*.java",
        "core/src/main/java/**/*.kt",
        "extra/gen/**/*.java",
        "extra/gen/**/*.kt",
        "report/src/main/resources/mapper/NoteMapper.xml",
        "tools/C.java",
      ],
      roots: ["core/src/main/java", "extra/gen"],
    },
    notes: { "exact-paths": { files: 2 } },
  },

  // ---- one module ----
  {
    name: "a part for each package under the common package",
    tree: KIOSK,
    languages: ["java"],
    languageSource: "detected",
    parts: [
      ["kiosk", [kiosk("App.java")], null, 1, 6],
      ["ticket", [kiosk("ticket/**")], null, 2, 50],
      ["ticket-api", [kiosk("ticket/api/**")], null, 1, 12],
      ["till", [kiosk("till/**")], null, 1, 15],
      ["till-gateway", [kiosk("till/gateway/**")], null, 1, 9],
      ["user", [kiosk("user/**")], null, 1, 4],
      ["user-role", [kiosk("user/role/**")], null, 1, 3],
    ],
    total: [8, 99],
    config: { languages: ["java"], watch: JAVA_WATCH },
  },
  {
    name: "with a maximum of four the module starts at depth one",
    tree: KIOSK,
    args: ["--max-parts", "4"],
    languages: ["java"],
    languageSource: "detected",
    parts: [
      ["kiosk", [kiosk("App.java")], null, 1, 6],
      ["ticket", [kiosk("ticket/**")], null, 3, 62],
      ["till", [kiosk("till/**")], null, 2, 24],
      ["user", [kiosk("user/**")], null, 2, 7],
    ],
    total: [8, 99],
    config: { languages: ["java"], watch: JAVA_WATCH },
  },
  {
    name: "a small package folds into the common package part",
    tree: KIOSK,
    args: ["--max-parts", "3"],
    languages: ["java"],
    languageSource: "detected",
    parts: [
      ["kiosk", [kiosk("**")], null, 3, 13],
      ["ticket", [kiosk("ticket/**")], null, 3, 62],
      ["till", [kiosk("till/**")], null, 2, 24],
    ],
    total: [8, 99],
    config: { languages: ["java"], watch: JAVA_WATCH },
  },
  {
    name: "a maximum of one leaves the common package part",
    tree: KIOSK,
    args: ["--max-parts", "1"],
    languages: ["java"],
    languageSource: "detected",
    parts: [["kiosk", [kiosk("**")], null, 8, 99]],
    total: [8, 99],
    config: { languages: ["java"], watch: JAVA_WATCH },
  },
  {
    name: "a maximum of one with a file outside the module folds all into the whole-repository part",
    tree: KIOSK + "scripts/Gen.java 2",
    args: ["--max-parts", "1"],
    languages: ["java"],
    languageSource: "detected",
    parts: [["top", ["**"], null, 9, 101]],
    total: [9, 101],
    config: { languages: ["java"], watch: ["scripts/Gen.java", ...JAVA_WATCH] },
    notes: { "exact-paths": { files: 1 } },
  },
  {
    name: "package-info.java stops the common package",
    tree: `
      pom.xml                                     1
      src/main/java/org/sample/package-info.java  1
      src/main/java/org/sample/core/lib/A.java    4
      src/main/java/org/sample/core/lib/B.java    5`,
    languages: ["java"],
    languageSource: "detected",
    parts: [
      ["sample", ["src/main/java/org/sample/package-info.java"], null, 1, 1],
      ["core-lib", ["src/main/java/org/sample/core/lib/**"], null, 2, 9],
    ],
    total: [3, 10],
    config: { languages: ["java"], watch: JAVA_WATCH },
  },
  {
    name: "files all in the common package make one part of exact paths",
    tree: `
      pom.xml                                   1
      src/main/java/org/sample/core/lib/A.java  4
      src/main/java/org/sample/core/lib/B.java  5`,
    languages: ["java"],
    languageSource: "detected",
    parts: [[
      "lib",
      ["src/main/java/org/sample/core/lib/A.java", "src/main/java/org/sample/core/lib/B.java"],
      null, 2, 9,
    ]],
    total: [2, 9],
    config: { languages: ["java"], watch: JAVA_WATCH },
  },
  ...([
    [[], [
      ["billing", ["src/main/java/net/demo/billing/**"], null, 1, 11],
      ["invoice", ["src/main/java/net/demo/invoice/**"], null, 1, 2],
      ["report", ["src/main/java/net/demo/report/**"], null, 1, 6],
    ]],
    [["--max-parts", "2"], [
      ["demo", ["src/main/java/net/demo/**"], null, 2, 8],
      ["billing", ["src/main/java/net/demo/billing/**"], null, 1, 11],
    ]],
  ] as [string[], Row[]][]).map(([args, parts]): Case => ({
    name: `a common package part exists only with files or after receiving (${args.join(" ") || "default"})`,
    tree: `
      pom.xml                                   1
      src/main/java/net/demo/billing/Bill.java  11
      src/main/java/net/demo/invoice/Inv.java   2
      src/main/java/net/demo/report/Rep.java    6`,
    args,
    languages: ["java"],
    languageSource: "detected",
    parts,
    total: [3, 19],
    config: { languages: ["java"], watch: JAVA_WATCH },
  })),
  {
    name: "equal lines fold the deeper part first, into a covering ancestor",
    tree: `
      pom.xml                                     1
      src/main/java/net/demo/Main.java            10
      src/main/java/net/demo/cart/Cart.java       8
      src/main/java/net/demo/cart/item/Item.java  3
      src/main/java/net/demo/stock/Stock.java     3
      tools/lint/Lint.java                        7
      tools/lint/rules/core/Rule.java             2
      tools/lint/rules/extra/Extra.java           4`,
    args: ["--max-parts", "4"],
    languages: ["java"],
    languageSource: "detected",
    parts: [
      ["demo", ["src/main/java/net/demo/**"], null, 2, 13],
      ["cart", ["src/main/java/net/demo/cart/**"], null, 2, 11],
      ["tools-lint", ["tools/lint/**"], null, 2, 9],
      ["tools-lint-rules-extra", ["tools/lint/rules/extra/**"], null, 1, 4],
    ],
    total: [7, 37],
    config: {
      languages: ["java"],
      watch: [
        ...JAVA_WATCH,
        "tools/lint/Lint.java",
        "tools/lint/rules/core/Rule.java",
        "tools/lint/rules/extra/Extra.java",
      ],
    },
    notes: { "exact-paths": { files: 3 } },
  },
  ...([
    [1, [
      ["sample", ["src/main/java/org/sample/**"], null, 3, 12],
      ["beta-y", ["src/main/java/org/sample/beta/y/**"], null, 1, 8],
      ["gamma", ["src/main/java/org/sample/gamma/**"], null, 1, 9],
      ["gen", ["gen/**"], null, 1, 20],
      ["ops", ["ops/**"], null, 1, 30],
    ], [7, 79]],
    [10, [
      ["sample", ["src/main/java/org/sample/**"], null, 3, 19],
      ["alpha", ["src/main/java/org/sample/alpha/**"], null, 1, 10],
      ["gamma", ["src/main/java/org/sample/gamma/**"], null, 1, 9],
      ["gen", ["gen/**"], null, 1, 20],
      ["ops", ["ops/**"], null, 1, 30],
    ], [7, 88]],
  ] as [number, Row[], [number, number]][]).map(([alphaLines, parts, total]): Case => ({
    name: `the common package part covers deeper parts only after it receives (alpha ${alphaLines} lines)`,
    tree: `
      build.gradle                            1
      src/main/java/org/sample/Boot.java      9
      src/main/java/org/sample/alpha/A.java   ${alphaLines}
      src/main/java/org/sample/beta/x/X.java  2
      src/main/java/org/sample/beta/y/Y.java  8
      src/main/java/org/sample/gamma/G.java   9
      gen/One.java                            20
      ops/Two.java                            30`,
    args: ["--max-parts", "5"],
    languages: ["java"],
    languageSource: "detected",
    parts,
    total,
    config: { languages: ["java"], watch: ["gen/One.java", "ops/Two.java", ...JAVA_WATCH] },
    notes: { "exact-paths": { files: 2 } },
  })),
  {
    name: "a module whose sources are all Kotlin, built with build.gradle.kts",
    tree: `
      build.gradle.kts                         1
      src/main/kotlin/net/demo/App.kt          4
      src/main/kotlin/net/demo/route/Route.kt  6`,
    languages: ["java"],
    languageSource: "detected",
    parts: [
      ["demo", ["src/main/kotlin/net/demo/App.kt"], null, 1, 4],
      ["route", ["src/main/kotlin/net/demo/route/**"], null, 1, 6],
    ],
    total: [2, 10],
    config: { languages: ["java"], watch: ["src/main/kotlin/**/*.java", "src/main/kotlin/**/*.kt"] },
  },
  {
    name: "the same package in the Java and Kotlin roots is one part",
    tree: `
      pom.xml                                    1
      src/main/java/org/sample/Base.java         3
      src/main/java/org/sample/news/News.java    5
      src/main/kotlin/org/sample/news/NewsKt.kt  6
      src/main/kotlin/org/sample/relay/Relay.kt  8`,
    languages: ["java"],
    languageSource: "detected",
    parts: [
      ["sample", ["src/main/java/org/sample/Base.java"], null, 1, 3],
      ["news", ["src/main/java/org/sample/news/**", "src/main/kotlin/org/sample/news/**"], null, 2, 11],
      ["relay", ["src/main/kotlin/org/sample/relay/**"], null, 1, 8],
    ],
    total: [4, 22],
    config: {
      languages: ["java"],
      watch: [...JAVA_WATCH, "src/main/kotlin/**/*.java", "src/main/kotlin/**/*.kt"],
    },
  },
  {
    name: "a part in the Java root receives a package found only in the Kotlin root",
    tree: `
      pom.xml                                     1
      src/main/java/org/sample/Main.java          9
      src/main/java/org/sample/feed/Feed.java     5
      src/main/kotlin/org/sample/feed/ext/Ext.kt  2
      src/main/java/org/sample/sync/Sync.java     6
      ops/Run.java                                7`,
    args: ["--max-parts", "4"],
    languages: ["java"],
    languageSource: "detected",
    parts: [
      ["sample", ["src/main/java/org/sample/Main.java"], null, 1, 9],
      ["feed", ["src/main/java/org/sample/feed/**", "src/main/kotlin/org/sample/feed/**"], null, 2, 7],
      ["sync", ["src/main/java/org/sample/sync/**"], null, 1, 6],
      ["ops", ["ops/**"], null, 1, 7],
    ],
    total: [5, 29],
    config: {
      languages: ["java"],
      watch: ["ops/Run.java", ...JAVA_WATCH, "src/main/kotlin/**/*.java", "src/main/kotlin/**/*.kt"],
    },
    notes: { "exact-paths": { files: 1 } },
  },
  {
    name: "the layer note counts directory names below the common package (exactly half)",
    tree: `
      pom.xml                                                    1
      src/main/java/org/sample/App.java                          2
      src/main/java/org/sample/controller/TicketController.java  3
      src/main/java/org/sample/service/TicketService.java        4
      src/main/java/org/sample/repository/TicketRepo.java        5
      src/main/java/org/sample/util/ServiceHelper.java           1
      src/main/java/org/sample/util/Dates.java                   1
      src/main/java/org/sample/web/dto/TicketDto.java            2
      src/main/java/org/sample/model2/X.java                     1`,
    languages: ["java"],
    languageSource: "detected",
    parts: [
      ["sample", ["src/main/java/org/sample/App.java"], null, 1, 2],
      ["controller", ["src/main/java/org/sample/controller/**"], null, 1, 3],
      ["model2", ["src/main/java/org/sample/model2/**"], null, 1, 1],
      ["repository", ["src/main/java/org/sample/repository/**"], null, 1, 5],
      ["service", ["src/main/java/org/sample/service/**"], null, 1, 4],
      ["util", ["src/main/java/org/sample/util/**"], null, 2, 2],
      ["web-dto", ["src/main/java/org/sample/web/dto/**"], null, 1, 2],
    ],
    total: [8, 19],
    config: { languages: ["java"], watch: JAVA_WATCH },
    notes: { layers: { layerFiles: 4, files: 8 } },
  },
  {
    name: "the layer note does not count names inside the common package",
    tree: `
      pom.xml                                1
      src/main/java/org/service/Main.java    1
      src/main/java/org/service/api/A.java   2
      src/main/java/org/service/core/B.java  3
      src/main/java/org/service/dao/D.java   1`,
    languages: ["java"],
    languageSource: "detected",
    parts: [
      ["service", ["src/main/java/org/service/Main.java"], null, 1, 1],
      ["api", ["src/main/java/org/service/api/**"], null, 1, 2],
      ["core", ["src/main/java/org/service/core/**"], null, 1, 3],
      ["dao", ["src/main/java/org/service/dao/**"], null, 1, 1],
    ],
    total: [4, 7],
    config: { languages: ["java"], watch: JAVA_WATCH },
  },
  ...([
    [{ tests: true }, [
      ["sample", ["src/main/java/org/sample/App.java"], null, 1, 3],
      ["build", ["src/test/java/org/sample/build/**"], null, 1, 1],
      ["core", ["src/main/java/org/sample/core/**", "src/test/java/org/sample/core/**"], null, 2, 9],
      ["it", ["src/test/kotlin/org/sample/it/**"], null, 1, 5],
    ], [5, 18], [
      ...JAVA_WATCH,
      "src/test/java/**/*.java", "src/test/java/**/*.kt",
      "src/test/kotlin/**/*.java", "src/test/kotlin/**/*.kt",
    ]],
    [undefined, [
      ["sample", ["src/main/java/org/sample/App.java"], null, 1, 3],
      ["core", ["src/main/java/org/sample/core/**"], null, 1, 6],
    ], [2, 9], JAVA_WATCH],
  ] as [Record<string, unknown> | undefined, Row[], [number, number], string[]][]).map(
    ([existing, parts, total, watch]): Case => ({
      name: `test source roots are module source roots only with tests on (${existing ? "on" : "off"})`,
      tree: `
        pom.xml                                        1
        src/main/java/org/sample/App.java              3
        src/main/java/org/sample/core/Core.java        6
        src/test/java/org/sample/core/CoreTest.java    3
        src/test/kotlin/org/sample/it/FlowIT.kt        5
        src/test/java/org/sample/build/BuildTest.java  1`,
      existing,
      languages: ["java"],
      languageSource: "detected",
      parts,
      total,
      config: { languages: ["java"], watch },
    }),
  ),
  {
    name: "under a source root, a package called build is counted like any other",
    tree: `
      pom.xml                                   1
      src/main/java/org/sample/App.java         2
      src/main/java/org/sample/build/Step.java  3
      src/main/java/org/sample/target/Aim.java  4
      build/classes/Gen.java                    1
      out/Tmp.java                              1`,
    languages: ["java"],
    languageSource: "detected",
    parts: [
      ["sample", ["src/main/java/org/sample/App.java"], null, 1, 2],
      ["build", ["src/main/java/org/sample/build/**"], null, 1, 3],
      ["target", ["src/main/java/org/sample/target/**"], null, 1, 4],
    ],
    total: [3, 9],
    config: { languages: ["java"], watch: JAVA_WATCH },
  },
  {
    name: "java code with no module is all outside modules",
    tree: `
      pom.xml                                        1
      vintage/src/main/java/org/sample/A.java        4
      vintage/src/main/resources/mapper/AMapper.xml  M org.sample.A
      scripts/Bench.java                             3
      scripts/Run.kt                                 1`,
    languages: ["java"],
    languageSource: "detected",
    modules: [],
    parts: [
      ["scripts", ["scripts/**"], "scripts", 2, 4],
      ["vintage-src-main-java-org-sample", ["vintage/src/main/java/org/sample/**"], "vintage", 1, 4],
      ["vintage-src-main-resources-mapper", ["vintage/src/main/resources/mapper/**"], "vintage", 1, 3],
    ],
    total: [4, 11],
    config: {
      languages: ["java"],
      watch: [
        "scripts/Bench.java",
        "scripts/Run.kt",
        "vintage/src/main/java/org/sample/A.java",
        "vintage/src/main/resources/mapper/AMapper.xml",
      ],
    },
    notes: { "exact-paths": { files: 4 } },
  },
  {
    name: "the root module's common package part is numbered after the whole-repository part",
    tree: `
      build.gradle                     1
      Launcher.java                    1
      src/main/java/Main.java          3
      src/main/java/util/Strings.java  2`,
    languages: ["java"],
    languageSource: "detected",
    parts: [
      ["top", ["Launcher.java"], null, 1, 1],
      ["top-2", ["src/main/java/Main.java"], null, 1, 3],
      ["util", ["src/main/java/util/**"], null, 1, 2],
    ],
    total: [3, 6],
    config: { languages: ["java"], watch: ["Launcher.java", ...JAVA_WATCH] },
    notes: { "exact-paths": { files: 1 } },
  },

  // ---- mapper XML in one module ----
  {
    name: "mapper rules, directory patterns, mappers outside the patterns and other XML",
    tree: CARGO_TOLL,
    languages: ["java"],
    languageSource: "detected",
    parts: [
      ["sample", [
        "src/main/java/org/sample/App.java",
        res("**/*Mapper.xml"),
        res("**/mapper/**/*.xml"),
        res("RootMapper.xml"),
        res("mapper/extra/*.xml"),
        res("sql/batch/*.xml"),
      ], null, 4, 14],
      ["cargo", ["src/main/java/org/sample/cargo/**", res("mapper/cargo/*.xml")], null, 5, 23],
      ["toll", [
        "src/main/java/org/sample/toll/**",
        res("TollMapper.xml"),
        res("org/sample/toll/*.xml"),
        res("sql/toll/*.xml"),
      ], null, 4, 17],
    ],
    total: [13, 54],
    config: {
      languages: ["java"],
      watch: [
        ...JAVA_WATCH,
        res("**/*Mapper.xml"),
        res("**/mapper/**/*.xml"),
        res("sql/batch/Batch.xml"),
        res("sql/toll/*.xml"),
      ],
    },
    mappers: {
      namespace: 4, fileName: 1, package: 1, rest: 3, outsidePattern: 2,
      restFiles: [res("RootMapper.xml"), res("mapper/cargo/Spare.xml"), res("mapper/extra/TrailMapper.xml")],
    },
  },
  {
    name: "a maximum of one puts every mapper in the whole-repository part",
    tree: CARGO_TOLL + "tools/Seed.java 2",
    args: ["--max-parts", "1"],
    languages: ["java"],
    languageSource: "detected",
    parts: [["top", ["**"], null, 14, 56]],
    total: [14, 56],
    config: {
      languages: ["java"],
      watch: [
        ...JAVA_WATCH,
        res("**/*Mapper.xml"),
        res("**/mapper/**/*.xml"),
        res("sql/batch/Batch.xml"),
        res("sql/toll/*.xml"),
        "tools/Seed.java",
      ],
    },
    mappers: {
      namespace: 4, fileName: 1, package: 0, rest: 4, outsidePattern: 2,
      restFiles: [
        res("RootMapper.xml"),
        res("mapper/cargo/Spare.xml"),
        res("mapper/extra/TrailMapper.xml"),
        res("org/sample/toll/TollSqlMapper.xml"),
      ],
    },
    notes: { "exact-paths": { files: 1 } },
  },
  ...([
    ["equal counts pick more code lines", NORTH_SOUTH, [
      ["north", ["src/main/java/net/demo/north/**", res("mapper/north/*.xml")], null, 2, 9],
      ["south", [
        "src/main/java/net/demo/south/**",
        res("**/*Mapper.xml"),
        res("**/mapper/**/*.xml"),
        res("mapper/loose/*.xml"),
        res("mapper/south/*.xml"),
      ], null, 3, 15],
    ], [5, 24], 2],
    ["the most taken XML wins", NORTH_SOUTH + "src/main/resources/mapper/north/North2.xml M net.demo.north.NorthDao", [
      ["north", [
        "src/main/java/net/demo/north/**",
        res("**/*Mapper.xml"),
        res("**/mapper/**/*.xml"),
        res("mapper/loose/*.xml"),
        res("mapper/north/*.xml"),
      ], null, 4, 15],
      ["south", ["src/main/java/net/demo/south/**", res("mapper/south/*.xml")], null, 2, 12],
    ], [6, 27], 3],
    ["no taken XML picks the most code lines", `
      pom.xml                                          1
      src/main/java/net/demo/north/NorthDao.java       6
      src/main/java/net/demo/south/SouthDao.java       10
      src/main/resources/mapper/loose/LooseMapper.xml  M none.Loose`, [
      ["north", ["src/main/java/net/demo/north/**"], null, 1, 6],
      ["south", [
        "src/main/java/net/demo/south/**",
        res("**/*Mapper.xml"),
        res("**/mapper/**/*.xml"),
        res("mapper/loose/*.xml"),
      ], null, 2, 13],
    ], [3, 19], 0],
  ] as [string, string, Row[], [number, number], number][]).map(
    ([what, text, parts, total, namespace]): Case => ({
      name: `the representative part without a common package part: ${what}`,
      tree: text,
      languages: ["java"],
      languageSource: "detected",
      parts,
      total,
      config: {
        languages: ["java"],
        watch: [...JAVA_WATCH, res("**/*Mapper.xml"), res("**/mapper/**/*.xml")],
      },
      mappers: { namespace, rest: 1, restFiles: [res("mapper/loose/LooseMapper.xml")] },
    }),
  ),
  {
    name: "parts share the XML of one directory, and the package rule takes the longest package",
    tree: `
      pom.xml                                                        1
      src/main/java/org/sample/Core.java                             2
      src/main/java/org/sample/item/Item.java                        7
      src/main/java/org/sample/item/price/Price.java                 5
      src/main/java/org/sample/stock/Stock.java                      4
      src/main/resources/mapper/shared/Item.xml                      M org.sample.item.Item
      src/main/resources/mapper/shared/Item2.xml                     M org.sample.item.Item
      src/main/resources/mapper/shared/Price.xml                     M org.sample.item.price.Price
      src/main/resources/mapper/shared/Stock.xml                     M org.sample.stock.Stock
      src/main/resources/mapper/shared/StockMore.xml                 M none.More
      src/main/resources/org/sample/item/price/deep/PriceMapper.xml  M none.Deep`,
    languages: ["java"],
    languageSource: "detected",
    parts: [
      ["sample", ["src/main/java/org/sample/Core.java", res("**/*Mapper.xml"), res("**/mapper/**/*.xml")], null, 1, 2],
      ["item", ["src/main/java/org/sample/item/**", res("mapper/shared/*.xml")], null, 4, 16],
      ["item-price", [
        "src/main/java/org/sample/item/price/**",
        res("mapper/shared/Price.xml"),
        res("org/sample/item/price/deep/*.xml"),
      ], null, 3, 11],
      ["stock", ["src/main/java/org/sample/stock/**", res("mapper/shared/Stock.xml")], null, 2, 7],
    ],
    total: [10, 36],
    config: {
      languages: ["java"],
      watch: [...JAVA_WATCH, res("**/*Mapper.xml"), res("**/mapper/**/*.xml")],
    },
    mappers: { namespace: 4, package: 1, rest: 1, restFiles: [res("mapper/shared/StockMore.xml")] },
  },

  // ---- several modules, no more than the maximum ----
  ...([
    [[], [
      ["billing", ["billing/src/main/java/org/sample/billing/Bill.java"], "billing", 1, 8],
      ["billing-tax", ["billing/src/main/java/org/sample/billing/tax/**"], "billing", 1, 3],
      ["catalog", ["catalog/src/main/java/org/sample/catalog/Cat.java"], "catalog", 1, 6],
      ["catalog-view", ["catalog/src/main/java/org/sample/catalog/view/**"], "catalog", 1, 2],
      ["tools-old", ["tools[[]old]/**"], null, 1, 1],
    ], {}],
    [["--max-parts", "2"], [
      ["top", ["tools[[]old]/**"], null, 1, 1],
      ["billing", ["billing/src/main/java/org/sample/billing/**"], "billing", 2, 11],
      ["catalog", ["catalog/src/main/java/org/sample/catalog/**"], "catalog", 2, 8],
    ], { "over-max-parts": { parts: 3, maxParts: 2 } }],
  ] as [string[], Row[], Record<string, Record<string, number>>][]).map(
    ([args, parts, notes]): Case => ({
      name: `parts do not cross module boundaries (${args.join(" ") || "default"})`,
      tree: BILLING_CATALOG,
      args,
      languages: ["java"],
      languageSource: "detected",
      modules: ["billing", "catalog"],
      parts,
      total: [5, 20],
      config: {
        languages: ["java"],
        watch: [
          "billing/src/main/java/**/*.java",
          "billing/src/main/java/**/*.kt",
          "catalog/src/main/java/**/*.java",
          "catalog/src/main/java/**/*.kt",
          "tools[[]old]/Gen.java",
        ],
      },
      notes: { "exact-paths": { files: 1 }, ...notes },
    }),
  ),
  {
    name: "three modules with mapper XML, one of them with mapper XML only",
    tree: `
      pom.xml                                                            1
      audit/pom.xml                                                      1
      audit/src/main/resources/mapper/LedgerMapper.xml                   M x.Ledger
      billing/pom.xml                                                    1
      billing/src/main/java/org/sample/billing/Bill.java                 8
      billing/src/main/java/org/sample/billing/tax/Tax.java              3
      billing/src/main/resources/mapper/BillMapper.xml                   M org.sample.billing.Bill
      billing/src/main/resources/mapper/ForeignRef.xml                   M org.sample.catalog.Cat
      catalog/build.gradle                                               1
      catalog/src/main/kotlin/org/sample/catalog/Cat.kt                  6
      catalog/src/main/kotlin/org/sample/catalog/view/View.kt            2
      catalog/src/main/resources/org/sample/catalog/view/ViewMapper.xml  M none.View
      catalog/src/main/resources/Tax.xml                                 M q.T`,
    languages: ["java"],
    languageSource: "detected",
    modules: ["audit", "billing", "catalog"],
    parts: [
      ["audit", [
        "audit/src/main/resources/**/*Mapper.xml",
        "audit/src/main/resources/**/mapper/**/*.xml",
        "audit/src/main/resources/mapper/*.xml",
      ], "audit", 1, 3],
      ["billing", [
        "billing/src/main/java/org/sample/billing/Bill.java",
        "billing/src/main/resources/**/*Mapper.xml",
        "billing/src/main/resources/**/mapper/**/*.xml",
        "billing/src/main/resources/mapper/*.xml",
      ], "billing", 3, 14],
      ["billing-tax", ["billing/src/main/java/org/sample/billing/tax/**"], "billing", 1, 3],
      ["catalog", [
        "catalog/src/main/kotlin/org/sample/catalog/Cat.kt",
        "catalog/src/main/resources/**/*Mapper.xml",
        "catalog/src/main/resources/**/mapper/**/*.xml",
        "catalog/src/main/resources/Tax.xml",
      ], "catalog", 2, 9],
      ["catalog-view", [
        "catalog/src/main/kotlin/org/sample/catalog/view/**",
        "catalog/src/main/resources/org/sample/catalog/view/*.xml",
      ], "catalog", 2, 5],
    ],
    total: [9, 34],
    config: {
      languages: ["java"],
      watch: [
        "audit/src/main/resources/**/*Mapper.xml",
        "audit/src/main/resources/**/mapper/**/*.xml",
        "billing/src/main/java/**/*.java",
        "billing/src/main/java/**/*.kt",
        "billing/src/main/resources/**/*Mapper.xml",
        "billing/src/main/resources/**/mapper/**/*.xml",
        "catalog/src/main/kotlin/**/*.java",
        "catalog/src/main/kotlin/**/*.kt",
        "catalog/src/main/resources/**/*Mapper.xml",
        "catalog/src/main/resources/**/mapper/**/*.xml",
        "catalog/src/main/resources/*.xml",
      ],
    },
    mappers: {
      namespace: 1, package: 1, rest: 3, outsidePattern: 1,
      restFiles: [
        "audit/src/main/resources/mapper/LedgerMapper.xml",
        "billing/src/main/resources/mapper/ForeignRef.xml",
        "catalog/src/main/resources/Tax.xml",
      ],
    },
  },
  {
    name: "a module inside a module, and an id repeated by a directory part",
    tree: `
      pom.xml                                             1
      ship/pom.xml                                        1
      ship/src/main/java/net/demo/ship/Ship.java          5
      ship/notes/Note.java                                2
      ship/track/pom.xml                                  1
      ship/track/src/main/java/net/demo/track/Track.java  4
      ship_track/Old.java                                 1`,
    languages: ["java"],
    languageSource: "detected",
    modules: ["ship", "ship/track"],
    parts: [
      ["ship", ["ship/src/main/java/net/demo/ship/Ship.java"], "ship", 1, 5],
      ["ship-track", ["ship/track/src/main/java/net/demo/track/Track.java"], "ship/track", 1, 4],
      ["ship-notes", ["ship/notes/**"], null, 1, 2],
      ["ship-track-2", ["ship_track/**"], null, 1, 1],
    ],
    total: [4, 12],
    config: {
      languages: ["java"],
      watch: [
        "ship/notes/Note.java",
        "ship/src/main/java/**/*.java",
        "ship/src/main/java/**/*.kt",
        "ship/track/src/main/java/**/*.java",
        "ship/track/src/main/java/**/*.kt",
        "ship_track/Old.java",
      ],
    },
    notes: { "exact-paths": { files: 2 } },
  },
  {
    name: "a top-directory pattern of the whole-repository part covers what folds below it",
    tree: `
      pom.xml                                           1
      Setup.java                                        2
      core/pom.xml                                      1
      core/src/main/java/org/sample/core/Core.java      6
      ext/plug/pom.xml                                  1
      ext/plug/src/main/java/org/sample/plug/Plug.java  5
      ext/misc/Helper.java                              1
      ext/tools/gen/Gen.java                            4`,
    args: ["--max-parts", "3"],
    languages: ["java"],
    languageSource: "detected",
    modules: ["core", "ext/plug"],
    parts: [
      ["top", ["Setup.java", "ext/**"], null, 3, 7],
      ["core", ["core/src/main/java/org/sample/core/Core.java"], "core", 1, 6],
      ["ext-plug", ["ext/plug/src/main/java/org/sample/plug/Plug.java"], "ext/plug", 1, 5],
    ],
    total: [5, 18],
    config: {
      languages: ["java"],
      watch: [
        "Setup.java",
        "core/src/main/java/**/*.java",
        "core/src/main/java/**/*.kt",
        "ext/misc/Helper.java",
        "ext/plug/src/main/java/**/*.java",
        "ext/plug/src/main/java/**/*.kt",
        "ext/tools/gen/Gen.java",
      ],
    },
    notes: { "exact-paths": { files: 3 } },
  },
  {
    name: "module paths with [ and {",
    tree: `
      pom.xml                                       1
      kit[a]/pom.xml                                1
      kit[a]/src/main/java/org/sample/A.java        2
      kit[a]/src/main/resources/mapper/AMapper.xml  M org.sample.A
      kit{b}/pom.xml                                1
      kit{b}/src/main/java/org/sample/B.java        3`,
    languages: ["java"],
    languageSource: "detected",
    modules: ["kit[a]", "kit{b}"],
    parts: [
      ["kit-a", [
        "kit[[]a]/src/main/java/org/sample/A.java",
        "kit[[]a]/src/main/resources/**/*Mapper.xml",
        "kit[[]a]/src/main/resources/**/mapper/**/*.xml",
        "kit[[]a]/src/main/resources/mapper/*.xml",
      ], "kit[a]", 2, 5],
      ["kit-b", ["kit[{]b}/src/main/java/org/sample/B.java"], "kit{b}", 1, 3],
    ],
    total: [3, 8],
    config: {
      languages: ["java"],
      watch: [
        "kit[[]a]/src/main/java/**/*.java",
        "kit[[]a]/src/main/java/**/*.kt",
        "kit[[]a]/src/main/resources/**/*Mapper.xml",
        "kit[[]a]/src/main/resources/**/mapper/**/*.xml",
        "kit[{]b}/src/main/java/**/*.java",
        "kit[{]b}/src/main/java/**/*.kt",
      ],
    },
    mappers: { namespace: 1 },
  },

  // ---- more modules than the maximum ----
  {
    name: "six modules with a nested module and files under a module directory",
    tree: SIX_MODULES,
    args: ["--max-parts", "4"],
    languages: ["java"],
    languageSource: "detected",
    modules: SIX_MODULES_LIST,
    parts: [
      ["top", ["tools/**"], null, 1, 6],
      ["ship", ["ship/**"], "ship", 3, 16],
      ["apps", ["apps/**"], "apps", 3, 17],
      ["libs", ["libs/**"], "libs", 2, 5],
    ],
    total: [9, 44],
    config: { languages: ["java"], watch: SIX_MODULES_WATCH },
    notes: { modules: { modules: 6, notRemaining: 5 }, "exact-paths": { files: 2 } },
  },
  {
    name: "six modules with a maximum of one",
    tree: SIX_MODULES,
    args: ["--max-parts", "1"],
    languages: ["java"],
    languageSource: "detected",
    modules: SIX_MODULES_LIST,
    parts: [["top", ["**"], null, 9, 44]],
    total: [9, 44],
    config: { languages: ["java"], watch: SIX_MODULES_WATCH },
    notes: { modules: { modules: 6, notRemaining: 6 }, "exact-paths": { files: 2 } },
  },
  ...([
    ["2", {}],
    ["1", { "over-max-parts": { parts: 2, maxParts: 1 } }],
  ] as [string, Record<string, Record<string, number>>][]).map(([max, notes]): Case => ({
    name: `a root module with more modules than the maximum (${max})`,
    tree: ROOT_AND_THREE,
    args: ["--max-parts", max],
    languages: ["java"],
    languageSource: "detected",
    modules: [".", "alpha", "beta", "gamma"],
    parts: [
      ["top", ["**"], null, 4, 10],
      ["top-2", ["src/main/java/**"], "top", 1, 7],
    ],
    total: [5, 17],
    config: { languages: ["java"], watch: [...LANGUAGE_ROOTS_WATCH, "Bootstrap.java"] },
    notes: { modules: { modules: 4, notRemaining: 3 }, "exact-paths": { files: 1 }, ...notes },
  })),
  ...([
    ["3", [
      ["svc-cargo", [
        "svc/cargo/src/main/java/**",
        "svc/cargo/src/main/resources/**/*Mapper.xml",
        "svc/cargo/src/main/resources/**/mapper/**/*.xml",
        "svc/cargo/src/main/resources/mapper/*.xml",
        "svc/cargo/src/main/resources/target/mapper/*.xml",
      ], "svc", 6, 37],
      ["out-src-main-java-net-demo", ["out/src/main/java/net/demo/**"], "out", 1, 3],
      ["svc", ["svc/**"], "svc", 4, 9],
    ], 3],
    ["2", [
      ["out-src-main-java-net", ["out/src/main/java/net/**"], "out", 1, 3],
      ["svc", ["svc/**"], "svc", 10, 46],
    ], 4],
  ] as [string, Row[], number][]).map(([max, parts, notRemaining]): Case => ({
    name: `more modules than the maximum with mapper XML and files under build-output names (${max})`,
    tree: SVC,
    args: ["--max-parts", max],
    languages: ["java"],
    languageSource: "detected",
    modules: SVC_MODULES,
    parts,
    total: [11, 49],
    config: { languages: ["java"], watch: SVC_WATCH },
    mappers: SVC_MAPPERS,
    notes: {
      modules: { modules: 4, notRemaining },
      "exact-paths": { files: 1 },
      "build-output": { files: 2 },
    },
  })),
  {
    name: "the layer note with more modules than the maximum",
    tree: `
      pom.xml                                                          1
      api/pom.xml                                                      1
      api/src/main/java/org/sample/api/App.java                        1
      api/src/main/java/org/sample/api/controller/UserController.java  3
      core/pom.xml                                                     1
      core/src/main/java/org/sample/core/domain/User.java              6
      core/src/main/java/org/sample/core/service/UserService.java      4
      core/src/main/java/org/sample/core/util/Ids.java                 2
      core/src/main/kotlin/                                            DIR
      data/pom.xml                                                     1
      data/src/main/java/org/sample/data/dao/UserDao.java              5`,
    args: ["--max-parts", "2"],
    languages: ["java"],
    languageSource: "detected",
    modules: ["api", "core", "data"],
    parts: [
      ["top", ["**"], null, 3, 9],
      ["core", ["core/src/main/java/**"], "core", 3, 12],
    ],
    total: [6, 21],
    config: { languages: ["java"], watch: LANGUAGE_ROOTS_WATCH },
    notes: { layers: { layerFiles: 3, files: 6 }, modules: { modules: 3, notRemaining: 2 } },
  },

  // ---- small cases of settled details ----
  {
    name: "with equal code lines and nothing taken, the first id is the representative part",
    tree: `
      pom.xml                                          1
      src/main/java/net/demo/west/W.java               7
      src/main/java/net/demo/east/E.java               7
      src/main/resources/mapper/drift/DriftMapper.xml  M none.Drift`,
    languages: ["java"],
    languageSource: "detected",
    parts: [
      ["east", [
        "src/main/java/net/demo/east/**",
        res("**/*Mapper.xml"),
        res("**/mapper/**/*.xml"),
        res("mapper/drift/*.xml"),
      ], null, 2, 10],
      ["west", ["src/main/java/net/demo/west/**"], null, 1, 7],
    ],
    total: [3, 17],
    config: {
      languages: ["java"],
      watch: [...JAVA_WATCH, res("**/*Mapper.xml"), res("**/mapper/**/*.xml")],
    },
    mappers: { rest: 1, restFiles: [res("mapper/drift/DriftMapper.xml")] },
  },
  {
    name: "a module part without code folded into the whole-repository part makes it **",
    tree: `
      pom.xml                                             1
      audit/pom.xml                                       1
      audit/src/main/resources/mapper/LedgerMapper.xml    M x.Ledger
      billing/pom.xml                                     1
      billing/src/main/java/org/sample/billing/Bill.java  9
      tally/pom.xml                                       1
      tally/src/main/java/org/sample/tally/Tally.java     4`,
    args: ["--max-parts", "2"],
    languages: ["java"],
    languageSource: "detected",
    modules: ["audit", "billing", "tally"],
    parts: [
      ["top", ["**"], null, 2, 7],
      ["billing", ["billing/src/main/java/**"], "billing", 1, 9],
    ],
    total: [3, 16],
    config: {
      languages: ["java"],
      watch: [
        ...LANGUAGE_ROOTS_WATCH,
        "audit/src/main/resources/**/*Mapper.xml",
        "audit/src/main/resources/**/mapper/**/*.xml",
      ],
    },
    mappers: { rest: 1, restFiles: ["audit/src/main/resources/mapper/LedgerMapper.xml"] },
    notes: { modules: { modules: 3, notRemaining: 2 } },
  },
  {
    name: "a source root with no measured files gets no watch pattern",
    tree: `
      pom.xml                                    1
      src/main/java/org/sample/App.java          3
      src/main/kotlin/org/sample/gen/Skipped.kt  2`,
    existing: { skip: ["src/main/kotlin/**"] },
    languages: ["java"],
    languageSource: "detected",
    parts: [["sample", ["src/main/java/org/sample/App.java"], null, 1, 3]],
    total: [1, 3],
    config: { languages: ["java"], watch: JAVA_WATCH },
  },
  {
    name: "directories under build-output names are not modules",
    tree: `
      pom.xml                                      1
      src/main/java/org/sample/App.java            2
      build/gen/pom.xml                            1
      build/gen/src/main/java/org/sample/Gen.java  5
      target/tool/build.gradle                     1
      target/tool/src/main/java/T.java             1`,
    languages: ["java"],
    languageSource: "detected",
    parts: [["sample", ["src/main/java/org/sample/App.java"], null, 1, 2]],
    total: [1, 2],
    config: { languages: ["java"], watch: JAVA_WATCH },
  },
  {
    name: "a given source root is used even under a build-output name",
    tree: `
      pom.xml                                      1
      build/gen/src/main/java/org/sample/G.java    3
      build/gen/src/main/java/org/sample/x/H.java  2`,
    args: ["--root", "build/gen/src/main/java"],
    languages: ["java"],
    languageSource: "detected",
    rootSource: "command line",
    modules: ["build/gen"],
    parts: [
      ["sample", ["build/gen/src/main/java/org/sample/G.java"], null, 1, 3],
      ["x", ["build/gen/src/main/java/org/sample/x/**"], null, 1, 2],
    ],
    total: [2, 5],
    config: {
      languages: ["java"],
      watch: ["build/gen/src/main/java/**/*.java", "build/gen/src/main/java/**/*.kt"],
      roots: ["build/gen/src/main/java"],
    },
  },
  {
    name: "java and js with more modules than the maximum",
    tree: `
      package.json                                  1
      pom.xml                                       1
      alpha/pom.xml                                 1
      alpha/src/main/java/org/sample/alpha/A.java   3
      alpha/src/main/java/org/sample/alpha/view.ts  2
      beta/pom.xml                                  1
      beta/src/main/java/org/sample/beta/B.java     6
      gamma/pom.xml                                 1
      gamma/src/main/java/org/sample/gamma/G.java   7
      web/app.ts                                    4`,
    args: ["--max-parts", "2"],
    languages: ["java", "js"],
    languageSource: "detected",
    modules: ["alpha", "beta", "gamma"],
    parts: [
      ["top", ["**"], null, 4, 15],
      ["gamma", ["gamma/src/main/java/**"], "gamma", 1, 7],
    ],
    total: [5, 22],
    config: {
      languages: ["java", "js"],
      watch: [
        ...BOTH_EXTENSIONS.map((e) => `**/src/main/java/**/*.${e}`),
        ...BOTH_EXTENSIONS.map((e) => `**/src/main/kotlin/**/*.${e}`),
        "web/app.ts",
      ],
    },
    notes: { modules: { modules: 3, notRemaining: 2 }, "exact-paths": { files: 1 } },
  },
  {
    name: "the package rule looks only at parts with a package path",
    tree: `
      build.gradle                            1
      src/main/java/Main.java                 3
      src/main/java/util/Strings.java         2
      src/main/resources/misc/SeekMapper.xml  M none.Seek`,
    languages: ["java"],
    languageSource: "detected",
    parts: [
      ["top", ["src/main/java/Main.java", res("**/*Mapper.xml"), res("**/mapper/**/*.xml"), res("misc/*.xml")], null, 2, 6],
      ["util", ["src/main/java/util/**"], null, 1, 2],
    ],
    total: [3, 8],
    config: {
      languages: ["java"],
      watch: [...JAVA_WATCH, res("**/*Mapper.xml"), res("**/mapper/**/*.xml")],
    },
    mappers: { rest: 1, restFiles: [res("misc/SeekMapper.xml")] },
  },
  {
    name: "given source roots with more modules than the maximum",
    tree: `
      pom.xml  1
      alpha/src/main/java/org/sample/alpha/A.java  2
      beta/src/main/java/org/sample/beta/B.java  3
      gamma/src/main/kotlin/org/sample/gamma/G.kt  5`,
    args: [
      "--max-parts", "2",
      "--root", "gamma/src/main/kotlin", "--root", "alpha/src/main/java", "--root", "beta/src/main/java",
    ],
    languages: ["java"],
    languageSource: "detected",
    rootSource: "command line",
    modules: ["alpha", "beta", "gamma"],
    parts: [
      ["top", ["**"], null, 2, 5],
      ["gamma", ["gamma/src/main/kotlin/**"], "gamma", 1, 5],
    ],
    total: [3, 10],
    config: {
      languages: ["java"],
      roots: ["alpha/src/main/java", "beta/src/main/java", "gamma/src/main/kotlin"],
      watch: [
        "alpha/src/main/java/**/*.java",
        "alpha/src/main/java/**/*.kt",
        "beta/src/main/java/**/*.java",
        "beta/src/main/java/**/*.kt",
        "gamma/src/main/kotlin/**/*.java",
        "gamma/src/main/kotlin/**/*.kt",
      ],
    },
    notes: { modules: { modules: 3, notRemaining: 2 } },
  },
  {
    name: "tests on with more modules than the maximum",
    tree: `
      pom.xml  1
      alpha/pom.xml  1
      alpha/src/main/java/org/sample/alpha/A.java  2
      alpha/src/test/java/org/sample/alpha/ATest.java  4
      beta/pom.xml  1
      beta/src/main/java/org/sample/beta/B.java  3
      gamma/pom.xml  1
      gamma/src/test/kotlin/org/sample/gamma/GTest.kt  6`,
    existing: { tests: true },
    args: ["--max-parts", "2"],
    languages: ["java"],
    languageSource: "detected",
    modules: ["alpha", "beta", "gamma"],
    parts: [
      ["top", ["**"], null, 3, 9],
      ["gamma", ["gamma/src/test/kotlin/**"], "gamma", 1, 6],
    ],
    total: [4, 15],
    config: {
      languages: ["java"],
      watch: [
        ...LANGUAGE_ROOTS_WATCH,
        "**/src/test/java/**/*.java",
        "**/src/test/java/**/*.kt",
        "**/src/test/kotlin/**/*.java",
        "**/src/test/kotlin/**/*.kt",
      ],
    },
    notes: { modules: { modules: 3, notRemaining: 2 } },
  },
  {
    name: "mapper XML outside the patterns with more modules than the maximum",
    tree: `
      pom.xml  1
      alpha/pom.xml  1
      alpha/src/main/java/org/sample/alpha/A.java  12
      alpha/src/main/resources/mapper/AlphaMapper.xml  M org.sample.alpha.A
      alpha/src/main/resources/sql/Query.xml  M org.sample.alpha.A
      alpha/src/main/resources/sql/conf.xml  XML
      beta/pom.xml  1
      beta/src/main/java/org/sample/beta/B.java  3
      gamma/pom.xml  1
      gamma/src/main/java/org/sample/gamma/G.java  5
      gamma/src/main/resources/mapper/GammaMapper.xml  M none.G2
      gamma/src/main/resources/q/Lookup.xml  M none.L`,
    args: ["--max-parts", "2"],
    languages: ["java"],
    languageSource: "detected",
    modules: ["alpha", "beta", "gamma"],
    parts: [
      ["top", ["**"], null, 4, 14],
      ["alpha", [
        "alpha/src/main/java/**",
        "alpha/src/main/resources/**/*Mapper.xml",
        "alpha/src/main/resources/**/mapper/**/*.xml",
        "alpha/src/main/resources/mapper/*.xml",
        "alpha/src/main/resources/sql/*.xml",
      ], "alpha", 3, 18],
    ],
    total: [7, 32],
    config: {
      languages: ["java"],
      watch: [
        ...LANGUAGE_ROOTS_WATCH,
        "alpha/src/main/resources/**/*Mapper.xml",
        "alpha/src/main/resources/**/mapper/**/*.xml",
        "alpha/src/main/resources/sql/Query.xml",
        "gamma/src/main/resources/**/*Mapper.xml",
        "gamma/src/main/resources/**/mapper/**/*.xml",
        "gamma/src/main/resources/q/*.xml",
      ],
    },
    mappers: {
      namespace: 2, rest: 2, outsidePattern: 2,
      restFiles: ["gamma/src/main/resources/mapper/GammaMapper.xml", "gamma/src/main/resources/q/Lookup.xml"],
    },
    notes: { modules: { modules: 3, notRemaining: 2 } },
  },
  {
    name: "the deepest module takes files under nested module directories",
    tree: `
      pom.xml  1
      dock/pom.xml  1
      dock/src/main/java/org/sample/dock/D.java  9
      pier/pom.xml  1
      pier/src/main/java/org/sample/pier/P.java  1
      ship/pom.xml  1
      ship/src/main/java/org/sample/ship/S.java  7
      ship/track/pom.xml  1
      ship/track/src/main/java/org/sample/track/T.java  20
      ship/track/x/F.java  2`,
    args: ["--max-parts", "3"],
    languages: ["java"],
    languageSource: "detected",
    modules: ["dock", "pier", "ship", "ship/track"],
    parts: [
      ["top", ["**"], null, 2, 8],
      ["dock", ["dock/src/main/java/**"], "dock", 1, 9],
      ["ship-track", ["ship/track/**"], "ship", 2, 22],
    ],
    total: [5, 39],
    config: { languages: ["java"], watch: [...LANGUAGE_ROOTS_WATCH, "ship/track/x/F.java"] },
    notes: { modules: { modules: 4, notRemaining: 2 }, "exact-paths": { files: 1 } },
  },
  {
    name: "a module two levels below a module part folds straight into it",
    tree: `
      pom.xml  1
      mill/pom.xml  1
      mill/src/main/java/org/sample/mill/M.java  5
      yard/pom.xml  1
      yard/src/main/java/org/sample/yard/Y.java  8
      yard/a/b/inner/pom.xml  1
      yard/a/b/inner/src/main/java/org/sample/inner/I.java  1`,
    args: ["--max-parts", "2"],
    languages: ["java"],
    languageSource: "detected",
    modules: ["mill", "yard", "yard/a/b/inner"],
    parts: [
      ["mill", ["mill/src/main/java/**"], "mill", 1, 5],
      ["yard", ["yard/**"], "yard", 2, 9],
    ],
    total: [3, 14],
    config: { languages: ["java"], watch: LANGUAGE_ROOTS_WATCH },
    notes: { modules: { modules: 3, notRemaining: 1 } },
  },
  {
    name: "code beside mapper XML in the resources directory is one part of exact paths",
    tree: `
      pom.xml                                1
      src/main/java/org/x/A.java             1
      src/main/resources/mapper/Helper.java  2
      src/main/resources/mapper/SeekMapper.xml  M none.Seek`,
    languages: ["java"],
    languageSource: "detected",
    parts: [
      ["x", ["src/main/java/org/x/A.java", res("**/*Mapper.xml"), res("**/mapper/**/*.xml"), res("mapper/*.xml")], null, 2, 4],
      ["src-main-resources", [res("mapper/Helper.java")], null, 1, 2],
    ],
    total: [3, 6],
    config: {
      languages: ["java"],
      watch: [...JAVA_WATCH, res("**/*Mapper.xml"), res("**/mapper/**/*.xml"), res("mapper/Helper.java")],
    },
    mappers: { rest: 1, restFiles: [res("mapper/SeekMapper.xml")] },
    notes: { "exact-paths": { files: 1 } },
  },
  {
    name: "given roots are written escaped in config.roots",
    tree: "pom.xml 1\npkg[1]/A.java 2",
    args: ["--root", "pkg[1]"],
    languages: ["java"],
    languageSource: "detected",
    rootSource: "command line",
    modules: ["pkg[1]"],
    parts: [["pkg-1", ["pkg[[]1]/A.java"], null, 1, 2]],
    total: [1, 2],
    config: {
      languages: ["java"],
      watch: ["pkg[[]1]/**/*.java", "pkg[[]1]/**/*.kt"],
      roots: ["pkg[[]1]"],
    },
  },
  ...([
    [[], [
      ["sample", ["src/main/java/org/sample/Main.java", res("**/*Mapper.xml"), res("**/mapper/**/*.xml")], null, 1, 4],
      ["dock", ["src/main/java/org/sample/dock/**", res("mapper/*.xml")], null, 3, 12],
      ["src-main-resources", [res("mapper/Helper.java")], null, 1, 2],
    ]],
    [["--max-parts", "2"], [
      ["top", ["src/**"], null, 1, 2],
      ["sample", [
        "src/main/java/org/sample/**", res("**/*Mapper.xml"), res("**/mapper/**/*.xml"), res("mapper/*.xml"),
      ], null, 4, 16],
    ]],
  ] as [string[], Row[]][]).map(([args, parts]): Case => ({
    name: `a resources-directory part with a mapper XML named like it (${args.join(" ") || "default"})`,
    tree: `
      pom.xml                                   1
      src/main/java/org/sample/Main.java        4
      src/main/java/org/sample/dock/Dock.java   6
      src/main/resources/mapper/DockMapper.xml  M org.sample.dock.Dock
      src/main/resources/mapper/Helper.java     2
      src/main/resources/mapper/Helper.xml      M none.Helper`,
    args,
    languages: ["java"],
    languageSource: "detected",
    parts,
    total: [5, 18],
    config: {
      languages: ["java"],
      watch: [...JAVA_WATCH, res("**/*Mapper.xml"), res("**/mapper/**/*.xml"), res("mapper/Helper.java")],
    },
    mappers: { namespace: 1, rest: 1, restFiles: [res("mapper/Helper.xml")] },
    notes: { "exact-paths": { files: 1 } },
  })),
  {
    name: "a resources-directory part stays apart at a shallow start depth",
    tree: `
      pom.xml                                1
      src/main/java/org/sample/Main.java     4
      src/main/resources/mapper/Helper.java  2
      src/main/resources/mapper/Helper.xml   M none.Helper
      src/tools/Gen.java                     1
      src/extra/E.java                       3
      src/misc/M.java                        5`,
    args: ["--max-parts", "3"],
    languages: ["java"],
    languageSource: "detected",
    parts: [
      ["sample", [
        "src/main/java/org/sample/Main.java", res("**/*Mapper.xml"), res("**/mapper/**/*.xml"), res("mapper/*.xml"),
      ], null, 2, 7],
      ["src", ["src/**"], null, 3, 9],
      ["src-main-resources", [res("mapper/Helper.java")], null, 1, 2],
    ],
    total: [6, 18],
    config: {
      languages: ["java"],
      watch: [
        "src/extra/E.java",
        ...JAVA_WATCH,
        res("**/*Mapper.xml"),
        res("**/mapper/**/*.xml"),
        res("mapper/Helper.java"),
        "src/misc/M.java",
        "src/tools/Gen.java",
      ],
    },
    mappers: { rest: 1, restFiles: [res("mapper/Helper.xml")] },
    notes: { "exact-paths": { files: 4 } },
  },
  {
    name: "with more modules than the maximum, resources code goes to its module part",
    tree: `
      pom.xml                                      1
      alpha/pom.xml                                1
      alpha/src/main/java/org/sample/alpha/A.java  9
      alpha/src/main/resources/mapper/Seed.java    4
      beta/pom.xml                                 1
      beta/src/main/java/org/sample/beta/B.java    3
      gamma/pom.xml                                1
      gamma/src/main/java/org/sample/gamma/G.java  5`,
    args: ["--max-parts", "2"],
    languages: ["java"],
    languageSource: "detected",
    modules: ["alpha", "beta", "gamma"],
    parts: [
      ["top", ["**"], null, 2, 8],
      ["alpha", ["alpha/**"], "alpha", 2, 13],
    ],
    total: [4, 21],
    config: {
      languages: ["java"],
      watch: [...LANGUAGE_ROOTS_WATCH, "alpha/src/main/resources/mapper/Seed.java"],
    },
    notes: { modules: { modules: 3, notRemaining: 2 }, "exact-paths": { files: 1 } },
  },
  {
    name: "a root in an existing config may use one-character sets",
    tree: "pom.xml 1\npkg[1]/org/sample/P.java 3\na/X.java 1",
    existing: { roots: ["pkg[[]1]"] },
    languages: ["java"],
    languageSource: "detected",
    rootSource: "codeplan.json",
    modules: ["pkg[1]"],
    parts: [
      ["sample", ["pkg[[]1]/org/sample/P.java"], null, 1, 3],
      ["a", ["a/**"], null, 1, 1],
    ],
    total: [2, 4],
    config: { languages: ["java"], roots: ["pkg[[]1]"], watch: ["a/X.java", "pkg[[]1]/**/*.java", "pkg[[]1]/**/*.kt"] },
    notes: { "exact-paths": { files: 1 } },
  },
  ...([
    [undefined, ["--root", "pkg[1]"], "detected", "command line"],
    [
      { languages: ["java"], roots: ["pkg[[]1]"], watch: ["pkg[[]1]/**/*.java", "pkg[[]1]/**/*.kt"] },
      [], "codeplan.json", "codeplan.json",
    ],
  ] as [Record<string, unknown> | undefined, string[], string, string][]).map(
    ([existing, args, languageSource, rootSource]): Case => ({
      name: `the draft config read back as the existing config gives the same draft (${existing ? "read back" : "first"})`,
      tree: "pom.xml 1\npkg[1]/org/sample/P.java 3\npkg[1]/org/sample/sub/Q.java 2",
      existing,
      args,
      languages: ["java"],
      languageSource,
      rootSource,
      modules: ["pkg[1]"],
      parts: [
        ["sample", ["pkg[[]1]/org/sample/P.java"], null, 1, 3],
        ["sub", ["pkg[[]1]/org/sample/sub/**"], null, 1, 2],
      ],
      total: [2, 5],
      config: { languages: ["java"], roots: ["pkg[[]1]"], watch: ["pkg[[]1]/**/*.java", "pkg[[]1]/**/*.kt"] },
    }),
  ),
  {
    name: "an id suffix takes the first number not used yet",
    tree: "main.ts 1\n_/a.ts 2\ntop_2/b.ts 3",
    languages: ["js"],
    languageSource: "default",
    parts: [
      ["top", ["main.ts"], null, 1, 1],
      ["top-2", ["_/**"], "_", 1, 2],
      ["top-2-2", ["top_2/**"], "top_2", 1, 3],
    ],
    total: [3, 6],
    config: { languages: ["js"] },
  },
  {
    name: "an empty or blank namespace counts as no namespace",
    tree: `
      pom.xml                                  1
      src/main/java/org/sample/App.java        3
      src/main/java/org/sample/core/Core.java  5
      src/main/resources/mapper/EmptyNs.xml    M ""
      src/main/resources/sql/Blank.xml         M ""
      src/main/resources/sql/Space.xml         M "   "`,
    languages: ["java"],
    languageSource: "detected",
    parts: [
      ["sample", [
        "src/main/java/org/sample/App.java", res("**/*Mapper.xml"), res("**/mapper/**/*.xml"), res("mapper/*.xml"),
      ], null, 2, 6],
      ["core", ["src/main/java/org/sample/core/**"], null, 1, 5],
    ],
    total: [3, 11],
    config: { languages: ["java"], watch: [...JAVA_WATCH, res("**/*Mapper.xml"), res("**/mapper/**/*.xml")] },
    mappers: { rest: 1, restFiles: [res("mapper/EmptyNs.xml")] },
  },
];

describe("draft on fixed trees", () => {
  test.each(CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => runCase(c));
});

describe("draft errors and follow-up checks", () => {
  test("bad option values and roots exit 2", () => {
    const repo = writeRepo(tree(ONE_JS));
    const bad = [
      ["--max-parts", "0"],
      ["--max-parts", "-1"],
      ["--max-parts", "1.5"],
      ["--max-parts", "abc"],
      ["--max-parts", "+3"],
      ["--max-parts", "3x"],
      ["--max-parts", ""],
      ["--max-parts"],
      ["--language", "pascal"],
      ["--language", "js", "--language", "js"],
      ["--language", "java", "--language", "java"],
      ["--root", "nope"],
      ["--root", "index.ts"],
      ["--root", ".."],
      ["--root", "."],
      ["--root", "index.ts/child"],
      ["--root", "src", "--root", "./src/"],
      ["--repo", join(repo, "missing")],
    ];
    writeRepo(tree("src/x.ts 1"), repo);
    for (const args of bad) {
      const out = run(["draft", ...args], repo);
      expect(out.code, args.join(" ")).toBe(2);
      expect(out.stdout).toBe("");
      expect(out.stderr, args.join(" ")).toMatch(/^codeplan: .*\n/);
      expect(out.stderr).not.toMatch(/^\s+at /m);
    }
    expect(run(["draft", "--max-parts", "16"], repo)).toEqual(run(["draft"], repo));
  });

  test("a mapper XML first added to a module without mappers is reported as unwatched", () => {
    const repo = writeRepo(tree(KIOSK));
    const result = runDraft(repo);
    for (const p of result.plan.parts) expect(p.paths.join(" ")).not.toMatch(/Mapper|mapper/);
    expect(result.config.watch!.join(" ")).not.toMatch(/Mapper|mapper/);
    expectDraftInvariants(repo, result, null);
    writeRepo(tree("src/main/resources/mapper/NewMapper.xml M org.sample.kiosk.App"), repo);
    const checked = check(repo);
    if (checked.kind !== "measured") throw new Error(checked.message);
    expect(checked.measurement.unwatched).toEqual(["src/main/resources/mapper/NewMapper.xml"]);
    expect(checked.measurement.orphans).toEqual([]);
    expect(checked.measurement.contested).toEqual([]);
    expect(checked.measurement.parts.map((p) => [p.id, p.files, p.lines])).toEqual(
      result.measure.parts.map((p) => [p.id, p.files, p.lines]),
    );
    expect(run(["check"], repo).code).toBe(1);
  });

  test("roots in an existing config are paths, with one-character sets read as characters", () => {
    const repo = writeRepo(tree("pom.xml 1\npkg[1]/A.java 2\nsrc/main/java/B.java 1"));
    const cases: [unknown, number][] = [
      [["pkg[[]1]"], 0],
      [["**/src/main/java"], 2],
      [["src/main/*"], 2],
      [["pkg[1]"], 2],
      [["src/main/java", "./src/main/java/"], 2],
      [["."], 2],
    ];
    for (const [roots, code] of cases) {
      writeFileSync(join(repo, "codeplan.json"), JSON.stringify({ roots }));
      const out = run(["draft"], repo);
      expect(out.code, JSON.stringify(roots)).toBe(code);
      if (code === 2) expect(out.stderr).toMatch(/^codeplan: roots in codeplan.json .*\n$/);
    }
    writeFileSync(join(repo, "codeplan.json"), JSON.stringify({ roots: ["**/src/main/java"] }));
    expect(run(["draft"], repo).stderr).toContain("glob");
    expect(run(["check"], repo).code).not.toBe(2);
  });

  test("roots in an existing config: a glob, a repeat or the repository root exit 2", () => {
    for (const [roots, reason] of [
      [["**/src/main/java"], /glob/],
      [["a", "a"], /more than once/],
      [["."], /not a directory inside the repository/],
    ] as [string[], RegExp][]) {
      const repo = writeRepo({
        ...tree("pom.xml 1\npkg[1]/org/sample/P.java 3\na/X.java 1"),
        "codeplan.json": JSON.stringify({ roots }),
      });
      const out = run(["draft"], repo);
      expect(out.code, JSON.stringify(roots)).toBe(2);
      expect(out.stderr).toMatch(reason);
      expect(out.stderr.split("\n").length).toBe(2);
    }
  });

  test("bad --root values exit 2 without a stack trace, a symbolic link among them", () => {
    const repo = writeRepo(tree("package.json 1\na/x.ts 1\nlink LINK a"));
    for (const args of [
      ["--root", "package.json/child"],
      ["--root", "."],
      ["--root", "a", "--root", "a/"],
      ["--root", "link"],
    ]) {
      const out = run(["draft", ...args], repo);
      expect(out.code, args.join(" ")).toBe(2);
      expect(out.stderr).not.toMatch(/^\s+at /m);
    }
  });

  test("draft options on another command exit 2 with usage", () => {
    const repo = writeRepo(tree(ONE_JS));
    for (const args of [["--max-parts", "3"], ["--language", "js"], ["--root", "src"]]) {
      const out = run(["check", ...args], repo);
      expect(out.code).toBe(2);
      expect(out.stderr).toContain("Usage:");
    }
  });

  test("an existing config that cannot be read exits 2", () => {
    const repo = writeRepo({ ...tree(ONE_JS), "codeplan.json": '{"nope":1}' });
    expect(run(["draft"], repo).code).toBe(2);
    writeFileSync(join(repo, "codeplan.json"), "{");
    expect(run(["draft"], repo).code).toBe(2);
  });
});
