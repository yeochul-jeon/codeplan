import { linkSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { check, run } from "../src/cli.js";
import { layOut, partSize, type PartInput } from "../src/layout.js";
import { FRAME, pageHtml } from "../src/page.js";
import { lines, makeRepo, type Tree } from "./helpers.js";
import { agePlace, expectedLines, expectLayout, placeState, readBlock, type Block } from "./page-helpers.js";

const PLAN = JSON.stringify({
  format: 1,
  name: "mall",
  about: "",
  parts: [
    { id: "cart", name: "Cart", zone: "store", about: "", paths: ["src/cart/**"] },
    { id: "pay", name: "", zone: "store", about: "", paths: ["src/pay/**"] },
    { id: "admin", name: "Admin <x>", about: "", paths: ["src/admin/**"] },
  ],
});
const TREE = {
  "package.json": lines(1),
  "src/cart/add.ts": lines(3),
  "src/pay/charge.ts": lines(4),
  "src/admin/panel.ts": lines(6),
  "src/lost.ts": lines(1),
  "docs/codeplan/plan.json": PLAN,
};
const PAGE = "docs/codeplan/codeplan.html";

describe("the page frame", () => {
  test("a page written by a codeplan.mjs with another frame is outdated", () => {
    const repo = makeRepo(TREE);
    expect(run(["update"], repo).code).toBe(0);
    const current = readFileSync(join(repo, PAGE), "utf8");
    const { block } = readBlock(current);
    const older = { head: FRAME.head.replace("<title>codeplan</title>", "<title>codeplan (old)</title>"), tail: FRAME.tail };
    writeFileSync(join(repo, PAGE), pageHtml(block as never, older));
    const out = run(["check"], repo);
    expect(out.code).toBe(1);
    expect(out.stderr).toMatch(/^page outdated: /m);
    expect(run(["update"], repo).code).toBe(0);
    expect(readFileSync(join(repo, PAGE), "utf8")).toBe(current);
  });

  test("the frame asks nothing from the network and holds no raw block text", () => {
    for (const piece of [FRAME.head, FRAME.tail]) {
      expect(piece).not.toMatch(/fetch\(|XMLHttpRequest|@import|<link|\r|codeplan-data">|outdated/);
      expect(piece).not.toMatch(/(?:src|href)\s*=\s*["']?\/\//);
    }
  });
});

describe("update and check details", () => {
  test("an integer-like key in the plan is an unknown key: no page is written and an old one stays", () => {
    const bad = PLAN.replace('"format":1,', '"format":1,"7":"x",');
    const fresh = makeRepo({ ...TREE, "docs/codeplan/plan.json": bad });
    expect(run(["update"], fresh).code).toBe(2);
    expect(run(["check"], fresh).code).toBe(2);
    expect(placeState(join(fresh, PAGE)).kind).toBe("absent");

    const repo = makeRepo(TREE);
    expect(run(["update"], repo).code).toBe(0);
    writeFileSync(join(repo, "docs/codeplan/plan.json"), bad);
    agePlace(join(repo, PAGE));
    const before = placeState(join(repo, PAGE));
    expect(run(["update"], repo).code).toBe(2);
    expect(run(["check"], repo).code).toBe(2);
    expect(placeState(join(repo, PAGE))).toEqual(before);
  });

  test("home, page and start take one path form on every system", () => {
    const configs = [
      { page: "docs/codeplan/plan.json/x.html" },
      { page: "docs/codeplan/./codeplan.html" },
      { page: "docs/codeplan//c.html" },
      { page: "docs/codeplan/" },
      { page: "docs/codeplan\\x.html" },
      { page: "docs\\codeplan\\..\\..\\x.html" },
      { home: "docs\\codeplan" },
      { home: "./docs/codeplan" },
      { home: "docs/codeplan/" },
      { home: "/docs/codeplan" },
    ];
    for (const config of configs) {
      const repo = makeRepo({ ...TREE, "codeplan.json": JSON.stringify(config) });
      for (const command of ["update", "check"]) {
        const out = run([command], repo);
        expect(out.code, `${command} ${JSON.stringify(config)}`).toBe(2);
        expect(out.stderr.trimEnd().split("\n")).toHaveLength(1);
      }
    }
    const plan = JSON.parse(PLAN);
    plan.parts[0].start = "src\\cart\\add.ts";
    const repo = makeRepo({ ...TREE, "docs/codeplan/plan.json": JSON.stringify(plan) });
    expect(run(["check"], repo).stderr).toMatch(/^parts\[0\]\.start: bad-shape \[error\]/m);
  });

  test("a symbolic link among the page's directories: both commands exit 2 and write nothing", () => {
    const repo = makeRepo(TREE);
    mkdirSync(join(repo, "elsewhere"));
    symlinkSync("../../elsewhere", join(repo, "docs/codeplan/view"));
    writeFileSync(join(repo, "codeplan.json"), JSON.stringify({ page: "docs/codeplan/view/map.html" }));
    for (const command of ["update", "check"]) expect(run([command], repo).code, command).toBe(2);
    expect(placeState(join(repo, "elsewhere/map.html")).kind).toBe("absent");

    // A home that is a link to a real directory is refused the same way.
    const linked = makeRepo({ "package.json": lines(1), "src/a/x.ts": lines(1), "real-home/plan.json": PLAN });
    symlinkSync("real-home", join(linked, "plan-home"));
    writeFileSync(join(linked, "codeplan.json"), JSON.stringify({ home: "plan-home", skip: ["real-home/**"] }));
    for (const command of ["update", "check"]) expect(run([command], linked).code, command).toBe(2);
    expect(placeState(join(linked, "real-home/codeplan.html")).kind).toBe("absent");
  });

  test("a page hard-linked to another file: update replaces the page and the other file stays", () => {
    const repo = makeRepo(TREE);
    expect(run(["update"], repo).code).toBe(0);
    const first = readFileSync(join(repo, PAGE), "utf8");
    linkSync(join(repo, PAGE), join(repo, "kept.html"));
    writeFileSync(join(repo, "src/cart/add.ts"), lines(9));
    expect(run(["update"], repo).code).toBe(0);
    expect(readFileSync(join(repo, "kept.html"), "utf8")).toBe(first);
    expect(readFileSync(join(repo, PAGE), "utf8")).not.toBe(first);
    expect(readdirSync(join(repo, "docs/codeplan")).sort()).toEqual(["codeplan.html", "plan.json"]);
  });

  test("check reports an outdated page with the other problems, and says ok only when all are gone", () => {
    const repo = makeRepo(TREE);
    const listsOrphan = (stderr: string) => /^orphan files: no part owns them \(1\)$/m.test(stderr) && stderr.includes("  src/lost.ts");
    let out = run(["check"], repo);
    expect(out.code).toBe(1);
    expect(listsOrphan(out.stderr)).toBe(true);
    expect(out.stderr).toMatch(/^page outdated: /m);
    expect(out.stdout).not.toContain("check: ok");

    expect(run(["update"], repo).code).toBe(0);
    out = run(["check"], repo);
    expect(out.code).toBe(1);
    expect(listsOrphan(out.stderr)).toBe(true);
    expect(out.stderr + out.stdout.replace(/^check:.*$/m, "")).not.toContain("outdated");
    expect(out.stdout).not.toContain("check: ok");

    const plan = JSON.parse(PLAN);
    plan.parts.push({ id: "lost", name: "Lost", about: "", paths: ["src/lost.ts"] });
    writeFileSync(join(repo, "docs/codeplan/plan.json"), JSON.stringify(plan));
    expect(run(["update"], repo).code).toBe(0);
    out = run(["check"], repo);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("check: ok");
  });
});

// Seeded layouts over many shapes of input.
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

describe("layout on generated inputs", () => {
  test.each(Array.from({ length: 60 }, (_, i) => i + 1))("seed %i", (seed) => {
    const r = random(seed);
    const pick = <T>(items: T[]): T => items[Math.floor(r() * items.length)]!;
    const zones = ["", "core", "front", "결제", "a-very-long-zone-name-that-goes-past-the-title-cap", "z"];
    const names = ["", "A", "Order history and refund processing service", "결제와 환불", "\u{1f600}x", "Module 00"];
    const inputs: PartInput[] = Array.from({ length: Math.floor(r() * 40) }, (_, i) => {
      const kind = r();
      const lineCount = kind < 0.15 ? 0 : kind < 0.3 ? Math.floor(r() * 30) : kind < 0.9 ? Math.floor(r() * 3000) : Math.floor(r() * 2_000_000);
      return {
        id: `p${i}`,
        name: pick(names),
        zone: r() < 0.2 ? undefined : pick(zones),
        lines: lineCount,
        files: Math.floor(r() * 300),
      };
    });
    // Externals, uses and scenarios drawn from the same seed.
    const externals = Array.from({ length: Math.floor(r() * 7) }, (_, i) => ({ id: `x${i}`, name: pick(["", "DB", "결제 기록 저장소", "Vendor settlement and payout gateway API"]) }));
    const ids = [...inputs.map((p) => p.id), ...externals.map((x) => x.id)];
    const uses = inputs.map(() => (ids.length > 0 ? Array.from({ length: Math.floor(r() * 4) }, () => ({ to: pick(ids) })) : []));
    const scenarios = ids.length > 0
      ? Array.from({ length: Math.floor(r() * 3) }, (_, s) => ({ id: `s${s}`, steps: Array.from({ length: Math.floor(r() * 6) }, () => ({ at: pick(ids) })) }))
      : [];
    const plan = {
      parts: inputs.map((p, i) => ({ id: p.id, name: p.name, ...(p.zone === undefined ? {} : { zone: p.zone }), uses: uses[i] })),
      externals,
      scenarios,
    };
    const lines = expectedLines(plan as unknown as Block["plan"]);
    const stepsOf = (id: string) => scenarios.find((s) => s.id === id)!.steps;
    const relations = {
      edges: lines.edges.map(([from, to]) => ({ from, to })),
      connectors: lines.connectors.map(([scenario, step]) => ({
        scenario, step, from: stepsOf(scenario)[step - 1]!.at, to: stepsOf(scenario)[step]!.at,
      })),
    };
    const layout = layOut(inputs, externals, relations);
    const block = {
      plan,
      measure: { parts: inputs.map((p) => ({ id: p.id, files: p.files, lines: p.lines })) },
      layout,
    } as unknown as Block;
    expectLayout(block);
    expect(layOut(inputs, externals, relations)).toEqual(layout);
    // Part sizes do not depend on externals, uses or scenarios, and without
    // lines neither do the places of parts and zones.
    const bare = layOut(inputs);
    const sizes = (l: typeof layout) => l.parts.map((p) => [p.id, p.w, p.h, p.label.w, p.label.h]);
    expect(sizes(bare)).toEqual(sizes(layout));
    const noLines = layOut(inputs, externals);
    expect([noLines.parts, noLines.zones]).toEqual([bare.parts, bare.zones]);
  });

  test("part sizes right above the label box and for very large counts", () => {
    for (const a of [61, 75, 112, 240]) {
      const edge = Math.floor((a * 56) ** 2 / 160000);
      for (const n of [0, 1, edge, edge + 1, edge + 2, 10 ** 6, 10 ** 8]) {
        const { w, h } = partSize(a, n);
        expect(w >= a && h >= 56).toBe(true);
        expect((w * h) ** 2 >= 160000 * n).toBe(true);
        expect((w * h) ** 2 <= 250000 * n || w * h <= a * 56).toBe(true);
        expect(Math.max(w, h) / Math.min(w, h) <= Math.max(3, a / 56)).toBe(true);
      }
    }
  });
});

describe("update time", () => {
  test("200 parts, 20 externals, 500 edges and a 200-step scenario update within 10 seconds", () => {
    const r = random(7);
    const tree: Tree = { "package.json": lines(1) };
    const parts = Array.from({ length: 200 }, (_, i) => {
      tree[`src/p${i}/f.ts`] = lines(1 + Math.floor(r() * 400));
      const zone = ["", "core", "front", "data", "ops"][i % 5];
      return { id: `p${i}`, name: `Part ${i}`, ...(zone ? { zone } : {}), about: "", paths: [`src/p${i}/**`], uses: [] as { to: string }[] };
    });
    const externals = Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, name: `System ${i}`, about: "" }));
    const ids = [...parts.map((p) => p.id), ...externals.map((x) => x.id)];
    const pairs = new Set<string>();
    while (pairs.size < 500) {
      const from = Math.floor(r() * 200);
      const to = ids[Math.floor(r() * ids.length)]!;
      if (to === `p${from}` || pairs.has(`${from} ${to}`)) continue;
      pairs.add(`${from} ${to}`);
      parts[from]!.uses.push({ to });
    }
    const steps = Array.from({ length: 200 }, () => ({ at: ids[Math.floor(r() * ids.length)]!, does: "step" }));
    const plan = { format: 1, name: "big", about: "", parts, externals, scenarios: [{ id: "long", name: "Long", steps }] };
    const repo = makeRepo({ ...tree, "docs/codeplan/plan.json": JSON.stringify(plan) });
    const started = performance.now();
    const out = run(["update"], repo);
    const seconds = (performance.now() - started) / 1000;
    expect(out.code, out.stderr).toBe(0);
    console.log(`update with 200 parts, 20 externals, 500 edges, 200 steps: ${seconds.toFixed(2)} s`);
    expect(seconds).toBeLessThan(10);
    const { block } = readBlock(readFileSync(join(repo, PAGE), "utf8"));
    expect(block.layout.edges).toHaveLength(500);
    expectLayout(block);
  }, 60_000);

  test("one part using 299 others, and no lines at all", () => {
    const tree: Tree = { "package.json": lines(1) };
    const parts = Array.from({ length: 300 }, (_, i) => {
      tree[`src/p${i}/f.ts`] = lines(2);
      return { id: `p${i}`, name: `P${i}`, about: "", paths: [`src/p${i}/**`] };
    });
    const withUses = { format: 1, name: "fan", about: "", parts: parts.map((p, i) => (i === 0 ? { ...p, uses: parts.slice(1).map((q) => ({ to: q.id })) } : p)) };
    const repo = makeRepo({ ...tree, "docs/codeplan/plan.json": JSON.stringify(withUses) });
    let started = performance.now();
    expect(run(["update"], repo).code).toBe(0);
    const fan = (performance.now() - started) / 1000;
    const fanned = readBlock(readFileSync(join(repo, PAGE), "utf8")).block;
    expect(fanned.layout.edges).toHaveLength(299);
    expectLayout(fanned);
    writeFileSync(join(repo, "docs/codeplan/plan.json"), JSON.stringify({ format: 1, name: "flat", about: "", parts }));
    started = performance.now();
    expect(run(["update"], repo).code).toBe(0);
    const flat = (performance.now() - started) / 1000;
    console.log(`update with 300 parts: one part using 299 others ${fan.toFixed(2)} s, no lines ${flat.toFixed(2)} s`);
    expect(fan).toBeLessThan(10);
    expectLayout(readBlock(readFileSync(join(repo, PAGE), "utf8")).block);
  }, 60_000);
});
