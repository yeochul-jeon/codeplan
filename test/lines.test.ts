import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { run } from "../src/cli.js";
import { layOut, type PartInput } from "../src/layout.js";
import { lines, makeRepo } from "./helpers.js";
import { HOST, NO_LINES, treeOf, type PartSpec, type PlanSpec } from "./lines-plans.js";
import { expectedLines, expectLayout, expectPage, lineFaults, together, type Block } from "./page-helpers.js";

const PAGE = "docs/codeplan/codeplan.html";

// Writes the page and checks it: expectPage holds every rule of the layout
// and of the lines among themselves.
function drawn(spec: PlanSpec): Block {
  const repo = makeRepo(treeOf(spec));
  const out = run(["update"], repo);
  expect(out.code, out.stderr).toBe(0);
  return expectPage(repo, PAGE);
}
const pointsOf = (block: Block, from: string, to: string) =>
  block.layout.edges.find((e) => e.from === from && e.to === to)!.points;
const sha = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

describe("a plan without lines has the page it had before lines got places of their own", () => {
  // The SHA-256 of the page that the codeplan.mjs before this change wrote.
  const BEFORE: Record<string, string> = {
    "parts, zones and an external": "5562b3b497acfa91f785a627439d174f028eee6a1360e4f931749b181773a65d",
    "a part that uses only itself": "8b2f25b43a8b0d7336750d8416643b7c0820583d8069052553e4b5929a63ca6e",
    "a scenario whose steps stay in one place": "e23b3b9011a63652bac635f940d9643c7a6dc4f107ea7ec59c586de731a48c43",
  };
  test.each(Object.keys(NO_LINES))("%s", (name) => {
    const repo = makeRepo(treeOf(NO_LINES[name]!));
    expect(run(["update"], repo).code).toBe(0);
    const block = expectPage(repo, PAGE);
    expect([block.layout.edges, block.layout.connectors]).toEqual([[], []]);
    expect(sha(readFileSync(join(repo, PAGE)))).toBe(BEFORE[name]);
  });

  test("a plan as draft prints it", () => {
    const repo = makeRepo({
      "package.json": lines(1), "src/cart/add.ts": lines(30), "src/pay/charge.ts": lines(400),
      "src/pay/card/visa.ts": lines(90), "lib/text.ts": lines(12), "main.ts": lines(3),
    });
    const draft = JSON.parse(run(["draft"], repo).stdout) as { plan: unknown; config: unknown };
    mkdirSync(join(repo, "docs/codeplan"), { recursive: true });
    writeFileSync(join(repo, "docs/codeplan/plan.json"), JSON.stringify(draft.plan));
    writeFileSync(join(repo, "codeplan.json"), JSON.stringify(draft.config));
    expect(run(["update"], repo).code).toBe(0);
    expect(sha(readFileSync(join(repo, PAGE)))).toBe("a869f85f45d78f2dcc92ce9904a4e0621b5d5887782b6921ad682b7e9259854d");
  });
});

describe("lines among themselves", () => {
  const small = (id: string, uses: string[] = []): PartSpec => ({ id, lines: 20, uses });

  test.each(["out", "in"])("one part with 33 lines %s", (way) => {
    const others = Array.from({ length: 33 }, (_, i) => `q${i}`);
    const block = drawn({
      parts: [
        { id: "hub", name: "p", lines: 0, uses: way === "out" ? others : [] },
        ...others.map((id) => small(id, way === "in" ? ["hub"] : [])),
      ],
    });
    expect(block.layout.edges).toHaveLength(33);
    const hub = block.layout.parts[0]!;
    const ends = block.layout.edges.map((e) => (way === "out" ? e.points[0]! : e.points.at(-1)!));
    const sides: [string, (p: [number, number]) => boolean, number][] = [
      ["top", (p) => p[1] === hub.y, hub.w], ["bottom", (p) => p[1] === hub.y + hub.h, hub.w],
      ["left", (p) => p[0] === hub.x, hub.h], ["right", (p) => p[0] === hub.x + hub.w, hub.h],
    ];
    for (const [side, on, length] of sides) {
      const different = new Set(ends.filter(on).map(String)).size;
      expect(different <= Math.floor(length / 8) + 1, side).toBe(true);
    }
  });

  test("two parts that use each other: the two lines share no stretch and no end", () => {
    const block = drawn({ parts: [small("a", ["b"]), small("b", ["a"])] });
    const [ab, ba] = [pointsOf(block, "a", "b"), pointsOf(block, "b", "a")];
    const ends = [ab[0], ab.at(-1), ba[0], ba.at(-1)].map(String);
    expect(new Set(ends).size).toBe(4);
    expect(together(ab, ba).runs).toEqual([]);
  });

  test("a line to a rectangle in the row below finishes on its top side, and the other way starts there", () => {
    const block = drawn({
      parts: [
        { id: "a", lines: 400, uses: ["c", "d"] }, { id: "b", lines: 400, uses: ["c"] },
        { id: "c", lines: 400, uses: ["a"] }, { id: "d", lines: 400 },
      ],
      scenarios: [["b", "d", "a"]],
    });
    const [a, b, c, d] = block.layout.parts as [Block["layout"]["parts"][number], Block["layout"]["parts"][number], Block["layout"]["parts"][number], Block["layout"]["parts"][number]];
    expect([a.y === b.y, c.y === d.y, c.y > a.y]).toEqual([true, true, true]);
    const into = (from: string, to: string) => pointsOf(block, from, to).at(-1)!;
    expect([into("a", "c")[1], into("b", "c")[1], into("a", "d")[1]]).toEqual([c.y, c.y, d.y]);
    // The two lines into c share the place on its top side; the line out of c has another.
    expect(into("a", "c")).toEqual(into("b", "c"));
    const outOfC = pointsOf(block, "c", "a")[0]!;
    expect(outOfC[1]).toBe(c.y);
    expect(Math.abs(outOfC[0] - into("a", "c")[0])).toBeGreaterThanOrEqual(8);
    // No line of this plan goes by the right margin.
    const right = Math.max(b.x + b.w, d.x + d.w);
    for (const l of [...block.layout.edges, ...block.layout.connectors]) {
      expect(Math.max(...l.points.map((p) => p[0]))).toBeLessThanOrEqual(right);
    }
  });

  test("three parts that all use each other", () => {
    const block = drawn({ parts: [small("a", ["b", "c"]), small("b", ["a", "c"]), small("c", ["a", "b"])] });
    expect(block.layout.edges).toHaveLength(6);
  });

  test("connectors beside an edge: the same two places give the same points, and no connector runs with the edge", () => {
    const block = drawn({
      parts: [small("a", ["b"]), small("b"), small("c")],
      scenarios: [["a", "c", "b", "c", "b"]],
    });
    expect(block.layout.connectors.map((c) => c.step)).toEqual([1, 2, 3, 4]);
    const [, cb, , cbAgain] = block.layout.connectors;
    expect(cbAgain!.points).toEqual(cb!.points);
    const ab = pointsOf(block, "a", "b");
    for (const c of block.layout.connectors) expect(together(ab, c.points).runs, String(c.step)).toEqual([]);
  });

  test("zones, parts without a zone and two rows of externals", () => {
    const long = "A system with a name long enough to fill a row";
    const block = drawn({
      parts: [
        { id: "a1", zone: "left", lines: 900, uses: ["b1", "b2", "x0", "x4"] },
        { id: "a2", zone: "left", lines: 40, uses: ["a1", "b3", "x1"] },
        { id: "a3", zone: "left", lines: 300, uses: ["free", "x2"] },
        { id: "b1", zone: "right", lines: 2000, uses: ["a2", "x3"] },
        { id: "b2", zone: "right", lines: 10, uses: ["a3"] },
        { id: "b3", zone: "right", lines: 500, uses: ["other"] },
        { id: "free", lines: 700, uses: ["a1"] },
        { id: "other", lines: 60 },
      ],
      externals: Array.from({ length: 5 }, (_, i) => ({ id: `x${i}`, name: `${long} ${i}` })),
      scenarios: [["a1", "b3", "x4", "free", "a1"]],
    });
    const rows = new Set(block.layout.externals.map((x) => x.y));
    expect(rows.size).toBeGreaterThan(1);
    expect(block.layout.zones.map((z) => z.name)).toEqual(["left", "right"]);
  });

  test("a plan of the size of one in use", () => {
    const block = drawn(HOST);
    expect([block.layout.parts.length, block.layout.externals.length, block.layout.edges.length]).toEqual([11, 2, 21]);
    expect(block.plan.scenarios![0]!.steps).toHaveLength(10);
  });

  test("the checks find lines that break each rule", () => {
    const rects = [{ id: "a", x: 0, y: 0, w: 40, h: 40 }, { id: "b", x: 100, y: 0, w: 40, h: 40 }];
    const line = (what: string, from: string, to: string, points: [number, number][], kind: "edge" | "connector" = "edge") =>
      ({ what, kind, from, to, points });
    const faults = (...l: ReturnType<typeof line>[]) => lineFaults(l, rects).map((f) => f.slice(0, 1));
    // Side by side, 4 apart.
    expect(faults(line("1", "a", "b", [[40, 10], [100, 10]]), line("2", "b", "a", [[100, 14], [40, 14]]))).toEqual(["N", "E", "E"]);
    // Together in the middle only.
    expect(faults(
      line("1", "a", "b", [[20, 40], [20, 60], [120, 60], [120, 40]]),
      line("2", "a", "b", [[30, 40], [30, 60], [110, 60], [110, 40]]),
    )).toEqual(["T"]);
    // Together to the end, but one of them comes back to it after a gap.
    expect(faults(
      line("1", "a", "b", [[20, 40], [20, 60], [60, 60], [60, 80], [80, 80], [80, 60], [120, 60], [120, 40]]),
      line("2", "a", "b", [[20, 40], [20, 60], [120, 60], [120, 40]], "edge"),
    )).toEqual(["T"]);
    // Two kinds into one point.
    expect(faults(
      line("1", "a", "b", [[40, 20], [100, 20]]),
      line("2", "a", "b", [[40, 20], [100, 20]], "connector"),
    )).toEqual(["T", "E", "E"]);
    // Along a side.
    expect(faults(line("1", "a", "b", [[40, 20], [60, 20], [60, 40], [120, 40]]))).toEqual(["S"]);
    // Crossing and touching at one point are no fault.
    expect(faults(
      line("1", "a", "b", [[40, 20], [100, 20]]),
      line("2", "b", "a", [[120, 40], [120, 60], [70, 60], [70, 20], [70, -20], [20, -20], [20, 0]]),
    )).toEqual([]);
  });
});

function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe("lines on generated plans", () => {
  test.each(Array.from({ length: 200 }, (_, i) => i + 1))("seed %i", (seed) => {
    const r = random(seed);
    const upTo = (n: number) => Math.floor(r() * (n + 1));
    const zones = ["", ...["north", "south", "east", "west"].slice(0, upTo(4))];
    const inputs: PartInput[] = Array.from({ length: 2 + upTo(38) }, (_, i) => ({
      id: `p${i}`,
      name: r() < 0.2 ? "A part with a long name to make it wide" : `P${i}`,
      zone: zones[upTo(zones.length - 1)] || undefined,
      lines: r() < 0.2 ? upTo(30) : upTo(4000),
      files: upTo(40),
    }));
    const externals = Array.from({ length: upTo(6) }, (_, i) => ({ id: `x${i}`, name: r() < 0.5 ? "" : "External system" }));
    const ids = [...inputs.map((p) => p.id), ...externals.map((x) => x.id)];
    const uses: { to: string }[][] = inputs.map(() => []);
    for (let n = upTo(120); n > 0; n--) uses[upTo(inputs.length - 1)]!.push({ to: ids[upTo(ids.length - 1)]! });
    const scenarios = Array.from({ length: upTo(3) }, (_, s) => ({
      id: `s${s}`,
      steps: Array.from({ length: upTo(12) }, () => ({ at: ids[upTo(ids.length - 1)]! })),
    }));
    const plan = {
      parts: inputs.map((p, i) => ({ id: p.id, name: p.name, ...(p.zone ? { zone: p.zone } : {}), uses: uses[i] })),
      externals,
      scenarios,
    } as unknown as Block["plan"];
    const want = expectedLines(plan);
    const stepsOf = (id: string) => scenarios.find((s) => s.id === id)!.steps;
    const relations = {
      edges: want.edges.map(([from, to]) => ({ from, to })),
      connectors: want.connectors.map(([scenario, step]) => ({
        scenario, step, from: stepsOf(scenario)[step - 1]!.at, to: stepsOf(scenario)[step]!.at,
      })),
    };
    const layout = layOut(inputs, externals, relations);
    expectLayout({
      plan,
      measure: { parts: inputs.map((p) => ({ id: p.id, files: p.files, lines: p.lines })) },
      layout,
    } as unknown as Block);
    expect(layOut(inputs, externals, relations)).toEqual(layout);
  });
});

describe("update time with many lines at one part", () => {
  test.each(["out", "in"])("299 lines %s of one part within 10 seconds", (way) => {
    const others = Array.from({ length: 299 }, (_, i) => `q${i}`);
    const repo = makeRepo(treeOf({
      parts: [
        { id: "hub", lines: 2, uses: way === "out" ? others : [] },
        ...others.map((id) => ({ id, lines: 2, uses: way === "in" ? ["hub"] : [] })),
      ],
    }));
    const started = performance.now();
    expect(run(["update"], repo).code).toBe(0);
    const seconds = (performance.now() - started) / 1000;
    console.log(`update with 299 lines ${way} of one part: ${seconds.toFixed(2)} s`);
    expect(seconds).toBeLessThan(10);
  }, 60_000);
});
