import { linkSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { run } from "../src/cli.js";
import { lines } from "./helpers.js";
import { runDraft, writeRepo, type Entry } from "./draft-helpers.js";
import {
  MARK,
  agePlace,
  expectPage,
  pageFromCopy,
  placeState,
  treeState,
  type Block,
} from "./page-helpers.js";

// The shared tree: four watched files and a test file.
const K5: Record<string, Entry> = {
  "package.json": lines(1),
  "src/cart/add.ts": lines(3),
  "src/cart/total.ts": lines(2),
  "src/pay/charge.ts": lines(4),
  "src/pay/charge.test.ts": lines(1),
  "src/admin/panel.ts": lines(6),
};

const PLAN = `{
  "format": 1,
  "name": "mall",
  "about": "작은 가게. {cart}가 {pay}를 쓴다.",
  "parts": [
    {"id":"cart","name":"Cart","zone":"store","about":"장바구니","paths":["src/cart/**"],"uses":[{"to":"pay"}]},
    {"id":"pay","name":"Pay","zone":"store","about":"결제","paths":["src/pay/**"]},
    {"id":"admin","name":"Admin","about":"관리 화면","paths":["src/admin/**"]}
  ]
}
`;
const plan = (parts: string[], top = "") =>
  `{\n  "format": 1,\n  "name": "mall",\n  "about": "작은 가게. {cart}가 {pay}를 쓴다.",\n  "parts": [\n    ${parts.join(",\n    ")}\n  ]${top}\n}\n`;
const CART = `{"id":"cart","name":"Cart","zone":"store","about":"장바구니","paths":["src/cart/**"],"uses":[{"to":"pay"}]}`;
const PAY = `{"id":"pay","name":"Pay","zone":"store","about":"결제","paths":["src/pay/**"]}`;
const ADMIN = `{"id":"admin","name":"Admin","about":"관리 화면","paths":["src/admin/**"]}`;
const BASKET = `{"id":"basket","name":"Basket","about":"장바구니 둘째","paths":["src/cart/**"]}`;
const BROKEN_ADMIN = `{"id":"admin","name":"Admin","about":"관리 화면","paths":"src/admin/**"}`;
const CONTESTED = plan([CART, PAY, ADMIN, BASKET]);
const ERROR = plan([CART, PAY, BROKEN_ADMIN]);
const NOT_JSON = '{"format": 1, "parts": [\n';
const NOT_A_PAGE = "<!doctype html>\n<p>notes</p>\n";

interface Expect {
  parts?: Record<string, [files: number, lines: number]>;
  orphans?: string[];
  unwatched?: number;
  zones?: string[];
  a?: Record<string, number>;
  fixed?: Record<string, [w: number, h: number]>;
  titles?: Record<string, number>;
  // Externals with their label width a, edges and connectors, in order.
  externals?: [id: string, a: number][];
  edges?: [from: string, to: string][];
  connectors?: [scenario: string, step: number][];
  more?: (block: Block) => void;
}

const B: Required<Omit<Expect, "more" | "externals" | "edges" | "connectors">> = {
  parts: { cart: [2, 5], pay: [1, 4], admin: [1, 6] },
  orphans: [],
  unwatched: 0,
  zones: ["store"],
  a: { cart: 61, pay: 61, admin: 61 },
  fixed: { cart: [61, 56], pay: [61, 56], admin: [61, 56] },
  titles: { store: 47 },
};

type Step =
  | {
      update: 0 | 1 | 2;
      page: "new" | "rewrite" | "same" | "absent" | "untouched";
      block?: Expect;
      sameLayout?: boolean;
      // The sizes of the part rectangles equal the previous update's (lines
      // can move the parts and widen the frames).
      sameSizes?: boolean;
      // The written page equals the page after this earlier step (1-based).
      sameAs?: number;
    }
  | { check: 0 | 1 | 2; outdated?: boolean }
  | { act: (repo: string) => void };

interface Case {
  name: string;
  tree?: Record<string, Entry>; // replaces the shared tree
  more?: Record<string, Entry>; // added to the tree
  plan?: string | null;
  config?: string;
  home?: string;
  page?: string;
  steps: Step[];
}

const setPlan = (text: string, home = "docs/codeplan") => (repo: string) =>
  writeFileSync(join(repo, home, "plan.json"), text);
const writeText = (path: string, text: string) => (repo: string) => {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
};
const changeByte = (index: (length: number) => number) => (repo: string) => {
  const file = join(repo, "docs/codeplan/codeplan.html");
  const bytes = readFileSync(file);
  const i = index(bytes.length);
  bytes[i] = bytes[i] === 0x20 ? 0x21 : 0x20;
  writeFileSync(file, bytes);
};

function expectBlock(block: Block, e: Expect): void {
  const x = { ...B, ...e };
  expect(Object.fromEntries(block.measure.parts.map((p) => [p.id, [p.files, p.lines]]))).toEqual(x.parts);
  expect(block.measure.parts.map((p) => p.id)).toEqual(Object.keys(x.parts));
  expect(block.orphans).toEqual(x.orphans);
  expect(block.unwatched).toBe(x.unwatched);
  expect(block.layout.zones.map((z) => z.name)).toEqual(x.zones);
  expect(Object.fromEntries(block.layout.parts.map((p) => [p.id, p.label.w]))).toEqual(x.a);
  for (const p of block.layout.parts) expect(p.label.h).toBe(56);
  for (const [id, size] of Object.entries(x.fixed)) {
    const p = block.layout.parts.find((q) => q.id === id)!;
    expect([p.w, p.h], id).toEqual(size);
  }
  expect(Object.fromEntries(block.layout.zones.map((z) => [z.name, z.title.w]))).toEqual(x.titles);
  if (e.externals) expect(block.layout.externals.map((p) => [p.id, p.w])).toEqual(e.externals);
  if (e.edges) expect(block.layout.edges.map((p) => [p.from, p.to])).toEqual(e.edges);
  if (e.connectors) expect(block.layout.connectors.map((p) => [p.scenario, p.step])).toEqual(e.connectors);
  e.more?.(block);
}

function runCase(c: Case): void {
  const home = c.home ?? "docs/codeplan";
  const pagePath = c.page ?? "docs/codeplan/codeplan.html";
  const files: Record<string, Entry> = { ...(c.tree ?? K5), ...c.more };
  const planText = c.plan === undefined ? PLAN : c.plan;
  if (planText !== null) files[`${home}/plan.json`] = planText;
  if (c.config !== undefined) files["codeplan.json"] = c.config;
  for (const [path, entry] of Object.entries(files)) {
    if (entry === null) {
      files[`${path}/keep.txt`] = "keep\n";
      delete files[path];
    }
  }
  const repo = writeRepo(files);
  mkdirSync(join(repo, "docs/codeplan"), { recursive: true });
  const page = join(repo, pagePath);
  const written: string[] = [];
  let lastLayout: unknown = null;

  c.steps.forEach((step, i) => {
    const label = `step ${i + 1}`;
    if ("act" in step) {
      step.act(repo);
      return;
    }
    if ("check" in step) {
      const before = treeState(repo);
      const out = run(["check"], repo);
      expect(treeState(repo), label).toEqual(before);
      expect(out.code, `${label}\n${out.stderr}`).toBe(step.check);
      if (step.outdated !== undefined) {
        const said = (out.stdout + out.stderr).split("\n").some((l) => !l.startsWith("check:") && l.includes("outdated"));
        expect(said, label).toBe(step.outdated);
      }
      written.push("");
      return;
    }
    agePlace(page);
    const before = placeState(page);
    const out = run(["update"], repo);
    expect(out.code, `${label}\n${out.stderr}`).toBe(step.update);
    const after = placeState(page);
    if (step.page === "new") {
      expect(before.kind).toBe("absent");
      expect(after.kind).toBe("file");
    } else if (step.page === "rewrite") {
      expect(after.kind).toBe("file");
      expect(after.bytes).not.toBe(before.bytes);
    } else if (step.page === "absent") {
      expect(after.kind).toBe("absent");
    } else {
      expect(after, label).toEqual(before);
    }
    if (["new", "rewrite", "same"].includes(step.page)) {
      expect(after.bytes!.startsWith(MARK)).toBe(true);
      const block = expectPage(repo, pagePath);
      if (step.block) expectBlock(block, step.block);
      if (step.sameLayout) expect(block.layout).toEqual(lastLayout);
      if (step.sameSizes) {
        const sizes = (l: Block["layout"]) => l.parts.map((p) => [p.id, p.w, p.h, p.label.w, p.label.h]);
        expect(sizes(block.layout)).toEqual(sizes(lastLayout as Block["layout"]));
        expect(block.layout.zones.map((z) => z.name)).toEqual((lastLayout as Block["layout"]).zones.map((z) => z.name));
      }
      if (step.sameAs !== undefined) expect(after.bytes).toBe(written[step.sameAs - 1]);
      lastLayout = block.layout;
      // Again at once: nothing to write. From a copy elsewhere: the same bytes.
      agePlace(page);
      const again = placeState(page);
      expect(run(["update"], repo).code).toBe(0);
      expect(placeState(page)).toEqual(again);
      expect(pageFromCopy(repo, pagePath)).toBe(after.bytes);
    }
    written.push(after.bytes ?? "");
  });
}

const CASES: Case[] = [
  // ---- when the page is written, and outdated ----
  {
    name: "no page yet: check says outdated, update writes it",
    steps: [{ check: 1, outdated: true }, { update: 0, page: "new", block: {} }, { check: 0, outdated: false }],
  },
  {
    name: "update twice on the same tree writes once",
    steps: [{ update: 0, page: "new", block: {} }, { update: 0, page: "same", block: {} }, { check: 0 }],
  },
  {
    name: "a code file's line count changes",
    steps: [
      { update: 0, page: "new", block: {} },
      { act: writeText("src/cart/add.ts", lines(9)) },
      { check: 1, outdated: true },
      {
        update: 0,
        page: "rewrite",
        block: {
          parts: { cart: [2, 11], pay: [1, 4], admin: [1, 6] },
          a: { cart: 68, pay: 61, admin: 61 },
          fixed: { cart: [68, 56], pay: [61, 56], admin: [61, 56] },
        },
      },
      { check: 0 },
    ],
  },
  {
    name: "one text field of the plan changes; the layout stays",
    steps: [
      { update: 0, page: "new", block: {} },
      { act: setPlan(plan([CART, PAY.replace('"결제"', '"카드 결제"'), ADMIN])) },
      { check: 1, outdated: true },
      {
        update: 0,
        page: "rewrite",
        sameLayout: true,
        block: { more: (b) => expect((b.plan.parts[1] as unknown as { about: string }).about).toBe("카드 결제") },
      },
      { check: 0 },
    ],
  },
  {
    name: "an orphan appears, then goes away when a part takes it",
    steps: [
      { update: 0, page: "new", block: {} },
      { check: 0 },
      { act: writeText("src/promo/code.ts", lines(1)) },
      { update: 0, page: "rewrite", block: { orphans: ["src/promo/code.ts"] } },
      { check: 1, outdated: false },
      { act: setPlan(plan([CART, PAY, ADMIN, `{"id":"promo","name":"Promo","about":"할인 코드","paths":["src/promo/**"]}`])) },
      {
        update: 0,
        page: "rewrite",
        block: {
          parts: { cart: [2, 5], pay: [1, 4], admin: [1, 6], promo: [1, 1] },
          a: { cart: 61, pay: 61, admin: 61, promo: 61 },
          fixed: { cart: [61, 56], pay: [61, 56], admin: [61, 56], promo: [61, 56] },
        },
      },
      { check: 0 },
    ],
  },
  {
    name: "unwatched files and warnings do not stop update",
    more: { "tools/gen.mjs": lines(2) },
    config: '{ "watch": ["src/**/*.ts"] }',
    plan: plan([CART, PAY, ADMIN], `,\n  "externals": [\n    {"id":"bank","name":"Bank","about":"은행"}\n  ]`),
    steps: [
      {
        update: 0,
        page: "new",
        block: { unwatched: 1, more: (b) => expect(b.layout.externals.map((x) => [x.id, x.w])).toEqual([["bank", 68]]) },
      },
      { check: 1 },
    ],
  },
  {
    name: "contested files and no page: nothing is written and check does not compare",
    plan: CONTESTED,
    steps: [{ update: 1, page: "absent" }, { check: 1, outdated: false }],
  },
  {
    name: "contested files and an old page: the page is left as it is",
    steps: [
      { update: 0, page: "new", block: {} },
      { act: setPlan(CONTESTED) },
      { update: 1, page: "untouched" },
      { check: 1, outdated: false },
    ],
  },
  {
    name: "an error diagnostic and no page, then fixed",
    plan: ERROR,
    steps: [
      { update: 2, page: "absent" },
      { check: 2 },
      { act: setPlan(PLAN) },
      { update: 0, page: "new", block: {} },
      { check: 0 },
    ],
  },
  {
    name: "an error diagnostic with a page, then put back",
    steps: [
      { update: 0, page: "new", block: {} },
      { act: setPlan(ERROR) },
      { update: 2, page: "untouched" },
      { check: 2 },
      { act: setPlan(PLAN) },
      { update: 0, page: "same", block: {} },
      { check: 0 },
    ],
  },
  {
    name: "no plan file and no page",
    plan: null,
    steps: [{ update: 0, page: "absent" }, { check: 1 }],
  },
  {
    name: "no plan file and an old page",
    steps: [
      { update: 0, page: "new", block: {} },
      { act: (repo) => rmSync(join(repo, "docs/codeplan/plan.json")) },
      { update: 0, page: "untouched" },
      { check: 1, outdated: false },
    ],
  },
  { name: "a plan that is not JSON and no page", plan: NOT_JSON, steps: [{ update: 2, page: "absent" }, { check: 2 }] },
  {
    name: "a plan that is not JSON and a page",
    steps: [
      { update: 0, page: "new", block: {} },
      { act: setPlan(NOT_JSON) },
      { update: 2, page: "untouched" },
      { check: 2 },
    ],
  },
  ...['{ "watch": [ }', '{ "languages": [] }', '{ "languages": ["js", "js"] }', '{ "languages": ["pascal"] }', '{ "include": ["src/**"] }'].map(
    (config): Case => ({
      name: `a config error leaves the page (${config})`,
      steps: [
        { update: 0, page: "new", block: {} },
        { act: writeText("codeplan.json", `${config}\n`) },
        { update: 2, page: "untouched" },
        { check: 2 },
      ],
    }),
  ),
  ...([
    ["outside home", '{ "page": "site/codeplan.html" }', "site/codeplan.html"],
    ["outside the repository", '{ "page": "../outside.html" }', "../outside.html"],
    ["outside a changed home", '{ "home": "plan", "page": "docs/codeplan/codeplan.html" }', "docs/codeplan/codeplan.html"],
  ] as [string, string, string][]).map(([what, config, pagePath]): Case => ({
    name: `a page ${what} is a config error`,
    config,
    home: config.includes('"home"') ? "plan" : undefined,
    page: pagePath,
    steps: [{ update: 2, page: "absent" }, { check: 2 }],
  })),
  {
    name: "a page with another name under home",
    config: '{ "page": "docs/codeplan/map.html" }',
    page: "docs/codeplan/map.html",
    steps: [
      { update: 0, page: "new", block: {} },
      { check: 0 },
      { act: (repo) => expect(placeState(join(repo, "docs/codeplan/codeplan.html")).kind).toBe("absent") },
    ],
  },
  ...([
    ["other HTML", { "docs/codeplan/codeplan.html": NOT_A_PAGE }],
    ["an empty file", { "docs/codeplan/codeplan.html": "" }],
    ["a space before the mark", { "docs/codeplan/codeplan.html": ` ${MARK}\n<p>a page made elsewhere</p>\n` }],
    ["the mark in other case", { "docs/codeplan/codeplan.html": "<!DOCTYPE html><!-- codeplan page -->\n" }],
    ["a directory", { "docs/codeplan/codeplan.html": null }],
    [
      "a symbolic link to a page",
      { "docs/codeplan/real.html": `${MARK}\n<p>a page made elsewhere</p>\n`, "docs/codeplan/codeplan.html": { link: "real.html" } },
    ],
  ] as [string, Record<string, Entry>][]).map(([what, more]): Case => ({
    name: `the page place holds ${what}: both exit 2 and leave it`,
    more,
    steps: [{ update: 2, page: "untouched" }, { check: 2 }],
  })),
  ...([
    ["the byte after the mark", () => 37],
    ["the last byte", (n: number) => n - 1],
  ] as [string, (n: number) => number][]).map(([what, index]): Case => ({
    name: `a page changed by hand at ${what} is outdated, and update puts it back`,
    steps: [
      { update: 0, page: "new", block: {} },
      { act: changeByte(index) },
      { check: 1, outdated: true },
      { update: 0, page: "rewrite", block: {}, sameAs: 1 },
      { check: 0 },
    ],
  })),
  {
    name: "a page whose mark was changed by hand is not a codeplan page",
    steps: [
      { update: 0, page: "new", block: {} },
      {
        act: (repo) => {
          const file = join(repo, "docs/codeplan/codeplan.html");
          const bytes = readFileSync(file);
          bytes[20] = "C".charCodeAt(0);
          writeFileSync(file, bytes);
        },
      },
      { update: 2, page: "untouched" },
      { check: 2 },
    ],
  },
  {
    name: "not a page and no plan: not a page comes first",
    plan: null,
    more: { "docs/codeplan/codeplan.html": NOT_A_PAGE },
    steps: [{ update: 2, page: "untouched" }, { check: 2 }],
  },
  {
    name: "not a page and contested files: not a page comes first",
    plan: CONTESTED,
    more: { "docs/codeplan/codeplan.html": NOT_A_PAGE },
    steps: [{ update: 2, page: "untouched" }, { check: 2 }],
  },
  {
    name: "an error diagnostic and contested files: the error comes first",
    plan: plan([CART, PAY, BROKEN_ADMIN, BASKET]),
    steps: [{ update: 2, page: "absent" }, { check: 2 }],
  },
  {
    name: "a config error and not a page: the file is left",
    config: '{ "watch": [ }',
    more: { "docs/codeplan/codeplan.html": NOT_A_PAGE },
    steps: [{ update: 2, page: "untouched" }, { check: 2 }],
  },

  // ---- the page file ----
  {
    name: "< > & U+2028 U+2029 and a closing tag in plan text",
    plan: JSON.stringify(
      {
        format: 1,
        name: "mall",
        about: "닫는 태그 </script> 와 <b>굵게</b>, a & b, x > y, 글자 그대로의 \\u003c",
        parts: [
          {
            id: "cart", name: "Cart", zone: "store", about: "장바구니", paths: ["src/cart/**"], uses: [{ to: "pay" }],
            note: '<script type="application/json" id="codeplan-data">',
          },
          { id: "pay", name: "Pay", zone: "store", about: "줄 나눔\u2028문단 나눔\u2029끝", paths: ["src/pay/**"] },
          { id: "admin", name: "<Admin>", about: "관리 & 설정", paths: ["src/admin/**"] },
        ],
      },
      null,
      2,
    ),
    steps: [{ update: 0, page: "new", block: {} }, { check: 0 }],
  },
  {
    name: "quotes and a backslash in file names",
    more: { "misc/o'clock.ts": lines(1), 'misc/say"hi".ts': lines(1), "misc/back\\slash.ts": lines(1) },
    steps: [
      { update: 0, page: "new", block: { orphans: ["misc/back\\slash.ts", "misc/o'clock.ts", 'misc/say"hi".ts'] } },
      { update: 0, page: "same" },
      { check: 1, outdated: false },
    ],
  },
  {
    name: "note and key order are kept; part sizes stay",
    steps: [
      { update: 0, page: "new", block: {} },
      {
        act: setPlan(`{
  "note": "최상위 메모",
  "name": "mall",
  "format": 1,
  "parts": [
    {"paths":["src/cart/**"],"id":"cart","note":"장바구니 메모","name":"Cart","zone":"store","about":"장바구니","uses":[{"note":"쓰임 메모","to":"pay","why":"값을 낸다"}]},
    {"zone":"store","id":"pay","name":"Pay","about":"결제","paths":["src/pay/**"],"uses":[{"to":"bank"}]},
    {"id":"admin","name":"Admin","about":"관리 화면","paths":["src/admin/**"]}
  ],
  "about": "작은 가게",
  "externals": [
    {"about":"카드사","id":"bank","name":"Bank","note":"바깥 메모"}
  ],
  "scenarios": [
    {"steps":[{"at":"cart","does":"담는다","note":"단계 메모"},{"does":"낸다","at":"pay"}],"id":"buy","name":"사기","note":"시나리오 메모"}
  ]
}
`),
      },
      {
        update: 0,
        page: "rewrite",
        sameSizes: true,
        block: {
          more: (b) => expect(Object.keys(b.plan)).toEqual(["note", "name", "format", "parts", "about", "externals", "scenarios"]),
        },
      },
      { check: 0 },
    ],
  },
  {
    name: "orphans in code-unit order",
    more: { "src/Zeta.ts": lines(1), "src/alpha.ts": lines(1), "src/_x.ts": lines(1), "src/éclair.ts": lines(1) },
    steps: [
      { update: 0, page: "new", block: { orphans: ["src/Zeta.ts", "src/_x.ts", "src/alpha.ts", "src/éclair.ts"] } },
      { check: 1 },
    ],
  },
  {
    name: "no time and no directory name in the page",
    steps: [
      { update: 0, page: "new", block: {} },
      {
        act: (repo) => {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1100);
          const page = readFileSync(join(repo, "docs/codeplan/codeplan.html"), "latin1");
          expect(pageFromCopy(repo, "docs/codeplan/codeplan.html")).toBe(page);
        },
      },
    ],
  },

  // ---- the plane layout ----
  {
    name: "label widths",
    tree: {
      "package.json": lines(1),
      "src/orders/list.ts": lines(8),
      "src/refund/a.ts": lines(12),
      "src/misc/m.ts": lines(3),
      "src/big/core.ts": lines(1234),
      "src/jamo/j.ts": lines(2),
      "src/emoji/e.ts": lines(2),
    },
    plan: JSON.stringify({
      format: 1,
      name: "labels",
      about: "",
      parts: [
        { id: "orders", name: "Order history and refund processing service", about: "", paths: ["src/orders/**"] },
        { id: "refund", name: "결제와 환불", about: "", paths: ["src/refund/**"] },
        { id: "misc", name: "", about: "", paths: ["src/misc/**"] },
        { id: "big", name: "Io", about: "", paths: ["src/big/**"] },
        { id: "jamo", name: "ᄀᄀᄀᄀᄀჿჿჿჿჿ", about: "", paths: ["src/jamo/**"] },
        { id: "emoji", name: "\u{1f600}\u{1f600}\u{1f600}\u{1f600}\u{1f600}", about: "", paths: ["src/emoji/**"] },
      ],
    }),
    steps: [
      {
        update: 0,
        page: "new",
        block: {
          parts: { orders: [1, 8], refund: [1, 12], misc: [1, 3], big: [1, 1234], jamo: [1, 2], emoji: [1, 2] },
          zones: [],
          a: { orders: 240, refund: 84, misc: 61, big: 82, jamo: 112, emoji: 77 },
          fixed: { orders: [240, 56], refund: [84, 56], misc: [61, 56], jamo: [112, 56], emoji: [77, 56] },
          titles: {},
          more: (b) => {
            const big = b.layout.parts.find((p) => p.id === "big")!;
            const area = big.w * big.h;
            expect(area ** 2 >= 197440000 && area ** 2 <= 308500000).toBe(true);
          },
        },
      },
      { check: 0 },
    ],
  },
  {
    name: "a part with zero lines and a part with no files",
    more: { "src/blank/empty.ts": "" },
    plan: plan([
      CART, PAY, ADMIN,
      `{"id":"blank","name":"Blank","about":"","paths":["src/blank/**"]}`,
      `{"id":"ghost","name":"Ghost","about":"","paths":["src/ghost/**"]}`,
    ]),
    steps: [
      {
        update: 0,
        page: "new",
        block: {
          parts: { cart: [2, 5], pay: [1, 4], admin: [1, 6], blank: [1, 0], ghost: [0, 0] },
          a: { cart: 61, pay: 61, admin: 61, blank: 61, ghost: 61 },
          fixed: { cart: [61, 56], pay: [61, 56], admin: [61, 56], blank: [61, 56], ghost: [61, 56] },
        },
      },
      { check: 1 },
    ],
  },
  {
    name: "zone frames and titles",
    tree: {
      "package.json": lines(1),
      "src/edge/e.ts": lines(2),
      "src/gate/a.ts": lines(3),
      "src/vault/d.ts": lines(4),
      "src/ui/u.ts": lines(5),
      "src/card/c.ts": lines(6),
      "src/log/l.ts": lines(7),
      "src/tool/t.ts": lines(8),
    },
    plan: JSON.stringify({
      format: 1,
      name: "zones",
      about: "",
      parts: [
        { id: "edge", name: "Edge", zone: "a-very-long-zone-name-that-goes-past-the-title-cap", about: "", paths: ["src/edge/**"] },
        { id: "gate", name: "Gate", zone: "core", about: "", paths: ["src/gate/**"] },
        { id: "vault", name: "Vault", zone: "core", about: "", paths: ["src/vault/**"] },
        { id: "ui", name: "UI", zone: "front", about: "", paths: ["src/ui/**"] },
        { id: "card", name: "Card", zone: "결제영역", about: "", paths: ["src/card/**"] },
        { id: "log", name: "Log", zone: "", about: "", paths: ["src/log/**"] },
        { id: "tool", name: "Tool", about: "", paths: ["src/tool/**"] },
      ],
    }),
    steps: [
      {
        update: 0,
        page: "new",
        block: {
          parts: { edge: [1, 2], gate: [1, 3], vault: [1, 4], ui: [1, 5], card: [1, 6], log: [1, 7], tool: [1, 8] },
          zones: ["a-very-long-zone-name-that-goes-past-the-title-cap", "core", "front", "결제영역"],
          a: { edge: 61, gate: 61, vault: 61, ui: 61, card: 61, log: 61, tool: 61 },
          fixed: { edge: [61, 56], gate: [61, 56], vault: [61, 56], ui: [61, 56], card: [61, 56], log: [61, 56], tool: [61, 56] },
          titles: { "a-very-long-zone-name-that-goes-past-the-title-cap": 240, core: 40, front: 47, 결제영역: 64 },
        },
      },
      { check: 0 },
    ],
  },
  {
    name: "one part in one zone",
    plan: JSON.stringify({ format: 1, name: "one", about: "", parts: [{ id: "all", name: "All", zone: "solo", about: "", paths: ["src/**"] }] }),
    steps: [
      {
        update: 0,
        page: "new",
        block: { parts: { all: [4, 15] }, zones: ["solo"], a: { all: 68 }, fixed: { all: [68, 56] }, titles: { solo: 40 } },
      },
      { check: 0 },
    ],
  },
  {
    name: "a plan with no parts: a 1 by 1 canvas",
    plan: JSON.stringify({ format: 1, name: "empty", about: "", parts: [] }),
    steps: [
      {
        update: 0,
        page: "new",
        block: {
          parts: {},
          orphans: ["src/admin/panel.ts", "src/cart/add.ts", "src/cart/total.ts", "src/pay/charge.ts"],
          zones: [],
          a: {},
          fixed: {},
          titles: {},
          more: (b) => expect([b.layout.width, b.layout.height, b.measure.files, b.measure.lines]).toEqual([1, 1, 0, 0]),
        },
      },
      { check: 1 },
    ],
  },
  (() => {
    const tree: Record<string, Entry> = { "package.json": lines(1) };
    const parts: unknown[] = [];
    const expected: Record<string, [number, number]> = {};
    const a: Record<string, number> = {};
    const fixed: Record<string, [number, number]> = {};
    for (let i = 0; i < 60; i++) {
      const id = `m${String(i).padStart(2, "0")}`;
      const n = ((37 * i) % 150) + 1;
      tree[`src/${id}/f.ts`] = lines(n);
      const zone = ["alpha", "beta", "gamma", "", undefined][i % 5];
      parts.push({ id, name: `Module ${String(i).padStart(2, "0")}`, ...(zone === undefined ? {} : { zone }), about: "", paths: [`src/${id}/**`] });
      expected[id] = [1, n];
      a[id] = 75;
      if (n <= 70) fixed[id] = [75, 56];
    }
    return {
      name: "sixty parts",
      tree,
      plan: JSON.stringify({ format: 1, name: "many", about: "part 60개", parts }),
      steps: [
        {
          update: 0,
          page: "new",
          block: { parts: expected, zones: ["alpha", "beta", "gamma"], a, fixed, titles: { alpha: 47, beta: 40, gamma: 47 } },
        },
        { check: 0 },
      ],
    } satisfies Case;
  })(),
  {
    name: "a new parts order is followed everywhere",
    steps: [
      { update: 0, page: "new", block: {} },
      { act: setPlan(plan([ADMIN, CART, PAY])) },
      { update: 0, page: "rewrite", block: { parts: { admin: [1, 6], cart: [2, 5], pay: [1, 4] } } },
      { check: 0 },
    ],
  },
  {
    name: "one part with a wide label keeps the canvas ratio",
    plan: JSON.stringify({ format: 1, name: "wide", about: "", parts: [{ id: "all", name: "Everything in this small shop repository", about: "", paths: ["src/**"] }] }),
    steps: [
      {
        update: 0,
        page: "new",
        block: {
          parts: { all: [4, 15] },
          zones: [],
          a: { all: 240 },
          fixed: { all: [240, 56] },
          titles: {},
          more: (b) => expect(b.layout.height).toBeGreaterThanOrEqual(86),
        },
      },
      { check: 0 },
    ],
  },

  // ---- details settled later ----
  {
    name: "update makes the page's directory",
    config: '{ "page": "docs/codeplan/view/map.html" }',
    page: "docs/codeplan/view/map.html",
    steps: [
      { update: 0, page: "new", block: {} },
      { check: 0 },
      { act: (repo) => expect(placeState(join(repo, "docs/codeplan/codeplan.html")).kind).toBe("absent") },
    ],
  },
  {
    name: "a key twice in one object: the last value at the first place",
    plan: `{
  "format": 1,
  "name": "old-name",
  "about": "작은 가게. {cart}가 {pay}를 쓴다.",
  "name": "mall",
  "parts": [
    {"id":"cart","name":"Cart","zone":"store","about":"장바구니","paths":["src/cart/**"],"uses":[{"to":"pay"}]},
    {"id":"pay","name":"Pay","zone":"store","about":"옛 설명","paths":["src/pay/**"],"about":"결제"},
    {"id":"admin","name":"Admin","about":"관리 화면","paths":["src/admin/**"]}
  ]
}
`,
    steps: [
      {
        update: 0,
        page: "new",
        block: {
          more: (b) => {
            expect(b.plan.name).toBe("mall");
            expect(Object.keys(b.plan)).toEqual(["format", "name", "about", "parts"]);
            expect(Object.keys(b.plan.parts[1]!)).toEqual(["id", "name", "zone", "about", "paths"]);
            expect((b.plan.parts[1] as unknown as { about: string }).about).toBe("결제");
          },
        },
      },
      { check: 0 },
    ],
  },
  {
    name: "< > & in file names",
    more: { "src/a&b.ts": lines(1), "src/<x>.ts": lines(1) },
    steps: [{ update: 0, page: "new", block: { orphans: ["src/<x>.ts", "src/a&b.ts"] } }, { check: 1, outdated: false }],
  },
  {
    name: "& and < in zone names",
    plan: plan([
      CART.replace('"zone":"store"', '"zone":"store & <b>"'),
      PAY.replace('"zone":"store"', '"zone":"store & <b>"'),
      `{"id":"admin","name":"Admin","about":"관리 화면","paths":["src/admin/**"],"zone":"<ops>"}`,
    ]),
    steps: [
      { update: 0, page: "new", block: { zones: ["<ops>", "store & <b>"], titles: { "<ops>": 47, "store & <b>": 89 } } },
      { check: 0 },
    ],
  },
  {
    name: "a page with CRLF line ends is outdated, and update puts LF back",
    steps: [
      { update: 0, page: "new", block: {} },
      {
        act: (repo) => {
          const file = join(repo, "docs/codeplan/codeplan.html");
          writeFileSync(file, readFileSync(file, "utf8").replace(/\n/g, "\r\n"));
        },
      },
      { check: 1, outdated: true },
      { update: 0, page: "rewrite", block: {}, sameAs: 1 },
      { check: 0 },
    ],
  },
  {
    name: "only key order changes: the page changes, the layout stays",
    steps: [
      { update: 0, page: "new", block: {} },
      {
        act: setPlan(`{
  "parts": [
    {"paths":["src/cart/**"],"uses":[{"to":"pay"}],"about":"장바구니","zone":"store","name":"Cart","id":"cart"},
    {"paths":["src/pay/**"],"about":"결제","zone":"store","name":"Pay","id":"pay"},
    {"paths":["src/admin/**"],"about":"관리 화면","name":"Admin","id":"admin"}
  ],
  "about": "작은 가게. {cart}가 {pay}를 쓴다.",
  "name": "mall",
  "format": 1
}
`),
      },
      { check: 1, outdated: true },
      {
        update: 0,
        page: "rewrite",
        sameLayout: true,
        block: { more: (b) => expect(Object.keys(b.plan)).toEqual(["parts", "about", "name", "format"]) },
      },
      { check: 0 },
    ],
  },

  // ---- externals, edges and connectors ----
  {
    name: "external rectangles and labels",
    plan: JSON.stringify({
      format: 1, name: "mall", about: "",
      parts: [
        { id: "cart", name: "Cart", zone: "store", about: "", paths: ["src/cart/**"], uses: [{ to: "pay" }, { to: "ledger" }] },
        { id: "pay", name: "Pay", zone: "store", about: "", paths: ["src/pay/**"] },
        { id: "admin", name: "Admin", about: "", paths: ["src/admin/**"] },
      ],
      externals: [
        { id: "ledger", name: "Ledger", about: "" },
        { id: "logs", name: "", about: "" },
        { id: "archive", name: "결제 기록 저장소", about: "" },
        { id: "vendor", name: "Vendor settlement and payout gateway API", about: "" },
      ],
    }),
    steps: [
      {
        update: 0, page: "new",
        block: { externals: [["ledger", 68], ["logs", 68], ["archive", 117], ["vendor", 240]], edges: [["cart", "pay"], ["cart", "ledger"]], connectors: [] },
      },
      { check: 1 },
    ],
  },
  (() => {
    const ids = Array.from({ length: 12 }, (_, i) => `e${String(i + 1).padStart(2, "0")}`);
    return {
      name: "twelve externals",
      plan: JSON.stringify({
        format: 1, name: "mall", about: "",
        parts: [
          { id: "cart", name: "Cart", zone: "store", about: "", paths: ["src/cart/**"], uses: ids.map((to) => ({ to })) },
          { id: "pay", name: "Pay", zone: "store", about: "", paths: ["src/pay/**"] },
          { id: "admin", name: "Admin", about: "", paths: ["src/admin/**"] },
        ],
        externals: ids.map((id, i) => ({ id, name: `External system ${String(i + 1).padStart(2, "0")}`, about: "" })),
      }),
      steps: [
        { update: 0, page: "new", block: { externals: ids.map((id) => [id, 138]), edges: ids.map((id) => ["cart", id]), connectors: [] } },
        { check: 0 },
      ],
    } satisfies Case;
  })(),
  {
    name: "externals without parts",
    plan: JSON.stringify({ format: 1, name: "only", about: "", parts: [], externals: [{ id: "ledger", name: "Ledger", about: "" }] }),
    steps: [
      {
        update: 0, page: "new",
        block: {
          parts: {}, a: {}, fixed: {}, zones: [], titles: {},
          orphans: ["src/admin/panel.ts", "src/cart/add.ts", "src/cart/total.ts", "src/pay/charge.ts"],
          externals: [["ledger", 68]], edges: [], connectors: [],
          more: (b) => expect(b.layout.width > 1 && b.layout.height > 1).toBe(true),
        },
      },
      { check: 1 },
    ],
  },
  {
    name: "edge order, a repeated target, the part itself and the other direction",
    plan: JSON.stringify({
      format: 1, name: "mall", about: "",
      parts: [
        { id: "cart", name: "Cart", zone: "store", about: "", paths: ["src/cart/**"], uses: [{ to: "pay" }, { to: "pay" }, { to: "cart" }, { to: "ledger" }] },
        { id: "pay", name: "Pay", zone: "store", about: "", paths: ["src/pay/**"], uses: [{ to: "cart" }] },
        { id: "admin", name: "Admin", about: "", paths: ["src/admin/**"], uses: [{ to: "ledger" }, { to: "pay" }] },
      ],
      externals: [{ id: "ledger", name: "Ledger", about: "" }],
    }),
    steps: [
      {
        update: 0, page: "new",
        block: { externals: [["ledger", 68]], edges: [["cart", "pay"], ["cart", "ledger"], ["pay", "cart"], ["admin", "ledger"], ["admin", "pay"]], connectors: [] },
      },
      { check: 1 },
    ],
  },
  {
    name: "only the uses order changes: the edges follow, parts and zones stay",
    plan: JSON.stringify({
      format: 1, name: "mall", about: "",
      parts: [
        { id: "cart", name: "Cart", zone: "store", about: "", paths: ["src/cart/**"], uses: [{ to: "pay" }, { to: "ledger" }] },
        { id: "pay", name: "Pay", zone: "store", about: "", paths: ["src/pay/**"] },
        { id: "admin", name: "Admin", about: "", paths: ["src/admin/**"] },
      ],
      externals: [{ id: "ledger", name: "Ledger", about: "" }],
    }),
    steps: [
      { update: 0, page: "new", block: { edges: [["cart", "pay"], ["cart", "ledger"]] } },
      {
        act: setPlan(JSON.stringify({
          format: 1, name: "mall", about: "",
          parts: [
            { id: "cart", name: "Cart", zone: "store", about: "", paths: ["src/cart/**"], uses: [{ to: "ledger" }, { to: "pay" }] },
            { id: "pay", name: "Pay", zone: "store", about: "", paths: ["src/pay/**"] },
            { id: "admin", name: "Admin", about: "", paths: ["src/admin/**"] },
          ],
          externals: [{ id: "ledger", name: "Ledger", about: "" }],
        })),
      },
      { update: 0, page: "rewrite", sameSizes: true, block: { edges: [["cart", "ledger"], ["cart", "pay"]] } },
      { check: 0 },
    ],
  },
  {
    name: "adding relations, an external and scenarios leaves part sizes",
    plan: JSON.stringify({
      format: 1, name: "mall", about: "",
      parts: [
        { id: "cart", name: "Cart", zone: "store", about: "", paths: ["src/cart/**"] },
        { id: "pay", name: "Pay", zone: "store", about: "", paths: ["src/pay/**"] },
        { id: "admin", name: "Admin", about: "", paths: ["src/admin/**"] },
      ],
    }),
    steps: [
      { update: 0, page: "new", block: { externals: [], edges: [], connectors: [] } },
      {
        act: setPlan(JSON.stringify({
          format: 1, name: "mall", about: "",
          parts: [
            { id: "cart", name: "Cart", zone: "store", about: "", paths: ["src/cart/**"], uses: [{ to: "pay" }] },
            { id: "pay", name: "Pay", zone: "store", about: "", paths: ["src/pay/**"], uses: [{ to: "ledger" }] },
            { id: "admin", name: "Admin", about: "", paths: ["src/admin/**"] },
          ],
          externals: [{ id: "ledger", name: "Ledger", about: "" }],
          scenarios: [
            {
              id: "buy", name: "사기",
              steps: [
                { at: "cart", does: "장바구니를 연다" }, { at: "pay", does: "{cart}에서 값을 받아 {db}에 적는다 {nope}" },
                { at: "pay", does: "영수증을 만든다" }, { at: "cart", does: "돌아간다" }, { at: "ledger", does: "기록을 남긴다" },
              ],
            },
            { id: "empty", name: "빈 것", steps: [] },
          ],
        })),
      },
      {
        update: 0, page: "rewrite", sameSizes: true,
        block: { externals: [["ledger", 68]], edges: [["cart", "pay"], ["pay", "ledger"]], connectors: [["buy", 4]] },
      },
      { check: 1 },
    ],
  },
  {
    name: "edges between parts with other parts between them",
    tree: Object.fromEntries([["package.json", lines(1)], ...Array.from({ length: 9 }, (_, i) => [`src/p${i + 1}/f.ts`, lines(2)])]),
    plan: JSON.stringify({
      format: 1, name: "row", about: "",
      parts: Array.from({ length: 9 }, (_, i) => {
        const uses = { 1: "p9", 2: "p8", 3: "p7", 9: "p5" }[i + 1];
        return { id: `p${i + 1}`, name: `P${i + 1}`, about: "", paths: [`src/p${i + 1}/**`], ...(uses ? { uses: [{ to: uses }] } : {}) };
      }),
    }),
    steps: [
      {
        update: 0, page: "new",
        block: {
          parts: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`p${i + 1}`, [1, 2]])),
          a: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`p${i + 1}`, 61])),
          fixed: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`p${i + 1}`, [61, 56]])),
          zones: [], titles: {},
          externals: [], edges: [["p1", "p9"], ["p2", "p8"], ["p3", "p7"], ["p9", "p5"]], connectors: [],
        },
      },
      { check: 0 },
    ],
  },
  {
    name: "connectors where steps have no edge",
    plan: JSON.stringify({
      format: 1, name: "mall", about: "",
      parts: [
        { id: "cart", name: "Cart", zone: "store", about: "", paths: ["src/cart/**"], uses: [{ to: "pay" }] },
        { id: "pay", name: "Pay", zone: "store", about: "", paths: ["src/pay/**"] },
        { id: "admin", name: "Admin", about: "", paths: ["src/admin/**"], uses: [{ to: "cart" }] },
      ],
      externals: [{ id: "ledger", name: "Ledger", about: "" }],
      scenarios: [
        { id: "buy", name: "사기", steps: [{ at: "cart", does: "담는다" }, { at: "pay", does: "값을 낸다" }, { at: "pay", does: "영수증" }, { at: "ledger", does: "적는다" }, { at: "admin", does: "본다" }] },
        { id: "audit", name: "살피기", steps: [{ at: "admin", does: "연다" }, { at: "cart", does: "본다" }, { at: "admin", does: "닫는다" }] },
      ],
    }),
    steps: [
      { update: 0, page: "new", block: { externals: [["ledger", 68]], edges: [["cart", "pay"], ["admin", "cart"]], connectors: [["buy", 3], ["buy", 4]] } },
      { check: 1 },
    ],
  },
  {
    name: "the same two places twice give the same connector points",
    plan: JSON.stringify({
      format: 1, name: "mall", about: "",
      parts: [
        { id: "cart", name: "Cart", zone: "store", about: "", paths: ["src/cart/**"] },
        { id: "pay", name: "Pay", zone: "store", about: "", paths: ["src/pay/**"] },
        { id: "admin", name: "Admin", about: "", paths: ["src/admin/**"] },
      ],
      externals: [{ id: "ledger", name: "Ledger", about: "" }],
      scenarios: [{ id: "loop", name: "되풀이", steps: [{ at: "admin", does: "묻는다" }, { at: "ledger", does: "답한다" }, { at: "admin", does: "다시 묻는다" }, { at: "ledger", does: "다시 답한다" }] }],
    }),
    steps: [
      {
        update: 0, page: "new",
        block: {
          externals: [["ledger", 68]], edges: [], connectors: [["loop", 1], ["loop", 2], ["loop", 3]],
          more: (b) => expect(b.layout.connectors[0]!.points).toEqual(b.layout.connectors[2]!.points),
        },
      },
      { check: 1 },
    ],
  },
  (() => {
    const tree: Record<string, Entry> = { "package.json": lines(1) };
    const parts: unknown[] = [];
    for (let i = 0; i < 60; i++) {
      const id = `m${String(i).padStart(2, "0")}`;
      tree[`src/${id}/f.ts`] = lines(((37 * i) % 150) + 1);
      const zone = ["alpha", "beta", "gamma", undefined, undefined][i % 5];
      const targets = [(7 * i + 3) % 60, (13 * i + 5) % 60].filter((t) => t !== i).map((t) => `m${String(t).padStart(2, "0")}`);
      if (i % 6 === 0) targets.push(`x${(i / 6) % 4}`);
      parts.push({ id, name: `Module ${String(i).padStart(2, "0")}`, ...(zone ? { zone } : {}), about: "", paths: [`src/${id}/**`], uses: targets.map((to) => ({ to })) });
    }
    return {
      name: "sixty parts, four externals and many edges",
      tree,
      plan: JSON.stringify({
        format: 1, name: "many", about: "",
        parts,
        externals: [0, 1, 2, 3].map((i) => ({ id: `x${i}`, name: `System ${i}`, about: "" })),
      }),
      steps: [
        {
          update: 0, page: "new",
          block: {
            parts: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`m${String(i).padStart(2, "0")}`, [1, ((37 * i) % 150) + 1]])),
            a: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`m${String(i).padStart(2, "0")}`, 75])),
            fixed: {}, zones: ["alpha", "beta", "gamma"], titles: { alpha: 47, beta: 40, gamma: 47 },
            externals: [["x0", 68], ["x1", 68], ["x2", 68], ["x3", 68]], connectors: [],
            more: (b) => expect(b.layout.edges).toHaveLength(130),
          },
        },
        { check: 0 },
      ],
    } satisfies Case;
  })(),
  {
    name: "a format 1 page is outdated and update rewrites it",
    more: { "docs/codeplan/codeplan.html": `${MARK}\n<html><body><script type="application/json" id="codeplan-data">{"format":1}</script></body></html>\n` },
    steps: [{ check: 1, outdated: true }, { update: 0, page: "rewrite", block: { edges: [["cart", "pay"]], externals: [], connectors: [] } }, { check: 0 }],
  },

  // ---- path values and writing the page ----
  ...['{ "home": "docs\\\\codeplan" }', '{ "home": "/docs/codeplan" }', '{ "home": "docs/codeplan/" }', '{ "home": "docs//codeplan" }', '{ "home": "./docs/codeplan" }', '{ "home": "docs/../docs/codeplan" }', '{ "page": "docs/codeplan/a\\\\b.html" }'].map(
    (config): Case => ({ name: `a path value out of form is a config error (${config})`, config, steps: [{ update: 2, page: "absent" }, { check: 2 }] }),
  ),
  {
    name: "a start with backslashes is bad-shape",
    plan: JSON.stringify({
      format: 1, name: "mall", about: "",
      parts: [
        { id: "cart", name: "Cart", about: "", start: "src\\cart\\add.ts", paths: ["src/cart/**"] },
        { id: "pay", name: "Pay", zone: "store", about: "", paths: ["src/pay/**"] },
        { id: "admin", name: "Admin", about: "", paths: ["src/admin/**"] },
      ],
    }),
    steps: [{ update: 2, page: "absent" }, { check: 2 }],
  },
  {
    name: "home is a symbolic link: nothing is written",
    plan: null,
    more: { "docs/real/plan.json": PLAN, "docs/codeplan": { link: "real" } },
    steps: [
      { update: 2, page: "absent" },
      { check: 2 },
      { act: (repo) => expect(readdirSync(join(repo, "docs/real"))).toEqual(["plan.json"]) },
    ],
  },
  {
    name: "a directory on the way to the page is a symbolic link: nothing is written",
    more: { "out/keep.txt": "keep\n", "docs/codeplan/view": { link: "../../out" } },
    config: '{ "page": "docs/codeplan/view/map.html" }',
    page: "docs/codeplan/view/map.html",
    steps: [{ update: 2, page: "absent" }, { check: 2 }, { act: (repo) => expect(readdirSync(join(repo, "out"))).toEqual(["keep.txt"]) }],
  },
  {
    name: "a file hard-linked to the page stays as it was",
    steps: [
      { update: 0, page: "new" },
      {
        act: (repo) => {
          mkdirSync(join(repo, "keep"));
          linkSync(join(repo, "docs/codeplan/codeplan.html"), join(repo, "keep/copy.html"));
          writeFileSync(join(repo, "src/cart/add.ts"), lines(9));
        },
      },
      { update: 0, page: "rewrite" },
      { check: 0 },
      {
        act: (repo) => {
          const copy = readFileSync(join(repo, "keep/copy.html"), "utf8");
          expect(copy).not.toBe(readFileSync(join(repo, "docs/codeplan/codeplan.html"), "utf8"));
          expect(copy).toContain('"lines":5');
        },
      },
    ],
  },
  {
    name: "a temporary file left by another run is never touched",
    more: { "docs/codeplan/.codeplan.html.old.tmp": "stray\n" },
    steps: [
      { update: 0, page: "new" },
      { act: writeText("src/cart/add.ts", lines(9)) },
      { update: 0, page: "rewrite" },
      { act: setPlan(CONTESTED) },
      { update: 1, page: "untouched" },
      { check: 1, outdated: false },
      {
        act: (repo) => {
          expect(readdirSync(join(repo, "docs/codeplan")).sort()).toEqual([".codeplan.html.old.tmp", "codeplan.html", "plan.json"]);
          expect(readFileSync(join(repo, "docs/codeplan/.codeplan.html.old.tmp"), "utf8")).toBe("stray\n");
        },
      },
    ],
  },
];

describe("update and check with the viewer page", () => {
  test.each(CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => runCase(c));
});

describe("draft, then update", () => {
  test.each([
    ["js", K5],
    [
      "java",
      {
        "build.gradle": lines(1),
        "src/main/java/org/sample/App.java": lines(5),
        "src/main/java/org/sample/web/Ctl.java": lines(3),
        "src/main/java/org/sample/repo/Dao.java": lines(4),
        "src/main/resources/mapper/UserMapper.xml": '<mapper namespace="org.sample.repo.Dao">\n  <select id="q"/>\n</mapper>\n',
      },
    ],
  ] as [string, Record<string, Entry>][])("%s", (_name, tree) => {
    const repo = writeRepo(tree);
    const result = runDraft(repo);
    writeFileSync(join(repo, "codeplan.json"), JSON.stringify(result.config));
    mkdirSync(join(repo, "docs/codeplan"), { recursive: true });
    writeFileSync(join(repo, "docs/codeplan/plan.json"), JSON.stringify(result.plan));
    const out = run(["update"], repo);
    expect(out.code, out.stderr).toBe(0);
    const block = expectPage(repo, "docs/codeplan/codeplan.html");
    expect(block.measure).toEqual(result.measure);
    expect(run(["check"], repo).code).toBe(0);
  });
});
