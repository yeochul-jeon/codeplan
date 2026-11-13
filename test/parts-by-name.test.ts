import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { run } from "../src/cli.js";
import type { Draft } from "../src/draft.js";
import { expectDraftInvariants, noteFacts, runDraft, writeRepo } from "./draft-helpers.js";
import { tempDir } from "./helpers.js";

// A layered Java tree of three modules: "<path> <lines>", and for mapper XML
// "<path> M <namespace>".
const APP = "app/src/main/java/dev/sample/store";
const DATA = "data/src/main/java/dev/sample/store";
const TINY = "tiny/src/main/java/dev/sample/tiny";
const TREE = `
app/pom.xml 1
${APP}/App.java 4
${APP}/controller/BillController.java 8
${APP}/controller/BillHookController.java 9
${APP}/controller/GuestController.java 4
${APP}/controller/MemberController.java 6
${APP}/controller/StockAdminController.java 7
${APP}/controller/StockController.java 6
${APP}/dto/BillReply.java 7
${APP}/dto/BillRequest.java 6
${APP}/dto/GuestReply.java 9
${APP}/dto/GuestRequest.java 8
${APP}/dto/StockReply.java 5
${APP}/dto/StockRequest.java 4
${APP}/service/BillRetryService.java 5
${APP}/service/BillService.java 3
${APP}/service/BillServiceImpl.java 4
${APP}/service/GuestAuthService.java 7
${APP}/service/GuestService.java 5
${APP}/service/GuestServiceImpl.java 6
${APP}/service/IStock.java 3
${APP}/service/MemberService.java 7
${APP}/service/MemberServiceImpl.java 8
${APP}/service/Membership.java 9
${APP}/service/StockPriceService.java 3
${APP}/service/StockService.java 8
${APP}/service/StockServiceImpl.java 9
${APP}/service/Stockroom.java 6
${APP}/service/URLHelper.java 4
${APP}/service/package-info.java 1
${APP}/util/Stockpile.java 5
app/src/test/java/dev/sample/store/service/StockServiceTest.java 7
data/pom.xml 1
${DATA}/mapper/BillMapper.java 8
${DATA}/mapper/BillTraceMapper.java 9
${DATA}/mapper/GuestMapper.java 3
${DATA}/mapper/MemberMapper.java 3
${DATA}/mapper/StockItemMapper.java 7
${DATA}/mapper/StockMapper.java 6
${DATA}/model/Bill.java 3
${DATA}/model/Guest.java 4
${DATA}/model/GuestRole.java 5
${DATA}/model/Member.java 4
${DATA}/model/Stock.java 8
${DATA}/model/StockItem.java 9
${DATA}/model/TraceA.java 5
${DATA}/model/TraceB.java 6
${DATA}/model/TraceC.java 7
${DATA}/model/TraceD.java 8
${DATA}/model/TraceE.java 9
${DATA}/model/TraceF.java 3
${DATA}/model/TraceG.java 4
${DATA}/model/TraceH.java 5
${DATA}/model/TraceI.java 6
${DATA}/model/TraceJ.java 7
${DATA}/model/TraceK.java 8
${DATA}/model/TraceL.java 9
data/src/main/resources/mapper/BillMapper.xml M dev.sample.store.mapper.BillMapper
data/src/main/resources/mapper/GuestMapper.xml M dev.sample.store.mapper.GuestMapper
data/src/main/resources/mapper/StockItemMapper.xml M dev.sample.store.mapper.StockItemMapper
data/src/main/resources/mapper/StockMapper.xml M dev.sample.store.mapper.StockMapper
pom.xml 1
scripts/StockTool.java 1
tiny/pom.xml 1
${TINY}/mapper/StockTinyMapper.java 5
${TINY}/model/StockTiny.java 4
${TINY}/service/StockTinyService.java 3
tiny/src/main/resources/mapper/StockTinyMapper.xml M dev.sample.tiny.mapper.StockTinyMapper
`;

// A `.java` file is a package line, a class line, comment lines and `}`.
function content(path: string, rest: string): string {
  if (rest.startsWith("M ")) return `<?xml version="1.0"?>\n<mapper namespace="${rest.slice(2)}">\n</mapper>\n`;
  if (path.endsWith("pom.xml")) return "<project/>\n";
  const inRoot = /src\/(?:main|test)\/java\/(.*)\/([^/]+)\.java$/.exec(path);
  if (inRoot === null) return `class ${path.slice(path.lastIndexOf("/") + 1, -5)} {}\n`;
  const [, dir, name] = inRoot as unknown as [string, string, string];
  const pkg = `package ${dir.split("/").join(".")};\n`;
  if (name === "package-info") return pkg;
  const body = Array.from({ length: Number(rest) - 3 }, (_, i) => `  // ${i}\n`).join("");
  return `${pkg}public class ${name} {\n${body}}\n`;
}

function files(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.trim().split("\n")) {
    const [path, rest] = [line.slice(0, line.indexOf(" ")), line.slice(line.indexOf(" ") + 1)];
    out[path] = content(path, rest);
  }
  return out;
}

type Row = [id: string, files: number, lines: number];
const rows = (d: Draft): Row[] => d.measure.parts.map((p) => [p.id, p.files, p.lines]);
const part = (d: Draft, id: string) => d.plan.parts.find((p) => p.id === id)!;
const starred = (d: Draft, id: string) => part(d, id).paths.filter((p) => p.endsWith("*"));
const others = (d: Draft, id: string) => part(d, id).paths.filter((p) => !p.endsWith("*"));

// Write the draft, then update and check: no orphan, contested or unwatched
// file, no finding, and the counts of `measure`. Then check without the page.
function drafted(tree: Record<string, string>, args: string[], existing: Record<string, unknown> | null = null): Draft {
  const all = existing ? { ...tree, "codeplan.json": JSON.stringify(existing) } : tree;
  const repo = writeRepo(all);
  const result = runDraft(repo, args);
  expectDraftInvariants(repo, result, existing, args);
  expect(run(["check", "--no-page"], repo).code).toBe(0);
  return result;
}

const WITHOUT: Row[] = [
  ["app", 1, 4], ["app-controller", 6, 40], ["app-dto", 6, 39], ["app-service", 16, 88],
  ["app-util", 1, 5], ["data-mapper", 10, 48], ["data-model", 18, 110], ["tiny-mapper", 2, 8],
  ["tiny-model", 1, 4], ["tiny-service", 1, 3], ["scripts", 1, 1],
];
const BILL = [
  `${APP}/controller/Bill*`, `${APP}/dto/Bill*`, `${APP}/service/Bill*`,
  `${DATA}/mapper/Bill*`, `${DATA}/model/Bill*`,
];
const STOCK = [
  `${APP}/controller/Stock*`, `${APP}/dto/Stock*`, `${APP}/service/Stock*`,
  `${DATA}/mapper/Stock*`, `${DATA}/model/Stock*`,
  `${TINY}/mapper/Stock*`, `${TINY}/model/Stock*`, `${TINY}/service/Stock*`,
];
const TINY_MAPPERS = ["tiny/src/main/resources/**/*Mapper.xml", "tiny/src/main/resources/**/mapper/**/*.xml"];

describe("draft --parts-by-name", () => {
  const tree = files(TREE);

  test("without the option the parts follow packages", () => {
    const d = drafted(tree, []);
    expect(rows(d)).toEqual(WITHOUT);
    expect([d.measure.files, d.measure.lines]).toEqual([63, 350]);
    expect(d.modules).toEqual(["app", "data", "tiny"]);
    expect(Object.keys(noteFacts(d.notes))).toEqual(["exact-paths", "layers"]);
  });

  test("10: two words have ten files under two or more of these names", () => {
    const d = drafted(tree, ["--parts-by-name", "10"]);
    expect(rows(d)).toEqual([
      ["app", 1, 4], ["app-controller", 2, 10], ["app-dto", 2, 17], ["app-service", 9, 50],
      ["app-util", 1, 5], ["data-mapper", 3, 9], ["data-model", 15, 90], ["scripts", 1, 1],
      ["bill", 11, 65], ["stock", 18, 99],
    ]);
    expect([d.measure.files, d.measure.lines]).toEqual([63, 350]);
    expect(part(d, "bill")).toEqual({
      id: "bill", name: "Bill", about: "",
      paths: [...BILL, "data/src/main/resources/mapper/BillMapper.xml"],
    });
    expect(part(d, "stock")).toEqual({
      id: "stock", name: "Stock", about: "",
      paths: [
        ...STOCK.slice(0, 5), "data/src/main/resources/mapper/*.xml", ...STOCK.slice(5),
        ...TINY_MAPPERS, "tiny/src/main/resources/mapper/*.xml",
      ],
    });
    expect(noteFacts(d.notes)).toEqual({
      "exact-paths": { files: 1 },
      layers: { layerFiles: 55, files: 57 },
      "parts-by-name": { parts: 2, files: 29 },
    });
    // The config and the module list are what they are without the option.
    const plain = runDraft(writeRepo(tree));
    expect(d.config).toEqual(plain.config);
    expect(d.modules).toEqual(plain.modules);
  });

  test("5: four words, and a longer name in the same directory goes with the word", () => {
    const d = drafted(tree, ["--parts-by-name", "5"]);
    expect(rows(d)).toEqual([
      ["app", 1, 4], ["app-service", 3, 8], ["app-util", 1, 5], ["data-model", 12, 77], ["scripts", 1, 1],
      ["bill", 11, 65], ["guest", 10, 54], ["member", 6, 37], ["stock", 18, 99],
    ]);
    expect(starred(d, "bill")).toEqual(BILL);
    expect(starred(d, "stock")).toEqual(STOCK);
    expect(starred(d, "guest")).toEqual(BILL.map((p) => p.replace("Bill*", "Guest*")));
    expect(starred(d, "member")).toEqual([
      `${APP}/controller/Member*`, `${APP}/service/Member*`, `${DATA}/mapper/Member*`, `${DATA}/model/Member*`,
    ]);
    expect(others(d, "guest")).toEqual(["data/src/main/resources/mapper/GuestMapper.xml"]);
    expect(part(d, "member").name).toBe("Member");
    expect(noteFacts(d.notes)["parts-by-name"]).toEqual({ parts: 4, files: 45 });
  });

  test("5 with --max-parts 4: the other files fold to one part for each module", () => {
    const d = drafted(tree, ["--parts-by-name", "5", "--max-parts", "4"]);
    expect(rows(d)).toEqual([
      ["top", 1, 1], ["app", 5, 17], ["data", 12, 77],
      ["bill", 11, 65], ["guest", 10, 54], ["member", 6, 37], ["stock", 18, 99],
    ]);
    expect(noteFacts(d.notes)["over-max-parts"]).toEqual({ parts: 7, maxParts: 4 });
    expect(d.notes.find((n) => n.code === "over-max-parts")!.message).toBe(
      "7 parts, more than the maximum 4: --parts-by-name made 4 of them, and parts do not fold across modules",
    );
  });

  test("100: no word has that many files, and only a note is added", () => {
    const repo = writeRepo(tree);
    const plain = runDraft(repo);
    const d = runDraft(repo, ["--parts-by-name", "100"]);
    const { notes, ...rest } = d;
    const { notes: plainNotes, ...plainRest } = plain;
    expect(rest).toEqual(plainRest);
    expect(notes.filter((n) => n.code !== "no-parts-by-name")).toEqual(plainNotes);
    expect(notes.filter((n) => n.code === "no-parts-by-name")).toHaveLength(1);
    expectDraftInvariants(repo, d, null, ["--parts-by-name", "100"]);
  });

  test("a tree without Java gets the same note", () => {
    const repo = writeRepo({ "package.json": "{}", "src/service/StockA.ts": "x\n", "src/model/StockB.ts": "x\n" });
    const d = runDraft(repo, ["--parts-by-name", "1"]);
    expect(Object.keys(noteFacts(d.notes))).toEqual(["no-parts-by-name"]);
    expect(d.plan).toEqual(runDraft(repo).plan);
  });

  test("the value is a whole number of 1 or more, given once, and the option is for draft only", () => {
    const repo = writeRepo(tree);
    for (const args of [
      ["--parts-by-name"], ["--parts-by-name", "0"], ["--parts-by-name", "x"], ["--parts-by-name", "1.5"],
      ["--parts-by-name", "-3"], ["--parts-by-name", "5", "--parts-by-name", "5"],
    ]) {
      const out = run(["draft", ...args], repo);
      expect([args, out.code, out.stdout]).toEqual([args, 2, ""]);
    }
    for (const command of ["check", "update", "summary"]) {
      const out = run([command, "--parts-by-name", "5"], repo);
      expect(out.code).toBe(2);
      expect(out.stderr).toContain("Usage:");
    }
    expect(run(["draft", "--parts-by-name", "010"], repo)).toEqual(run(["draft", "--parts-by-name", "10"], repo));
    // The value does not become a source root.
    expect(runDraft(repo, ["--parts-by-name", "10"]).config.roots).toBeUndefined();
  });

  test("with tests counted, the word takes the test directory too", () => {
    const d = drafted(tree, ["--parts-by-name", "10"], { tests: true });
    expect(starred(d, "stock")).toEqual([
      ...STOCK.slice(0, 3), "app/src/test/java/dev/sample/store/service/Stock*", ...STOCK.slice(3),
    ]);
    expect(rows(d).find(([id]) => id === "stock")).toEqual(["stock", 19, 106]);
  });

  test("an id that a directory part already has gets -2; the name stays the word", () => {
    const d = drafted({ ...tree, "stock/README.java": "class README {}\n" }, ["--parts-by-name", "10"]);
    expect(d.plan.parts.map((p) => p.id).filter((id) => id.startsWith("stock"))).toEqual(["stock", "stock-2"]);
    expect(part(d, "stock").paths).toEqual(["stock/**"]);
    expect(part(d, "stock-2").name).toBe("Stock");
    expect(starred(d, "stock-2")).toEqual(STOCK);
  });

  // One root module. The word's part holds `mapper/*.xml`; the part with
  // `**` writes the exact path of its own XML there, or the `*.xml` takes it.
  const WIDE = `
pom.xml 1
src/main/java/dev/sample/shop/controller/StockController.java 4
src/main/java/dev/sample/shop/service/StockService.java 5
src/main/java/dev/sample/shop/mapper/StockMapper.java 3
src/main/java/dev/sample/shop/mapper/StockItemMapper.java 3
src/main/java/dev/sample/shop/mapper/GuestMapper.java 6
src/main/java/dev/sample/shop/model/Guest.java 7
src/main/resources/mapper/StockMapper.xml M dev.sample.shop.mapper.StockMapper
src/main/resources/mapper/StockItemMapper.xml M dev.sample.shop.mapper.StockItemMapper
src/main/resources/mapper/GuestMapper.xml M dev.sample.shop.mapper.GuestMapper
tools/Run.java 1
`;

  test("a part with ** keeps the exact path of its XML beside the word's *.xml", () => {
    const d = drafted(files(WIDE), ["--parts-by-name", "3", "--max-parts", "2"]);
    expect(rows(d)).toEqual([["top", 4, 17], ["stock", 6, 21]]);
    expect(part(d, "top").paths).toEqual(["**", "src/main/resources/mapper/GuestMapper.xml"]);
    expect(others(d, "stock")).toEqual(["src/main/resources/mapper/*.xml"]);
  });

  test("a file two patterns match goes to the longer word", () => {
    const base = "src/main/java/dev/sample/shop";
    const d = drafted(files(`
pom.xml 1
${base}/service/BillService.java 3
${base}/service/Bill2Service.java 4
${base}/model/Bill.java 5
${base}/model/Bill2.java 6
${base}/model/Guest.java 7
`), ["--parts-by-name", "2"]);
    expect(rows(d)).toEqual([["model", 1, 7], ["bill", 2, 8], ["bill2", 2, 10]]);
    expect(part(d, "bill2").paths).toEqual([`${base}/model/Bill2*`, `${base}/service/Bill2*`]);
  });

  // A module whose code all went to the words' parts: one of them holds the
  // module's two mapper patterns. Most XML taken, then more lines, then the word.
  test.each([
    ["BillMapper.xml M dev.sample.shop.mapper.BillMapper", 9, "bill"],
    ["OtherMapper.xml M none.N", 9, "stock"],
    ["OtherMapper.xml M none.N", 3, "bill"],
  ])("the module's mapper patterns with %s and %i lines", (xml, stockLines, holder) => {
    const base = "src/main/java/dev/sample/shop";
    const d = drafted(files(`
pom.xml 1
${base}/service/BillService.java 3
${base}/mapper/BillMapper.java 3
${base}/service/StockService.java 3
${base}/mapper/StockMapper.java ${stockLines}
src/main/resources/mapper/${xml}
`), ["--parts-by-name", "2"]);
    expect(d.plan.parts.map((p) => p.id)).toEqual(["bill", "stock"]);
    for (const id of ["bill", "stock"]) {
      expect(others(d, id).includes("src/main/resources/**/*Mapper.xml"), id).toBe(id === holder);
    }
  });

  test("a file outside modules that a pattern matches goes to the word's part", () => {
    // The module sits below a resources directory that belongs to no module,
    // so the XML beside its code is a file outside modules.
    const base = "x/src/main/resources/sub/src/main/java/dev/sample";
    const d = drafted(files(`
pom.xml 1
x/src/main/resources/sub/pom.xml 1
${base}/service/StockService.java 3
${base}/model/Stock.java 4
${base}/service/StockMapper.xml M dev.sample.service.StockService
`), ["--parts-by-name", "2"]);
    expect(rows(d)).toEqual([["stock", 3, 10]]);
    expect(part(d, "stock").paths).toEqual([`${base}/model/Stock*`, `${base}/service/Stock*`]);
  });

  test("the tree written in reverse order in another place gives the same bytes", () => {
    const args = ["draft", "--parts-by-name", "5"];
    const reversed = writeRepo(Object.fromEntries(Object.entries(tree).reverse()), join(tempDir(), "elsewhere"));
    expect(run(args, reversed)).toEqual(run(args, writeRepo(tree)));
  });

  test("without the option the same tree needs no such path", () => {
    for (const max of ["1", "2", "3"]) {
      const d = drafted(files(WIDE), ["--max-parts", max]);
      for (const p of d.plan.parts) {
        if (p.paths.includes("**")) expect(p.paths).toEqual(["**"]);
      }
    }
  });
});

// Layered trees from a seed: modules, words, layer directories, mapper XML.
function layered(seed: number): Record<string, string> {
  let s = seed >>> 0;
  const r = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const pick = <T>(items: T[]): T => items[Math.floor(r() * items.length)]!;
  const words = ["Stock", "Stockroom", "Bill", "Bill2", "Guest", "Member", "Trace"];
  const dirs = ["controller", "service", "service/impl", "mapper", "model", "util", "", "web/dto"];
  const out: Record<string, string> = {};
  const modules = pick([[""], ["app", "data"], ["app", "data", "tiny", "libs/base"]]);
  for (const m of modules) {
    const base = m === "" ? "" : `${m}/`;
    out[`${base}pom.xml`] = "<project/>\n";
    const root = `${base}src/main/java/dev/sample/${m === "" ? "shop" : m.replace("/", "")}`;
    for (let i = 0; i < 2 + r() * 14; i++) {
      const dir = pick(dirs);
      const name = `${pick(words)}${pick(["Item", "Service", "Mapper", "X"])}${i}`;
      const path = `${root}/${dir === "" ? "" : `${dir}/`}${name}.${pick(["java", "java", "kt"])}`;
      out[path] = "x\n".repeat(1 + Math.floor(r() * 9));
      if (r() < 0.3) {
        const pkg = `dev.sample.${m === "" ? "shop" : m.replace("/", "")}${dir === "" ? "" : `.${dir.replace("/", ".")}`}`;
        const ns = r() < 0.7 ? `${pkg}.${name}` : "none.N";
        out[`${base}src/main/resources/${pick(["mapper", "mapper", "sql", ""])}/${name}.xml`.replace("//", "/")] =
          `<mapper namespace="${ns}">\n</mapper>\n`;
      }
    }
  }
  if (r() < 0.6) out[`${pick(["tools", "stock", "scripts/x"])}/StockTool.java`] = "x\n";
  return out;
}

describe("draft --parts-by-name invariants on generated trees", () => {
  test.each(Array.from({ length: 40 }, (_, i) => i + 1))("seed %i", (seed) => {
    const tree = layered(seed);
    for (const [n, max] of [["1", "16"], ["2", "3"], ["3", "1"], ["2", "2"]]) {
      const repo = writeRepo(tree);
      const args = ["--parts-by-name", n!, "--max-parts", max!];
      expectDraftInvariants(repo, runDraft(repo, args), null, args);
    }
  });
});
