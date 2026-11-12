import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { check, run } from "../src/cli.js";
import { lines, makeRepo, type Tree } from "./helpers.js";
import { runDraft } from "./draft-helpers.js";

// The shared tree: three watched files, a test file, a README and a page.
const K: Tree = {
  "package.json": lines(1),
  "README.md": lines(1),
  "src/shop/cart.ts": lines(3),
  "src/shop/pay.ts": lines(2),
  "src/shop/cart.test.ts": lines(1),
  "src/auth/login.ts": lines(4),
};
const ALL_ORPHANS = ["src/auth/login.ts", "src/shop/cart.ts", "src/shop/pay.ts"];
const SHOP_AUTH = { shop: [2, 5], auth: [1, 4] } as Record<string, [number, number]>;

type Row = [at: string, code: string, severity: "error" | "warning", ids?: string[]];

interface Case {
  name: string;
  plan: unknown; // a JSON value, or { text } for raw file content
  tree?: Tree;
  config?: Record<string, unknown>;
  diagnostics: Row[];
  code: 0 | 1 | 2;
  parts?: Record<string, [number, number]>;
  orphans?: string[];
  contested?: string[];
  unwatched?: string[];
  incomplete?: boolean;
}

const DIAGNOSTIC = /^(\S+): ([a-z-]+) \[(error|warning)\] (.*)$/;

function diagnosticLines(stderr: string): { at: string; code: string; severity: string; message: string }[] {
  return stderr
    .split("\n")
    .map((l) => DIAGNOSTIC.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(([, at, code, severity, message]) => ({ at: at!, code: code!, severity: severity!, message: message! }));
}

function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`);
      else out[`${prefix}${name}`] = readFileSync(full, "latin1");
    }
  };
  walk(root, "");
  return out;
}

function writePlan(c: Case): Tree {
  const tree: Tree = { ...K, ...c.tree };
  if (c.plan !== undefined) {
    const text = (c.plan as { text?: string } | null)?.text;
    tree["docs/codeplan/plan.json"] = typeof text === "string" ? text : JSON.stringify(c.plan, null, 2);
  }
  if (c.config) tree["codeplan.json"] = JSON.stringify(c.config);
  return tree;
}

function expectRun(repo: string, c: Omit<Case, "name" | "plan" | "tree" | "config">): void {
  // The page is written first; update does not write when the plan has an
  // error, a file is contested or there is no plan.
  run(["update"], repo);
  const before = snapshot(repo);
  const out = run(["check"], repo);
  expect(snapshot(repo)).toEqual(before);
  expect(run(["check"], repo)).toEqual(out);

  const found = diagnosticLines(out.stderr);
  expect(found.map((d) => [d.at, d.code, d.severity]), out.stderr).toEqual(
    c.diagnostics.map(([at, code, severity]) => [at, code, severity]),
  );
  c.diagnostics.forEach(([, , , ids], i) => {
    for (const id of ids ?? []) expect(found[i]!.message).toContain(id);
  });
  expect(out.code, out.stderr).toBe(c.code);

  const result = check(repo);
  if (result.kind !== "measured") throw new Error(result.message);
  const m = result.measurement;
  if (c.parts) {
    expect(Object.fromEntries(m.parts.map((p) => [p.id, [p.files, p.lines]]))).toEqual(c.parts);
    for (const [id, [files, lineCount]] of Object.entries(c.parts)) {
      expect(out.stdout).toContain(`part ${id}: ${files} files, ${lineCount} lines`);
    }
  }
  const incomplete = c.incomplete ?? false;
  expect(result.excluded > 0).toBe(incomplete);
  expect(out.stderr.includes("measurement incomplete")).toBe(incomplete);
  if (incomplete) {
    expect(out.stderr).not.toContain("orphan files: no part owns them");
  } else {
    expect(m.orphans).toEqual(c.orphans ?? []);
  }
  expect(m.contested.map((x) => x.path)).toEqual(c.contested ?? []);
  expect(m.unwatched).toEqual(c.unwatched ?? []);
}

function runCase(c: Case): void {
  expectRun(makeRepo(writePlan(c)), c);
}

// ---- plans ----

const GOOD = {
  format: 1,
  name: "shopfront",
  about: "가게 화면. {shop}이 {auth}와 {paydb}를 쓴다.",
  parts: [
    {
      id: "shop",
      name: "Shop",
      zone: "front",
      about: "장바구니와 결제",
      start: "src/shop/cart.ts",
      paths: ["src/shop/**"],
      uses: [
        { to: "auth", why: "로그인을 확인한다" },
        { to: "paydb", why: "결제를 적는다", evidence: ["src/shop/pay.ts:1"] },
      ],
    },
    { id: "auth", name: "Auth", zone: "front", about: "로그인", paths: ["src/auth/**"], uses: [{ to: "paydb" }] },
  ],
  externals: [{ id: "paydb", name: "Pay DB", about: "결제 기록을 둔다" }],
  scenarios: [
    {
      id: "buy",
      name: "물건 하나를 사기까지",
      steps: [
        { at: "shop", does: "장바구니를 연다" },
        { at: "auth", does: "로그인을 확인한다" },
        { at: "shop", does: "결제를 만든다" },
        { at: "paydb", does: "결제를 적는다" },
      ],
    },
  ],
};

const BROKEN_PATHS = (paths?: unknown) => ({
  format: 1,
  name: "shopfront",
  about: "",
  parts: [
    { id: "shop", name: "Shop", about: "{ghost}를 거친다", paths: ["src/shop/**"], uses: [{ to: "auth" }] },
    {
      id: "auth",
      name: "Auth",
      about: "로그인",
      start: "src/auth/login.ts",
      ...(paths === undefined ? {} : { paths }),
    },
  ],
  scenarios: [
    { id: "buy", name: "사기", steps: [{ at: "shop", does: "연다" }, { at: "auth", does: "확인한다" }] },
  ],
});

const SHAPE_ONLY = (format: unknown, withFormat = true) => ({
  ...(withFormat ? { format } : {}),
  name: "shopfront",
  about: "",
  parts: [
    { id: "shop", name: "Shop", about: "", paths: ["src/shop/**"] },
    { id: "auth", name: "Auth", about: "", paths: ["src/auth/**"] },
  ],
});

const START = (start: unknown) => ({
  format: 1,
  name: "shopfront",
  about: "",
  parts: [
    { id: "shop", name: "Shop", about: "", start, paths: ["src/shop/**"] },
    { id: "auth", name: "Auth", about: "", paths: ["src/auth/**"] },
  ],
});

const ORDER_A = {
  format: 1,
  name: "shopfront",
  about: "{ghost}",
  parts: [
    {
      id: "shop", name: "Shop", about: "장바구니", paths: ["src/shop/**"],
      uses: [{ to: "shop" }, { to: "shop" }], note: "메모", tag: "a", color: "b",
    },
    { id: "auth", name: "Auth", about: "로그인", start: "src/none.ts", paths: ["src/auth/**"] },
  ],
  externals: [
    { id: "paydb", name: "Pay DB", about: "결제 기록" },
    { id: "queue", name: 5, about: "캐시" },
  ],
  scenarios: [{ id: "buy", name: "사기", steps: [{ at: "shop", does: "연다" }, { at: "paydb", does: "적는다" }] }],
  extra: true,
};

// Every object with its keys in reverse order; arrays keep their order.
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)]));
}

const ORDER_ROWS: Row[] = [
  ["about", "unknown-reference", "warning", ["ghost"]],
  ["parts[0].uses[0].to", "self-use", "warning", ["shop"]],
  ["parts[0].uses[1].to", "repeated-use", "warning", ["shop"]],
  ["parts[0].uses[1].to", "self-use", "warning", ["shop"]],
  ["parts[0].color", "bad-shape", "error", ["shop"]],
  ["parts[0].tag", "bad-shape", "error", ["shop"]],
  ["parts[1].start", "start-missing", "warning", ["auth"]],
  ["externals[1]", "unused-external", "warning", ["queue"]],
  ["externals[1].name", "bad-shape", "error", ["queue"]],
  ["scenarios[0].steps[1].at", "gap-in-scenario", "warning", ["buy"]],
  ["extra", "bad-shape", "error"],
];

const UNUSED_ONLY = (parts: unknown[], scenarios?: unknown[]) => ({
  format: 1,
  name: "shopfront",
  about: "",
  parts,
  externals: [{ id: "queue", name: "Cache", about: "" }],
  ...(scenarios ? { scenarios } : {}),
});

const CASES: Case[] = [
  // ---- basics ----
  { name: "a plan that keeps every rule", plan: GOOD, diagnostics: [], code: 0, parts: SHOP_AUTH },
  {
    name: "empty parts are allowed",
    plan: { format: 1, name: "shopfront", about: "", parts: [] },
    diagnostics: [],
    code: 1,
    parts: {},
    orphans: ALL_ORPHANS,
  },
  {
    name: "empty text fields and absent optional fields",
    plan: {
      format: 1,
      name: "",
      about: "",
      parts: [
        { id: "shop", name: "", zone: "", about: "", paths: ["src/shop/**"] },
        { id: "auth", name: "", about: "", paths: ["src/auth/**"], uses: [] },
      ],
    },
    diagnostics: [],
    code: 0,
    parts: SHOP_AUTH,
  },
  {
    name: "no plan file: one no-plan warning and every watched file an orphan",
    plan: undefined,
    diagnostics: [["plan", "no-plan", "warning"]],
    code: 1,
    parts: {},
    orphans: ALL_ORPHANS,
  },
  ...["[]", "null", '"shopfront"', "1"].map((text): Case => ({
    name: `a top level that is not an object (${text})`,
    plan: { text },
    diagnostics: [["plan", "bad-shape", "error"]],
    code: 2,
    parts: {},
    orphans: ALL_ORPHANS,
  })),

  // ---- shape ----
  {
    name: "fields of the wrong type; an error still reports measurement",
    plan: {
      format: 1,
      name: 7,
      about: "가게 화면",
      parts: [
        { id: "shop", name: "Shop", zone: 3, about: "장바구니와 결제", paths: ["src/shop/**"], uses: [{ to: "auth" }] },
        {
          id: "auth", name: ["Auth"], about: "로그인", paths: ["src/auth/**"],
          uses: [{ to: "paydb", why: true, evidence: "src/auth/login.ts:1" }],
        },
      ],
      externals: [{ id: "paydb", name: "Pay DB", about: null }],
      scenarios: [
        { id: "buy", name: "사기", steps: [{ at: "shop", does: "장바구니를 연다" }, { at: "auth", does: 5 }] },
      ],
    },
    diagnostics: [
      ["name", "bad-shape", "error"],
      ["parts[0].zone", "bad-shape", "error", ["shop"]],
      ["parts[1].name", "bad-shape", "error", ["auth"]],
      ["parts[1].uses[0].why", "bad-shape", "error", ["auth"]],
      ["parts[1].uses[0].evidence", "bad-shape", "error", ["auth"]],
      ["externals[0].about", "bad-shape", "error", ["paydb"]],
      ["scenarios[0].steps[1].does", "bad-shape", "error", ["buy"]],
    ],
    code: 2,
    parts: SHOP_AUTH,
  },
  {
    name: "missing required fields sit at their field's place",
    plan: {
      format: 1,
      name: "shopfront",
      parts: [
        { id: "shop", about: "장바구니와 결제", paths: ["src/shop/**"], uses: [{ why: "로그인을 확인한다" }, { to: "auth" }, { to: "paydb" }] },
        { id: "auth", name: "Auth", about: "로그인", paths: ["src/auth/**"] },
      ],
      externals: [{ id: "paydb", about: "결제 기록" }],
      scenarios: [{ name: "사기", steps: [{ at: "shop" }, { at: "auth", does: "로그인을 확인한다" }] }],
    },
    diagnostics: [
      ["about", "bad-shape", "error"],
      ["parts[0].name", "bad-shape", "error", ["shop"]],
      ["parts[0].uses[0].to", "bad-shape", "error", ["shop"]],
      ["externals[0].name", "bad-shape", "error", ["paydb"]],
      ["scenarios[0].id", "bad-shape", "error"],
      ["scenarios[0].steps[0].does", "bad-shape", "error"],
    ],
    code: 2,
    parts: SHOP_AUTH,
  },
  {
    name: "unknown keys and note",
    plan: {
      owner: "team",
      note: "{nothing}은 참조가 아니다",
      format: 1,
      name: "shopfront",
      about: "가게 화면",
      parts: [
        {
          size: 3, color: "red", note: 5, id: "shop", name: "Shop {x}", zone: "{front}", about: "장바구니와 결제",
          paths: ["src/shop/**"],
          uses: [{ to: "auth", note: "{ghost} 메모", weight: 2 }, { to: "paydb" }],
        },
        { id: "auth", name: "Auth", about: "로그인", paths: ["src/auth/**"], note: "{ghost}" },
      ],
      externals: [{ id: "paydb", name: "Pay DB", about: "결제 기록", note: "{ghost}" }],
      scenarios: [
        {
          id: "buy", name: "사기 {ghost}", note: "{ghost}",
          steps: [{ at: "shop", does: "결제한다", note: "{ghost}" }, { at: "paydb", does: "적는다" }],
        },
      ],
    },
    diagnostics: [
      ["parts[0].uses[0].weight", "bad-shape", "error", ["shop"]],
      ["parts[0].note", "bad-shape", "error", ["shop"]],
      ["parts[0].color", "bad-shape", "error", ["shop"]],
      ["parts[0].size", "bad-shape", "error", ["shop"]],
      ["owner", "bad-shape", "error"],
    ],
    code: 2,
    parts: SHOP_AUTH,
  },
  ...([[2, true], ["1", true], [undefined, false]] as [unknown, boolean][]).map(([format, present]): Case => ({
    name: `format must be the number 1 (${present ? JSON.stringify(format) : "absent"})`,
    plan: SHAPE_ONLY(format, present),
    diagnostics: [["format", "bad-shape", "error"]],
    code: 2,
    parts: SHOP_AUTH,
  })),
  {
    name: "the form of ids",
    plan: {
      format: 1,
      name: "shopfront",
      about: "",
      parts: [
        { id: "Shop", name: "Shop", about: "" },
        { id: "auth", name: "Auth", about: "", paths: ["src/auth/**"], uses: [{ to: "Pay_DB" }, { to: "" }] },
      ],
      externals: [{ id: "-paydb", name: "Pay DB", about: "" }],
      scenarios: [{ id: "buy_one", name: "사기", steps: [{ at: "auth", does: "확인한다" }, { at: "paydb-", does: "적는다" }] }],
    },
    diagnostics: [
      ["parts[0].id", "bad-shape", "error"],
      ["parts[0].paths", "no-paths", "error"],
      ["parts[1].uses[0].to", "bad-shape", "error", ["auth"]],
      ["parts[1].uses[1].to", "bad-shape", "error", ["auth"]],
      ["externals[0].id", "bad-shape", "error"],
      ["scenarios[0].id", "bad-shape", "error"],
      ["scenarios[0].steps[1].at", "bad-shape", "error"],
    ],
    code: 2,
    parts: { auth: [1, 4] },
    incomplete: true,
  },
  ...([
    ["absent", undefined, [["parts[1].paths", "no-paths", "error", ["auth"]]]],
    ["empty", [], [["parts[1].paths", "no-paths", "error", ["auth"]]]],
    ["not an array", "src/auth/**", [["parts[1].paths", "bad-shape", "error", ["auth"]]]],
    ["bad elements", ["src/auth/**", "", 3], [
      ["parts[1].paths[1]", "bad-shape", "error", ["auth"]],
      ["parts[1].paths[2]", "bad-shape", "error", ["auth"]],
    ]],
  ] as [string, unknown, Row[]][]).map(([what, paths, rows]): Case => ({
    name: `paths ${what}: the part leaves measurement and nothing chains from it`,
    plan: BROKEN_PATHS(paths),
    diagnostics: [["parts[0].about", "unknown-reference", "warning", ["shop", "ghost"]], ...rows],
    code: 2,
    parts: { shop: [2, 5] },
    incomplete: true,
  })),
  ...([
    ['""', "", "bad-shape", "error", 2],
    ["absolute", "/src/shop/cart.ts", "bad-shape", "error", 2],
    ["a .. inside", "src/shop/../shop/cart.ts", "bad-shape", "error", 2],
    ["a .. first", "../shopfront/src/shop/cart.ts", "bad-shape", "error", 2],
    ["a number", 5, "bad-shape", "error", 2],
    ["a ./ first", "./src/shop/cart.ts", "bad-shape", "error", 2],
    ["a //", "src//shop/cart.ts", "bad-shape", "error", 2],
    ["a /./", "src/./shop/cart.ts", "bad-shape", "error", 2],
    ["a trailing /", "src/shop/", "bad-shape", "error", 2],
    ["..cart.ts is a name", "src/shop/..cart.ts", "start-missing", "warning", 1],
  ] as [string, unknown, string, "error" | "warning", 0 | 1 | 2][]).map(([what, start, code, severity, exit]): Case => ({
    name: `the form of start (${what})`,
    plan: START(start),
    diagnostics: [["parts[0].start", code, severity, ["shop"]]],
    code: exit,
    parts: SHOP_AUTH,
  })),

  // ---- ids and targets ----
  {
    name: "repeated ids and the checks inside a repeated item",
    plan: {
      format: 1,
      name: "shopfront",
      about: "",
      parts: [
        { id: "shop", name: "Shop", about: "", paths: ["src/shop/**"] },
        { id: "auth", name: "Auth", about: "", paths: ["src/auth/**"] },
        { id: "shop", name: 5, about: "{ghost}", start: "src/none.ts", paths: ["src/auth/**"], uses: [{ to: "absent" }, { to: "shop" }] },
      ],
      externals: [
        { id: "shop", name: "Shop API", about: "{ghost}" },
        { id: "paydb", name: "Pay DB", about: "" },
        { id: "mailer", name: "Mailer", about: "" },
      ],
      scenarios: [
        { id: "mailer", name: "알림", steps: [{ at: "absent", does: 3 }] },
        { id: "buy", name: "사기", steps: [{ at: "shop", does: "연다" }, { at: "auth", does: "확인한다" }, { at: "paydb", does: "적는다" }] },
      ],
    },
    diagnostics: [
      ["parts[2].id", "repeated-id", "error", ["shop"]],
      ["parts[2].name", "bad-shape", "error", ["shop"]],
      ["externals[0].id", "repeated-id", "error", ["shop"]],
      ["scenarios[0].id", "repeated-id", "error", ["mailer"]],
      ["scenarios[0].steps[0].does", "bad-shape", "error", ["mailer"]],
      ["scenarios[1].steps[2].at", "gap-in-scenario", "warning", ["buy"]],
    ],
    code: 2,
    parts: SHOP_AUTH,
    incomplete: true,
  },
  {
    name: "targets of uses",
    plan: {
      format: 1,
      name: "shopfront",
      about: "",
      parts: [
        {
          id: "shop", name: "Shop", about: "", paths: ["src/shop/**"],
          uses: [{ to: "auth" }, { to: "shop" }, { to: "ghost" }, { to: "auth" }, { to: "ghost" }, 7],
        },
        { id: "auth", name: "Auth", about: "", paths: ["src/auth/**"], uses: [{ to: "paydb" }] },
      ],
      externals: [
        { id: "paydb", name: "Pay DB", about: "" },
        { id: "queue", name: "Cache", about: "" },
      ],
      scenarios: [
        { id: "buy", name: "사기", steps: [{ at: "shop", does: "연다" }, { at: "ghost", does: "?" }, { at: "paydb", does: "적는다" }] },
      ],
    },
    diagnostics: [
      ["parts[0].uses[1].to", "self-use", "warning", ["shop"]],
      ["parts[0].uses[2].to", "unknown-target", "error", ["shop"]],
      ["parts[0].uses[3].to", "repeated-use", "warning", ["shop"]],
      ["parts[0].uses[4].to", "repeated-use", "warning", ["shop"]],
      ["parts[0].uses[4].to", "unknown-target", "error", ["shop"]],
      ["parts[0].uses[5]", "bad-shape", "error", ["shop"]],
      ["scenarios[0].steps[1].at", "unknown-target", "error", ["buy"]],
    ],
    code: 2,
    parts: SHOP_AUTH,
  },
  {
    name: "an external no use or step names",
    plan: {
      format: 1,
      name: "shopfront",
      about: "{queue}는 아직 붙이지 않았다",
      parts: [
        { id: "shop", name: "Shop", about: "", paths: ["src/shop/**"], uses: [{ to: "paydb" }] },
        { id: "auth", name: "Auth", about: "", paths: ["src/auth/**"] },
      ],
      externals: [
        { id: "paydb", name: "Pay DB", about: "" },
        { id: "mailer", name: "Mailer", about: "" },
        { id: "queue", name: "Cache", about: "{queue}" },
      ],
      scenarios: [
        { id: "notify", name: "알림 보내기", steps: [{ at: "mailer", does: "받는다" }, { at: "mailer", does: "보낸다" }] },
      ],
    },
    diagnostics: [["externals[2]", "unused-external", "warning", ["queue"]]],
    code: 1,
    parts: SHOP_AUTH,
  },

  // ---- scenarios ----
  {
    name: "short scenarios and gaps",
    plan: {
      format: 1,
      name: "shopfront",
      about: "",
      parts: [
        { id: "shop", name: "Shop", about: "", paths: ["src/shop/**"], uses: [{ to: "auth" }] },
        { id: "auth", name: "Auth", about: "", paths: ["src/auth/**"], uses: [{ to: "paydb" }] },
      ],
      externals: [{ id: "paydb", name: "Pay DB", about: "" }],
      scenarios: [
        { id: "idle", name: "아무것도 하지 않음", steps: [] },
        { id: "peek", name: "보기만", steps: [{ at: "shop", does: "연다" }] },
        { id: "back", name: "되돌아오기", steps: [{ at: "auth", does: "확인한다" }, { at: "shop", does: "받는다" }] },
        { id: "twice", name: "한 곳에서 두 번", steps: [{ at: "shop", does: "연다" }, { at: "shop", does: "닫는다" }, { at: "paydb", does: "적는다" }] },
        { id: "loop", name: "다시 지나기", steps: [{ at: "shop", does: "연다" }, { at: "auth", does: "확인한다" }, { at: "shop", does: "닫는다" }] },
      ],
    },
    diagnostics: [
      ["scenarios[0].steps", "short-scenario", "warning", ["idle"]],
      ["scenarios[1].steps", "short-scenario", "warning", ["peek"]],
      ["scenarios[3].steps[2].at", "gap-in-scenario", "warning", ["twice"]],
    ],
    code: 1,
    parts: SHOP_AUTH,
  },
  {
    name: "broken steps and uses that are not an array",
    plan: {
      format: 1,
      name: "shopfront",
      about: "",
      parts: [
        { id: "shop", name: "Shop", about: "", paths: ["src/shop/**"] },
        { id: "auth", name: "Auth", about: "", paths: ["src/auth/**"], uses: { to: "queue" } },
      ],
      externals: [
        { id: "paydb", name: "Pay DB", about: "" },
        { id: "queue", name: "Cache", about: "" },
      ],
      scenarios: [
        { id: "login", name: "로그인", steps: [{ at: "shop", does: "연다" }, { at: "auth", does: "확인한다" }] },
        { id: "broken", name: "깨진 단계", steps: [{ at: "shop", does: "연다" }, { at: 5, does: "?" }, { at: "paydb", does: "적는다" }] },
        { id: "lost", name: "없는 곳", steps: [{ at: "shop", does: "연다" }, { at: "ghost", does: "?" }, { at: "paydb", does: "적는다" }] },
        { id: "pay", name: "결제", steps: [{ at: "shop", does: "연다" }, { at: "paydb", does: "적는다" }] },
      ],
    },
    diagnostics: [
      ["parts[1].uses", "bad-shape", "error", ["auth"]],
      ["scenarios[1].steps[1].at", "bad-shape", "error", ["broken"]],
      ["scenarios[2].steps[1].at", "unknown-target", "error", ["lost"]],
      ["scenarios[3].steps[1].at", "gap-in-scenario", "warning", ["pay"]],
    ],
    code: 2,
    parts: SHOP_AUTH,
  },

  // ---- diagnostics that need measurement ----
  {
    name: "empty-part, start-missing and start-elsewhere",
    tree: { "src/tools/gen.ts": lines(2) },
    plan: {
      format: 1,
      name: "shopfront",
      about: "",
      parts: [
        { id: "shop", name: "Shop", about: "", start: "src/auth/login.ts", paths: ["src/shop/**"] },
        { id: "cart", name: "Cart", about: "", start: "src/shop/cart.test.ts", paths: ["src/shop/cart.ts"] },
        { id: "auth", name: "Auth", about: "", start: "src/auth", paths: ["src/auth/**"] },
        { id: "kit", name: "Kit", about: "", start: "src/tools/gen.ts", paths: ["lib/kit/**"] },
        { id: "guide", name: "Guide", about: "", start: "README.md", paths: ["guide/**"] },
        { id: "spare", name: "Spare", about: "", start: "src/spare/main.ts", paths: ["src/spare/**"] },
      ],
    },
    diagnostics: [
      ["parts[0].start", "start-elsewhere", "warning", ["shop"]],
      ["parts[2].start", "start-missing", "warning", ["auth"]],
      ["parts[3].start", "start-elsewhere", "warning", ["kit"]],
      ["parts[3].paths", "empty-part", "warning", ["kit"]],
      ["parts[4].paths", "empty-part", "warning", ["guide"]],
      ["parts[5].start", "start-missing", "warning", ["spare"]],
      ["parts[5].paths", "empty-part", "warning", ["spare"]],
    ],
    code: 1,
    parts: { shop: [1, 2], cart: [1, 3], auth: [1, 4], kit: [0, 0], guide: [0, 0], spare: [0, 0] },
    orphans: ["src/tools/gen.ts"],
  },

  // ---- references in text ----
  {
    name: "{id} references",
    plan: {
      format: 1,
      name: "{ghost} 가게",
      about: "{shop}이 {paydb}에 쓴다. {} {Shop} { shop } {pay_db} {-shop} {shop-} 는 글자다.",
      parts: [
        {
          id: "shop", name: "{ghost}", zone: "{ghost}", about: "{ghost}를 거친다", paths: ["src/shop/**"],
          uses: [{ to: "auth", why: "{buy} 때문에" }, { to: "paydb", why: "{auth}가 확인한 뒤", note: "{ghost}" }],
        },
        { id: "auth", name: "Auth", about: "로그인", paths: ["src/auth/**"], note: "{ghost}" },
      ],
      externals: [{ id: "paydb", name: "Pay DB", about: "{paydb-old}에서 옮겼다" }],
      scenarios: [
        { id: "buy", name: "{ghost}", steps: [{ at: "shop", does: "{auth}에 묻는다" }, { at: "auth", does: "{buy}를 이어 간다" }] },
      ],
    },
    diagnostics: [
      ["parts[0].about", "unknown-reference", "warning", ["shop", "ghost"]],
      ["parts[0].uses[0].why", "unknown-reference", "warning", ["shop", "buy"]],
      ["externals[0].about", "unknown-reference", "warning", ["paydb", "paydb-old"]],
      ["scenarios[0].steps[1].does", "unknown-reference", "warning", ["buy"]],
    ],
    code: 1,
    parts: SHOP_AUTH,
  },

  // ---- incomplete measurement ----
  {
    name: "with a part out of measurement, contested and unwatched lists still show",
    tree: { "tools/gen.mjs": lines(1) },
    config: { watch: ["src/**/*.ts"] },
    plan: {
      format: 1,
      name: "shopfront",
      about: "",
      parts: [
        { id: "shop", name: "Shop", about: "", paths: ["src/shop/**"] },
        { id: "till", name: "Till", about: "", paths: ["src/shop/**"] },
        { id: "auth", name: "Auth", about: "", paths: [] },
      ],
    },
    diagnostics: [
      ["parts[1].paths", "empty-part", "warning", ["till"]],
      ["parts[2].paths", "no-paths", "error", ["auth"]],
    ],
    code: 2,
    parts: { shop: [2, 5], till: [0, 0] },
    contested: ["src/shop/cart.ts", "src/shop/pay.ts"],
    unwatched: ["tools/gen.mjs"],
    incomplete: true,
  },

  // ---- order and output ----
  ...[["in plan format order", ORDER_A], ["with every key order reversed", reverseKeys(ORDER_A)]].map(
    ([what, plan]): Case => ({
      name: `diagnostic order does not follow key order in the file (${what as string})`,
      plan,
      diagnostics: ORDER_ROWS,
      code: 2,
      parts: SHOP_AUTH,
    }),
  ),

  // ---- details settled in the spec ----
  {
    name: "items without a proper id leave the id set and measurement",
    plan: {
      format: 1,
      name: "shopfront",
      about: "",
      parts: [
        { id: "Shop", name: "Shop", about: "", paths: ["src/shop/**"] },
        { id: 7, name: "Seven", about: "", paths: ["src/auth/login.ts"] },
        { name: "Auth", about: "", paths: ["src/auth/**"] },
        { id: "hub", name: "Hub", about: "", paths: ["src/shop/**"], uses: [{ to: "7" }] },
      ],
      externals: [{ id: "Pay_DB", name: "Pay DB", about: "" }],
      scenarios: [{ id: "buy", name: "사기", steps: [{ at: "hub", does: "연다" }, { at: "7", does: "?" }] }],
    },
    diagnostics: [
      ["parts[0].id", "bad-shape", "error"],
      ["parts[1].id", "bad-shape", "error"],
      ["parts[2].id", "bad-shape", "error"],
      ["parts[3].uses[0].to", "unknown-target", "error", ["hub"]],
      ["externals[0].id", "bad-shape", "error"],
      ["scenarios[0].steps[1].at", "unknown-target", "error", ["buy"]],
    ],
    code: 2,
    parts: { hub: [2, 5] },
    incomplete: true,
  },
  {
    name: "an external with a malformed id gets no unused-external",
    plan: {
      format: 1,
      name: "shopfront",
      about: "",
      parts: [
        { id: "shop", name: "Shop", about: "", paths: ["src/shop/**"] },
        { id: "auth", name: "Auth", about: "", paths: ["src/auth/**"] },
      ],
      externals: [
        { id: "Pay_DB", name: "Pay DB", about: "" },
        { id: "queue", name: "Cache", about: "" },
      ],
    },
    diagnostics: [
      ["externals[0].id", "bad-shape", "error"],
      ["externals[1]", "unused-external", "warning", ["queue"]],
    ],
    code: 2,
    parts: SHOP_AUTH,
  },
  {
    name: "several missing references in one text field",
    plan: {
      format: 1,
      name: "shopfront",
      about: "{ghost}와 {shop}, 다시 {ghost}, 그리고 {nobody}",
      parts: [
        { id: "shop", name: "Shop", about: "{ghost}{ghost}", paths: ["src/shop/**"] },
        { id: "auth", name: "Auth", about: "", paths: ["src/auth/**"] },
      ],
    },
    diagnostics: [
      ["about", "unknown-reference", "warning", ["ghost"]],
      ["about", "unknown-reference", "warning", ["nobody"]],
      ["parts[0].about", "unknown-reference", "warning", ["shop", "ghost"]],
    ],
    code: 1,
    parts: SHOP_AUTH,
  },
  {
    name: "no no-paths inside a repeated-id item",
    plan: {
      format: 1,
      name: "shopfront",
      about: "",
      parts: [
        { id: "shop", name: "Shop", about: "", paths: ["src/shop/**"] },
        { id: "auth", name: "Auth", about: "", paths: ["src/auth/**"] },
        { id: "auth", name: "Auth 2", about: "" },
        { id: "shop", name: 7, about: "", paths: [] },
      ],
    },
    diagnostics: [
      ["parts[2].id", "repeated-id", "error", ["auth"]],
      ["parts[3].id", "repeated-id", "error", ["shop"]],
      ["parts[3].name", "bad-shape", "error", ["shop"]],
    ],
    code: 2,
    parts: SHOP_AUTH,
    incomplete: true,
  },
  {
    name: "a part kept before a repeated external id is checked for gaps as usual",
    plan: {
      format: 1,
      name: "shopfront",
      about: "",
      parts: [
        { id: "shop", name: "Shop", about: "", paths: ["src/shop/**"] },
        { id: "auth", name: "Auth", about: "", paths: ["src/auth/**"] },
      ],
      externals: [
        { id: "auth", name: "Auth API", about: "" },
        { id: "paydb", name: "Pay DB", about: "" },
      ],
      scenarios: [{ id: "login", name: "로그인", steps: [{ at: "shop", does: "연다" }, { at: "auth", does: "확인한다" }] }],
    },
    diagnostics: [
      ["externals[0].id", "repeated-id", "error", ["auth"]],
      ["scenarios[0].steps[1].at", "gap-in-scenario", "warning", ["login"]],
    ],
    code: 2,
    parts: SHOP_AUTH,
  },
  {
    name: "a diagnostic on an array field comes before those on its elements",
    plan: {
      format: 1,
      name: "shopfront",
      about: "",
      parts: [
        { id: "shop", name: "Shop", about: "", paths: ["src/shop/**"] },
        { id: "auth", name: "Auth", about: "", paths: ["src/auth/**"] },
      ],
      scenarios: [{ id: "peek", name: "보기만", steps: [{ at: "Shop", does: "연다" }] }],
    },
    diagnostics: [
      ["scenarios[0].steps", "short-scenario", "warning", ["peek"]],
      ["scenarios[0].steps[0].at", "bad-shape", "error", ["peek"]],
    ],
    code: 2,
    parts: SHOP_AUTH,
  },
  {
    name: "evidence elements, and errors that do not break a use or step",
    plan: {
      format: 1,
      name: "shopfront",
      about: "",
      parts: [
        {
          id: "shop", name: "Shop", about: "", paths: ["src/shop/**"],
          uses: [{ to: "auth", why: 5, evidence: ["src/shop/cart.ts:1", 2, ""], note: 7 }],
        },
        { id: "auth", name: "Auth", about: "", paths: ["src/auth/**"] },
      ],
      externals: [{ id: "queue", name: "Cache", about: "" }],
      scenarios: [
        { id: "login", name: "로그인", steps: [{ at: "shop", does: 3 }, { at: "auth", does: "확인한다", extra: 1 }] },
      ],
    },
    diagnostics: [
      ["parts[0].uses[0].why", "bad-shape", "error", ["shop"]],
      ["parts[0].uses[0].evidence[1]", "bad-shape", "error", ["shop"]],
      ["parts[0].uses[0].note", "bad-shape", "error", ["shop"]],
      ["externals[0]", "unused-external", "warning", ["queue"]],
      ["scenarios[0].steps[0].does", "bad-shape", "error", ["login"]],
      ["scenarios[0].steps[1].extra", "bad-shape", "error", ["login"]],
    ],
    code: 2,
    parts: SHOP_AUTH,
  },
  ...([
    [
      "an unknown step target",
      UNUSED_ONLY(
        [
          { id: "shop", name: "Shop", about: "", paths: ["src/shop/**"], uses: [{ to: "auth" }] },
          { id: "auth", name: "Auth", about: "", paths: ["src/auth/**"] },
        ],
        [{ id: "lost", name: "없는 곳", steps: [{ at: "shop", does: "연다" }, { at: "ghost", does: "?" }] }],
      ),
      [["scenarios[0].steps[1].at", "unknown-target", "error", ["lost"]]],
    ],
    [
      "uses that are not an array",
      UNUSED_ONLY([
        { id: "shop", name: "Shop", about: "", paths: ["src/shop/**"] },
        { id: "auth", name: "Auth", about: "", paths: ["src/auth/**"], uses: { to: "queue" } },
      ]),
      [["parts[1].uses", "bad-shape", "error", ["auth"]]],
    ],
    [
      "an unknown use target",
      UNUSED_ONLY([
        { id: "shop", name: "Shop", about: "", paths: ["src/shop/**"], uses: [{ to: "ghost" }] },
        { id: "auth", name: "Auth", about: "", paths: ["src/auth/**"] },
      ]),
      [["parts[0].uses[0].to", "unknown-target", "error", ["shop"]]],
    ],
  ] as [string, unknown, Row[]][]).map(([what, plan, diagnostics]): Case => ({
    name: `unused-external is held back by ${what}`,
    plan,
    diagnostics,
    code: 2,
    parts: SHOP_AUTH,
  })),
];

describe("check on plans over the shared tree", () => {
  test.each(CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => runCase(c));
});

describe("check with plan files that change", () => {
  test("a plan file that is not JSON: one error line, exit 2, no measurement report", () => {
    const repo = makeRepo({ ...K, "docs/codeplan/plan.json": '{"format": 1, "parts": [\n' });
    const before = snapshot(repo);
    const out = run(["check"], repo);
    expect(snapshot(repo)).toEqual(before);
    expect(out.code).toBe(2);
    expect(out.stdout).toBe("");
    expect(out.stderr.trimEnd().split("\n")).toHaveLength(1);
    expect(diagnosticLines(out.stderr)).toEqual([]);
    expect(out.stderr).not.toMatch(/part |orphan|contested|unwatched/);
  });

  test("a drafted plan and config check with no diagnostics", () => {
    const repo = makeRepo(K);
    const result = runDraft(repo);
    expect(result.config).toEqual({ languages: ["js"] });
    expect(result.plan.parts.map((p) => [p.id, p.paths, p.zone])).toEqual([
      ["src-auth", ["src/auth/**"], "src"],
      ["src-shop", ["src/shop/**"], "src"],
    ]);
    writeFileSync(join(repo, "codeplan.json"), JSON.stringify(result.config));
    mkdirSync(join(repo, "docs/codeplan"), { recursive: true });
    writeFileSync(join(repo, "docs/codeplan/plan.json"), JSON.stringify(result.plan));
    expectRun(repo, { diagnostics: [], code: 0, parts: { "src-auth": [1, 4], "src-shop": [2, 5] } });
  });

  test("fixing the broken places brings check back to 0", () => {
    const repo = makeRepo({ ...K, "docs/codeplan/plan.json": JSON.stringify(BROKEN_PATHS()) });
    expectRun(repo, {
      diagnostics: [
        ["parts[0].about", "unknown-reference", "warning", ["shop", "ghost"]],
        ["parts[1].paths", "no-paths", "error", ["auth"]],
      ],
      code: 2,
      parts: { shop: [2, 5] },
      incomplete: true,
    });
    writeFileSync(
      join(repo, "docs/codeplan/plan.json"),
      JSON.stringify({
        format: 1,
        name: "shopfront",
        about: "",
        parts: [
          { id: "shop", name: "Shop", about: "장바구니", paths: ["src/shop/**"], uses: [{ to: "auth" }] },
          { id: "auth", name: "Auth", about: "로그인", start: "src/auth/login.ts", paths: ["src/auth/**"] },
        ],
        scenarios: [{ id: "buy", name: "사기", steps: [{ at: "shop", does: "연다" }, { at: "auth", does: "확인한다" }] }],
      }),
    );
    expectRun(repo, { diagnostics: [], code: 0, parts: SHOP_AUTH });
  });

  test("the two key orders give byte-equal diagnostic lines", () => {
    const outs = [ORDER_A, reverseKeys(ORDER_A)].map((plan) =>
      run(["check"], makeRepo({ ...K, "docs/codeplan/plan.json": JSON.stringify(plan) })),
    );
    expect(diagnosticLines(outs[0]!.stderr)).toEqual(diagnosticLines(outs[1]!.stderr));
  });
});
