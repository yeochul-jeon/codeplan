// A part name wider than the label box takes two lines: where it is split,
// the label box and the part's rectangle, the same lines in both pictures,
// and the four lines of text on the page.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { run } from "../src/cli.js";
import { lines, makeRepo } from "./helpers.js";
import { expectPage, width, type Block } from "./page-helpers.js";
import { expectRaised, expectRaisedPage } from "./raised-helpers.js";
import { openViewer } from "./viewer-dom.js";

const PAGE = "docs/codeplan/codeplan.html";

// A page with one part for each name, each with a few lines.
function written(names: string[]): { block: Block; file: string; page: string } {
  const tree: Record<string, string> = { "package.json": lines(1) };
  names.forEach((_, i) => (tree[`src/p${i}/f.ts`] = lines(5 + i)));
  tree["docs/codeplan/plan.json"] = JSON.stringify({
    format: 1,
    name: "wrap",
    about: "",
    parts: names.map((name, i) => ({ id: `p${i}`, name, about: "", paths: [`src/p${i}/**`] })),
  });
  const repo = makeRepo(tree);
  const out = run(["update"], repo);
  expect(out.code, out.stderr).toBe(0);
  const block = expectPage(repo, PAGE);
  expectRaised(block);
  const file = join(repo, PAGE);
  return { block, file, page: readFileSync(file, "utf8") };
}

describe("where a long name is split", () => {
  // [name, first line, second line], or [name] for a name on one line.
  const CASES: [string, string?, string?][] = [
    ["payment-gateway-adapter-for-legacy-card-network", "payment-gateway-adapter-for-", "legacy-card-network"],
    ["order settlement and refund jobs for the night batch", "order settlement and refund", "jobs for the night batch"],
    ["abcdefghijklmnopqrstuvwxyzabcdefghij", "abcdefghijklmnopqrstuvwxyzabcdef", "ghij"],
    ["주문 결제 정산 환불을 맡는 서버 모듈", "주문 결제 정산 환불을 맡는 서버", "모듈"],
    ["abcdefghijklmn가나다라마바사아자차"],
    ["abcdefghijklmnopqrstuvwxyzabc가나", "abcdefghijklmnopqrstuvwxyzabc가", "나"],
    ["\u{1F600}".repeat(20), "\u{1F600}".repeat(17), "\u{1F600}".repeat(3)],
    // Taken as they come out of the rule: a first line of one character,
    // and a second line that starts with a space.
    [".abcdefghijklmnopqrstuvwxyzabcdefghij", ".", "abcdefghijklmnopqrstuvwxyzabcdefghij"],
    ["a".repeat(32) + " tail", "a".repeat(32), " tail"],
  ];

  test("each name gives the lines of the table, in both pictures", () => {
    const { block } = written(CASES.map((c) => c[0]));
    CASES.forEach(([name, first, second], i) => {
      const wrap = first === undefined ? undefined : [first, second];
      expect(block.layout.parts[i]!.label.wrap, name).toEqual(wrap);
      expect(block.raised.parts[i]!.label.wrap, name).toEqual(wrap);
      if (wrap) {
        expect(width(wrap[0]!), name).toBeLessThanOrEqual(228);
        // The first line, the spaces it lost and the second line make the name.
        const lost = name.slice(wrap[0]!.length, name.length - wrap[1]!.length);
        expect(lost, name).toMatch(/^ *$/);
        expect(wrap[0]! + lost + wrap[1]!).toBe(name);
      }
    });
  });

  test("a name 228 wide stays on one line; one 229 wide takes two, in a box 240 by 72", () => {
    const at228 = "abcdefghijklmn" + "가나다라마바사아자차";
    const at229 = "abcdefghijklmnopqrstuvwxyzabc" + "가나";
    expect([width(at228), width(at229)]).toEqual([228, 229]);
    const { block } = written([at228, at229]);
    for (const parts of [block.layout.parts, block.raised.parts]) {
      expect(Object.keys(parts[0]!.label)).toEqual(["x", "y", "w", "h"]);
      expect([parts[0]!.label.w, parts[0]!.label.h]).toEqual([240, 56]);
      expect(Object.keys(parts[1]!.label)).toEqual(["x", "y", "w", "h", "wrap"]);
      expect([parts[1]!.label.w, parts[1]!.label.h]).toEqual([240, 72]);
      expect(parts[1]!.w >= 240 && parts[1]!.h >= 72).toBe(true);
    }
  });
});

describe("the label on the page", () => {
  test("a split name is drawn as two name lines above the counts; a name on one line as one", () => {
    const { block, file, page } = written(["payment-gateway-adapter-for-legacy-card-network", "Cart"]);
    const v = openViewer(file);
    expectRaisedPage(page, v);
    for (const picture of [v.plane, v.raised]) {
      const boxes = picture.children.filter((e) => e.name === "svg" && e.children[0]?.getAttribute("class")?.startsWith("label"));
      const texts = boxes.map((b) => b.children.map((t) => [t.textContent, t.getAttribute("class")]));
      expect(texts).toEqual([
        [
          ["payment-gateway-adapter-for-", "label name"],
          ["legacy-card-network", "label name"],
          [`${block.measure.parts[0]!.lines} lines`, "label"],
          ["1 files", "label"],
        ],
        [["Cart", "label name"], [`${block.measure.parts[1]!.lines} lines`, "label"], ["1 files", "label"]],
      ]);
    }
  });
});
