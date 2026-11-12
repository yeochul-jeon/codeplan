// Planned parts: a part with `planned: true` has no code yet.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { check, run } from "../src/cli.js";
import { labelWidth } from "../src/layout.js";
import { runDraft } from "./draft-helpers.js";
import { lines, makeRepo, type Tree } from "./helpers.js";
import { expectPage } from "./page-helpers.js";
import { openViewer, type El } from "./viewer-dom.js";

// Three watched files, a test file and a README. Nothing under src/refund.
const K: Tree = {
  "package.json": lines(1),
  "README.md": lines(1),
  "src/shop/cart.ts": lines(3),
  "src/shop/pay.ts": lines(2),
  "src/shop/cart.test.ts": lines(1),
  "src/auth/login.ts": lines(4),
};
const PLAN_FILE = "docs/codeplan/plan.json";
const PAGE_FILE = "docs/codeplan/codeplan.html";

type Item = Record<string, unknown>;
interface Plan {
  parts: Item[];
  scenarios: { steps: Item[] }[];
}

// The plan every case starts from; `change` edits a fresh copy.
function planWith(change: (plan: Plan) => void = () => {}): Plan {
  const plan = {
    format: 1,
    name: "shopfront",
    about: "",
    parts: [
      { id: "shop", name: "Shop", about: "", paths: ["src/shop/**"], uses: [{ to: "refund" }] },
      { id: "auth", name: "Auth", about: "", paths: ["src/auth/**"] },
      { id: "refund", name: "Refund", about: "", paths: ["src/refund/**"], planned: true },
    ],
    scenarios: [
      {
        id: "give-back",
        name: "",
        steps: [
          { at: "shop", does: "" },
          { at: "refund", does: "" },
        ],
      },
    ],
  };
  change(plan);
  return plan;
}

const DIAGNOSTIC = /^(\S+): ([a-z-]+) \[(error|warning)\] (.*)$/;

// Writes the plan, runs update and then check.
function checked(plan: Plan, more: Tree = {}) {
  const repo = makeRepo({ ...K, ...more, [PLAN_FILE]: JSON.stringify(plan, null, 2) });
  run(["update"], repo);
  const out = run(["check"], repo);
  const result = check(repo);
  if (result.kind !== "measured") throw new Error(result.message);
  const found = out.stderr
    .split("\n")
    .map((l) => DIAGNOSTIC.exec(l))
    .filter((m): m is RegExpExecArray => m !== null);
  return {
    repo,
    out,
    rows: found.map((m) => [m[1], m[2], m[3]]),
    messages: found.map((m) => m[4]!),
    parts: Object.fromEntries(result.measurement.parts.map((p) => [p.id, [p.files, p.lines]])),
    measurement: result.measurement,
    excluded: result.excluded,
  };
}

const BASE_PARTS = { shop: [2, 5], auth: [1, 4], refund: [0, 0] };

describe("planned parts in check", () => {
  test("a planned part without code gives no finding, and uses and steps may name it", () => {
    const r = checked(planWith());
    expect(r.rows).toEqual([]);
    expect(r.parts).toEqual(BASE_PARTS);
    expect(r.measurement.orphans).toEqual([]);
    expect(r.measurement.contested).toEqual([]);
    expect(r.measurement.unwatched).toEqual([]);
    expect(r.out.code, r.out.stderr).toBe(0);
    expect(r.out.stdout).toContain("check: ok");
  });

  test("a planned part that has received a file is reported once, with one fix line", () => {
    const r = checked(planWith(), { "src/refund/give.ts": lines(2) });
    expect(r.rows).toEqual([["parts[2].planned", "planned-has-files", "warning"]]);
    expect(r.messages[0]).toContain("refund");
    expect(r.parts).toEqual({ ...BASE_PARTS, refund: [1, 2] });
    expect(r.out.code).toBe(1);
    expect(r.out.stderr.split("\n").filter((l) => l.startsWith("  fix: planned-has-files: "))).toHaveLength(1);
    expect(r.out.stderr).not.toContain("undefined");
  });

  test("planned: false is the same as no planned key", () => {
    const r = checked(planWith((p) => (p.parts[2]!.planned = false)));
    expect(r.rows).toEqual([["parts[2].paths", "empty-part", "warning"]]);
    expect(r.messages[0]).toContain("refund");
    expect(r.out.code).toBe(1);
  });

  test.each([["a string", "yes"], ["null", null], ["a number", 1]])(
    "planned as %s is a bad shape, and the part is not planned",
    (_what, value) => {
      const r = checked(planWith((p) => (p.parts[2]!.planned = value)));
      expect(r.rows).toEqual([
        ["parts[2].paths", "empty-part", "warning"],
        ["parts[2].planned", "bad-shape", "error"],
      ]);
      for (const message of r.messages) expect(message).toContain("refund");
      expect(r.parts).toEqual(BASE_PARTS);
      expect(r.excluded).toBe(0);
      expect(r.out.stderr).not.toContain("measurement incomplete");
      expect(r.out.code).toBe(2);
    },
  );

  test("a planned part's start may name a file that is not there yet", () => {
    const r = checked(planWith((p) => (p.parts[2]!.start = "src/refund/index.ts")));
    expect(r.rows).toEqual([]);
    expect(r.out.code, r.out.stderr).toBe(0);
  });

  test("a planned part's start in another part's files is still reported", () => {
    const r = checked(planWith((p) => (p.parts[2]!.start = "src/auth/login.ts")));
    expect(r.rows).toEqual([["parts[2].start", "start-elsewhere", "warning"]]);
    expect(r.messages[0]).toContain("refund");
    expect(r.out.code).toBe(1);
  });

  test("contested files counted in a planned part are files it has", () => {
    const r = checked(
      planWith((p) => {
        p.parts[2]!.id = "basket";
        p.parts[2]!.paths = ["src/shop/**"];
        (p.parts[0]!.uses as Item[])[0]!.to = "basket";
        p.scenarios[0]!.steps[1]!.at = "basket";
      }),
    );
    expect(r.measurement.contested.map((c) => c.path)).toEqual(["src/shop/cart.ts", "src/shop/pay.ts"]);
    expect(r.parts).toEqual({ shop: [0, 0], auth: [1, 4], basket: [2, 5] });
    expect(r.rows).toEqual([
      ["parts[0].paths", "empty-part", "warning"],
      ["parts[2].planned", "planned-has-files", "warning"],
    ]);
    expect(r.messages[0]).toContain("shop");
    expect(r.messages[1]).toContain("basket");
    expect(r.out.code).toBe(1);
  });

  test("a planned part with broken paths gets only the finding for the paths", () => {
    const r = checked(planWith((p) => (p.parts[2]!.paths = [""])));
    expect(r.rows).toEqual([["parts[2].paths[0]", "bad-shape", "error"]]);
    expect(r.messages[0]).toContain("refund");
    expect(r.excluded).toBeGreaterThan(0);
    expect(r.out.stderr).toContain("measurement incomplete");
    expect(r.out.stderr).not.toContain("orphan files: no part owns them");
    expect(r.out.code).toBe(2);
  });

  test("a planned part with a repeated id gets only the finding for the id", () => {
    const r = checked(
      planWith((p) => p.parts.push({ id: "auth", name: "", about: "", paths: ["src/auth/**"], planned: true })),
    );
    expect(r.rows).toEqual([["parts[3].id", "repeated-id", "error"]]);
    expect(r.messages[0]).toContain("auth");
    expect(r.parts).toEqual(BASE_PARTS);
    expect(r.out.code).toBe(2);
  });
});

describe("planned parts on the page", () => {
  const rect = (plane: El, id: string) => plane.all().find((e) => e.name === "rect" && e.getAttribute("data-id") === id)!;
  // The label is the clipped svg drawn right after the rectangle.
  const label = (plane: El, id: string) =>
    plane.children[plane.children.indexOf(rect(plane, id)) + 1]!.children.map((t) => t.textContent);

  test("the rectangle is marked, the third label line reads planned, and check passes", () => {
    const repo = makeRepo({ ...K, [PLAN_FILE]: JSON.stringify(planWith(), null, 2) });
    expect(run(["update"], repo).code).toBe(0);
    const block = expectPage(repo, PAGE_FILE);
    expect(Object.keys(block.plan.parts[2]!)).toEqual(["id", "name", "about", "paths", "planned"]);
    expect("planned" in block.plan.parts[0]!).toBe(false);
    expect("planned" in block.plan.parts[1]!).toBe(false);

    const { plane } = openViewer(join(repo, PAGE_FILE));
    expect(rect(plane, "refund").getAttribute("data-planned")).toBe("true");
    expect(rect(plane, "shop").hasAttribute("data-planned")).toBe(false);
    expect(rect(plane, "auth").hasAttribute("data-planned")).toBe(false);
    expect(label(plane, "refund")).toEqual(["Refund", "0 lines", "planned"]);
    expect(label(plane, "shop")).toEqual(["Shop", "5 lines", "2 files"]);
    expect(run(["check"], repo).code).toBe(0);

    // The dashed border keeps the colour every part's border has.
    const page = readFileSync(join(repo, PAGE_FILE), "utf8");
    expect(page).toMatch(/\.part \{ fill: var\(--cp-part-fill\); stroke: var\(--cp-part-line\)/);
    expect(page).toMatch(/\.part\[data-planned\] \{ stroke-dasharray: [0-9 ]+; \}/);

    writeFileSync(join(repo, PLAN_FILE), JSON.stringify(planWith((p) => (p.parts[2]!.planned = false)), null, 2));
    expect(run(["update"], repo).code).toBe(0);
    const after = openViewer(join(repo, PAGE_FILE)).plane;
    expect(rect(after, "refund").hasAttribute("data-planned")).toBe(false);
    expect(label(after, "refund")).toEqual(["Refund", "0 lines", "0 files"]);
  });

  test("the label box is as wide as the word planned needs, not the file count", () => {
    const part = { id: "p", name: "", zone: undefined, lines: 0, files: 10 };
    expect(labelWidth({ ...part, planned: true })).toBe(7 * "planned".length + 12);
    expect(labelWidth(part)).toBe(7 * "10 files".length + 12);
  });

  test("the written page uses that width for a planned part with more files than lines", () => {
    const empty: Tree = {};
    for (let i = 0; i < 10; i++) empty[`src/q/f${i}.ts`] = "";
    const plan = planWith((p) => p.parts.push({ id: "q", name: "", about: "", paths: ["src/q/**"], planned: true }));
    const repo = makeRepo({ ...K, ...empty, [PLAN_FILE]: JSON.stringify(plan, null, 2) });
    expect(run(["update"], repo).code).toBe(0);
    const block = expectPage(repo, PAGE_FILE);
    expect(block.measure.parts[3]).toEqual({ id: "q", files: 10, lines: 0 });
    expect(block.layout.parts[3]!.label.w).toBe(7 * "planned".length + 12);
  });
});

describe("planned parts and draft", () => {
  test("draft writes no planned key", () => {
    const { plan } = runDraft(makeRepo(K));
    expect(plan.parts.length).toBeGreaterThan(0);
    for (const part of plan.parts) expect("planned" in part).toBe(false);
  });
});
