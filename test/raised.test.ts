// The raised picture: its data on plans of many shapes, the picture button
// and the fragment, and what an older page looks like to check.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { run } from "../src/cli.js";
import { layOut, type PartInput } from "../src/layout.js";
import { raisedPicture } from "../src/raised.js";
import { lines, makeRepo, type Tree } from "./helpers.js";
import { HOST, NO_LINES, treeOf, type PlanSpec } from "./lines-plans.js";
import { expectPage, readBlock, type Block } from "./page-helpers.js";
import { H0, K, PROJECTION, expectRaised, hull, lifted, overlap } from "./raised-helpers.js";
import { openViewer, type Viewer } from "./viewer-dom.js";

const PAGE = "docs/codeplan/codeplan.html";

interface Part {
  id: string;
  name?: string;
  zone?: string;
  lines?: number;
  planned?: boolean;
  uses?: string[];
}
interface Spec {
  parts: Part[];
  externals?: { id: string; name: string }[];
  scenarios?: { id: string; steps: string[] }[];
  tasks?: { id: string; parts: string[] }[];
}

function repoOf(spec: Spec): string {
  const tree: Tree = { "package.json": lines(1) };
  for (const p of spec.parts) if (!p.planned) tree[`src/${p.id}/f.ts`] = lines(p.lines ?? 0);
  tree["docs/codeplan/plan.json"] = JSON.stringify({
    format: 1,
    name: "raised",
    about: "",
    parts: spec.parts.map((p) => ({
      id: p.id,
      name: p.name ?? p.id,
      ...(p.zone ? { zone: p.zone } : {}),
      about: "",
      paths: [`src/${p.id}/**`],
      ...(p.planned ? { planned: true } : {}),
      uses: (p.uses ?? []).map((to) => ({ to })),
    })),
    externals: (spec.externals ?? []).map((x) => ({ ...x, about: "" })),
    scenarios: (spec.scenarios ?? []).map((s) => ({ id: s.id, name: "", steps: s.steps.map((at) => ({ at, does: "step" })) })),
    ...(spec.tasks ? { tasks: spec.tasks.map((t) => ({ id: t.id, name: "", status: "todo", parts: t.parts })) } : {}),
  });
  return makeRepo(tree);
}

// Writes the page and checks it: expectPage holds every rule of the raised
// picture, for the data and for what the page draws.
function written(spec: Spec): { repo: string; block: Block } {
  const repo = repoOf(spec);
  const out = run(["update"], repo);
  expect(out.code, out.stderr).toBe(0);
  return { repo, block: expectPage(repo, PAGE) };
}
const sizeOf = (block: Block) => `${block.raised.width} x ${block.raised.height}`;

describe("the raised picture's data", () => {
  test("a plan with no parts and no externals", () => {
    const { repo, block } = written({ parts: [] });
    expect(block.raised).toEqual({ width: 1, height: 1, projection: PROJECTION, zones: [], parts: [], externals: [], order: [] });
    const v = openViewer(join(repo, PAGE));
    expect(v.picture()).toMatchObject({ shown: "plane", text: "raised" });
    expect([v.plane.all().filter((e) => e.name === "rect").length, v.raised.children.length]).toEqual([0, 0]);
  });

  test("one part", () => {
    const { block } = written({ parts: [{ id: "only", lines: 300 }] });
    expect(block.raised.parts[0]!.z).toBe(17);
    expect(block.raised.order).toEqual(["only"]);
  });

  test("one external", () => {
    const { block } = written({ parts: [], externals: [{ id: "bank", name: "Bank" }] });
    expect([block.raised.parts, block.raised.order]).toEqual([[], ["bank"]]);
  });

  test("one planned part is H0 high and has dashed lines", () => {
    const { repo, block } = written({ parts: [{ id: "later", planned: true }] });
    expect(block.raised.parts[0]!.z).toBe(H0);
    expect(block.raised.parts[0]!.label.w).toBe(7 * "planned".length + 12);
    const page = readFileSync(join(repo, PAGE), "utf8");
    expect(page).toContain("g[data-planned] .side, g[data-planned] .top { stroke-dasharray: 6 3; }");
  });

  test("one part in one zone: the title is in the zone's rectangle and on no shape", () => {
    const { block } = written({ parts: [{ id: "only", zone: "a zone with a name much wider than its one part", lines: 3 }] });
    const zone = block.raised.zones[0]!;
    expect(zone.w).toBeGreaterThanOrEqual(zone.title.w + 16);
  });

  test("one part of 40000 lines among ten small parts", () => {
    const names = ["a", "장바구니", "three", "a longer name", "결제와 환불을 맡는 곳", "x".repeat(18), "y".repeat(22), "z".repeat(25), "w".repeat(28), "v".repeat(30)];
    const { block } = written({
      parts: [{ id: "big", lines: 40000 }, ...names.map((name, i) => ({ id: `s${i}`, name, lines: i + 1 }))],
    });
    const big = block.raised.parts[0]!;
    expect(big.z).toBe(200);
    // No small part's top is under the big shape.
    const shape = hull([...lifted(block.raised, big, 0), ...lifted(block.raised, big, big.z)]);
    for (const p of block.raised.parts.slice(1)) expect(overlap(hull(lifted(block.raised, p, p.z)), shape), p.id).toBe(false);
    console.log(`E333: big z ${big.z}, raised picture ${sizeOf(block)}, plane picture ${block.layout.width} x ${block.layout.height}`);
  });

  // Three zones of 1, 4 and 9 parts, two parts without a zone, three externals.
  const ZONES = ["b", "결제 영역", `a ${"long zone name ".repeat(3)}`];
  const MANY: Spec = {
    parts: [
      { id: "free1", lines: 700 },
      { id: "solo", zone: ZONES[0], lines: 90 },
      ...Array.from({ length: 4 }, (_, i) => ({ id: `pay${i}`, zone: ZONES[1], lines: [20, 900, 3, 2500][i]! })),
      ...Array.from({ length: 9 }, (_, i) => ({ id: `core${i}`, zone: ZONES[2], lines: [400, 12, 5000, 60, 1500, 0, 250, 33, 800][i]! })),
      { id: "free2", name: "설정", lines: 15 },
    ],
    externals: [{ id: "db", name: "DB" }, { id: "queue", name: "Message queue for orders" }, { id: "mail", name: "" }],
  };
  test("three zones, parts without a zone and three externals", () => {
    const { block } = written(MANY);
    expect(ZONES.every((z) => z.length > 0 && z.length < 60)).toBe(true);
    expect(block.raised.zones.map((z) => z.name)).toEqual([...ZONES].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(block.raised.zones.map((z) => z.title.w)).toContain(240);
    console.log(`E334: raised picture ${sizeOf(block)}, plane picture ${block.layout.width} x ${block.layout.height}`);
  });

  test("uses, scenarios and tasks do not change it", () => {
    const ids = [...MANY.parts.map((p) => p.id), ...MANY.externals!.map((x) => x.id)];
    const more: Spec = {
      ...MANY,
      parts: MANY.parts.map((p, i) => ({ ...p, uses: i < 10 ? [ids[(i + 1) % ids.length]!, ids[(i + 9) % ids.length]!] : [] })),
      scenarios: [
        { id: "one", steps: ids.slice(0, 8) },
        { id: "two", steps: [...ids].reverse().slice(0, 8) },
      ],
      tasks: [{ id: "t1", parts: ["free1"] }, { id: "t2", parts: ["solo", "pay0"] }, { id: "t3", parts: [] }],
    };
    const plain = written(MANY).block;
    const full = written(more).block;
    expect(full.layout.edges.length).toBe(20);
    expect(full.tasks.length).toBe(3);
    expect(JSON.stringify(full.layout)).not.toBe(JSON.stringify(plain.layout));
    expect(JSON.stringify(full.raised)).toBe(JSON.stringify(plain.raised));
  });

  test("a plan of the size of one in use", () => {
    const repo = makeRepo(treeOf(HOST));
    expect(run(["update"], repo).code).toBe(0);
    const block = expectPage(repo, PAGE);
    expect([block.raised.parts.length, block.raised.externals.length, block.layout.edges.length]).toEqual([11, 2, 21]);
    const heights = block.raised.parts.map((p) => p.z);
    console.log(
      `E336: raised picture ${sizeOf(block)}, plane picture ${block.layout.width} x ${block.layout.height}, K ${K}, H0 ${H0}, ` +
        `projection ${JSON.stringify(block.raised.projection)}, z ${Math.min(...heights)} to ${Math.max(...heights)}`,
    );
  });
});

function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe("the raised picture on generated plans", () => {
  test.each(Array.from({ length: 200 }, (_, i) => i + 1))("seed %i", (seed) => {
    const r = random(seed);
    const upTo = (n: number) => Math.floor(r() * (n + 1));
    const zones = ["", ...["north", "남쪽 구역", "e", "a zone in the west with a long name"].slice(0, upTo(4))];
    const letters = ["a", "가", "Q", "-", "한"];
    const inputs: PartInput[] = Array.from({ length: upTo(40) }, (_, i) => {
      const planned = r() < 0.1;
      return {
        id: `p${i}`,
        name: Array.from({ length: 1 + upTo(39) }, () => letters[upTo(letters.length - 1)]!).join(""),
        zone: zones[upTo(zones.length - 1)] || undefined,
        lines: planned ? 0 : r() < 0.3 ? upTo(30) : r() < 0.9 ? upTo(4000) : upTo(50000),
        files: planned ? 0 : upTo(40),
        planned,
      };
    });
    const externals = Array.from({ length: upTo(6) }, (_, i) => ({ id: `x${i}`, name: r() < 0.3 ? "" : "외부 system ".repeat(1 + upTo(2)) }));
    const block = {
      plan: {
        parts: inputs.map((p) => ({ id: p.id, name: p.name, ...(p.zone ? { zone: p.zone } : {}), ...(p.planned ? { planned: true } : {}) })),
        externals,
      },
      measure: { parts: inputs.map((p) => ({ id: p.id, files: p.files, lines: p.lines })), files: 0, lines: 0 },
      layout: layOut(inputs, externals),
      raised: raisedPicture(inputs, externals),
    };
    expectRaised(block);
    expect(raisedPicture(inputs, externals)).toEqual(block.raised);
  });
});

describe("update time with the raised picture", () => {
  test("200 parts, 20 externals, 500 relations and 200 steps within 10 seconds", () => {
    const ids = [...Array.from({ length: 200 }, (_, i) => `p${i}`), ...Array.from({ length: 20 }, (_, i) => `x${i}`)];
    const spec: PlanSpec = {
      parts: Array.from({ length: 200 }, (_, i) => ({
        id: `p${i}`,
        zone: i % 5 === 0 ? undefined : `zone${i % 4}`,
        lines: (i * 37) % 900,
        uses: [ids[(i * 7 + 1) % 220]!, ids[(i * 13 + 5) % 220]!, ...(i % 2 === 0 ? [ids[(i * 3 + 11) % 220]!] : [])].filter((to) => to !== `p${i}`),
      })),
      externals: Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, name: `External ${i}` })),
      scenarios: [Array.from({ length: 200 }, (_, i) => ids[(i * 17) % 220]!)],
    };
    const repo = makeRepo(treeOf(spec));
    const started = performance.now();
    expect(run(["update"], repo).code).toBe(0);
    const seconds = (performance.now() - started) / 1000;
    const block = readBlock(readFileSync(join(repo, PAGE), "utf8")).block;
    expect([block.raised.parts.length, block.raised.externals.length]).toEqual([200, 20]);
    expect(block.layout.edges.length).toBeGreaterThanOrEqual(480);
    // The raised picture alone, on the same parts.
    const inputs = block.plan.parts.map((p, i) => ({
      id: p.id, name: p.name, zone: p.zone, lines: block.measure.parts[i]!.lines, files: block.measure.parts[i]!.files, planned: false,
    }));
    const before = performance.now();
    raisedPicture(inputs, block.plan.externals ?? []);
    const alone = (performance.now() - before) / 1000;
    console.log(`E338: update ${seconds.toFixed(2)} s, of which the raised picture ${alone.toFixed(3)} s; raised picture ${sizeOf(block)}`);
    expect(seconds).toBeLessThan(10);
  });
});

describe("the picture button and the fragment", () => {
  const spec: Spec = {
    parts: [{ id: "cart", zone: "store", lines: 30, uses: ["pay"] }, { id: "pay", zone: "store", lines: 400 }, { id: "admin", lines: 6 }],
    externals: [{ id: "bank", name: "Bank" }],
    scenarios: [{ id: "s", steps: ["cart", "pay", "bank"] }],
    tasks: [{ id: "t", parts: ["pay"] }],
  };
  const file = () => join(written(spec).repo, PAGE);
  const open = (hash: string) => openViewer(file(), hash);
  const taskButton = (v: Viewer) => v.doc.byId.get("tasks")!.all().find((e) => e.getAttribute("data-task") === "t")!;
  const chosenTask = (v: Viewer) => taskButton(v).getAttribute("aria-pressed") === "true";
  // What shows: the picture, the button's text, the step text, the marked
  // rectangles and the fragment.
  const seen = (v: Viewer) => ({
    picture: v.picture().shown,
    button: v.picture().text,
    step: v.state().step,
    active: v.doc.byId.get("plane")!.all().concat(v.raised.all()).filter((e) => e.hasAttribute("data-active")).map((e) => e.getAttribute("data-id") ?? e.name),
    task: chosenTask(v),
    hash: v.location.hash,
  });
  const PLANE = { picture: "plane", button: "raised", step: "", active: [], task: false };
  const RAISED = { picture: "raised", button: "plane", step: "", active: [], task: false, hash: "#picture=raised" };

  test.each([
    ["", { ...PLANE, hash: "" }],
    ["#picture=raised", RAISED],
    ["#picture=plane", { ...PLANE, hash: "#picture=plane" }],
    ["#picture=", { ...PLANE, hash: "#picture=" }],
    ["#picture=RAISED", { ...PLANE, hash: "#picture=RAISED" }],
    ["#picture", { ...PLANE, hash: "#picture" }],
    ["#scenario=s&picture=raised", { ...PLANE, step: "1/3 cart: step", active: ["cart"], hash: "#scenario=s&picture=raised" }],
    ["#scenario=nope&picture=raised", { ...PLANE, hash: "#scenario=nope&picture=raised" }],
    ["#task=t&picture=raised", { ...PLANE, active: ["pay"], task: true, hash: "#task=t&picture=raised" }],
    ["#task=nope&picture=raised", { ...PLANE, hash: "#task=nope&picture=raised" }],
    ["#picture=plane&picture=raised", RAISED],
  ])("opened with %j", (hash, want) => {
    expect(seen(open(hash))).toEqual(want);
  });

  test("the button ends a walk-through, and the fragment is the picture alone", () => {
    const v = open("#scenario=s&step=2");
    expect(seen(v)).toMatchObject({ picture: "plane", step: "2/3 pay: step" });
    expect(v.state().lines).toEqual(["cart->pay"]);
    v.picture().button.dispatch("click");
    expect(seen(v)).toEqual(RAISED);
    expect(v.state()).toMatchObject({ selected: 0, rects: [], lines: [], history: 1 });
  });

  test("the button ends a chosen task", () => {
    const v = open("#task=t");
    expect(seen(v)).toMatchObject({ task: true, active: ["pay"] });
    v.picture().button.dispatch("click");
    expect(seen(v)).toEqual(RAISED);
  });

  test("choosing a scenario in the raised picture shows the plane picture and opens it", () => {
    const v = open("#picture=raised");
    v.choose(1);
    expect(seen(v)).toEqual({ ...PLANE, step: "1/3 cart: step", active: ["cart"], hash: "#scenario=s&step=1" });
  });

  test("choosing a task in the raised picture shows the plane picture and chooses it", () => {
    const v = open("#picture=raised");
    taskButton(v).dispatch("click");
    expect(seen(v)).toEqual({ ...PLANE, active: ["pay"], task: true, hash: "#task=t" });
  });

  test("the button in the raised picture shows the plane picture and takes the fragment away", () => {
    const v = open("#picture=raised");
    v.picture().button.dispatch("click");
    expect(seen(v)).toEqual({ ...PLANE, hash: "" });
    expect(v.state().history).toBe(1);
    v.picture().button.dispatch("click");
    expect(seen(v)).toEqual(RAISED);
  });

  test("Esc and the arrow keys do nothing in the raised picture", () => {
    const v = open("#picture=raised");
    for (const key of ["Escape", "ArrowLeft", "ArrowRight"]) v.press(key);
    expect(seen(v)).toEqual(RAISED);
  });

  test("a changed fragment is read the same way", () => {
    const v = open("#picture=raised");
    v.navigate("#scenario=s&step=3");
    // The step from pay to bank has no edge: its connector is marked too.
    expect(seen(v)).toEqual({ ...PLANE, step: "3/3 Bank: step", active: ["bank", "polyline"], hash: "#scenario=s&step=3" });
    v.navigate("#picture=raised");
    expect(seen(v)).toEqual(RAISED);
    expect(v.state().selected).toBe(0);
    v.navigate("#task=t");
    expect(seen(v)).toMatchObject({ picture: "plane", task: true });
    v.navigate("#picture=plane&picture=raised");
    expect(seen(v)).toEqual(RAISED);
    v.navigate("#picture=plane");
    expect(seen(v)).toEqual({ ...PLANE, hash: "#picture=plane" });
    v.navigate("#picture=raised");
    v.navigate("");
    expect(seen(v)).toEqual({ ...PLANE, hash: "" });
  });

  test("the theme button leaves the picture and the fragment", () => {
    const v = open("#picture=raised");
    v.theme().button.dispatch("click");
    expect(seen(v)).toEqual(RAISED);
  });

  test("the frame has one picture button, outside the scenario pane, and nothing that moves", () => {
    const page = readFileSync(file(), "utf8");
    const v = openViewer(file());
    const tools = v.doc.byId.get("tools")!.children;
    expect(tools.map((c) => [c.name, c.getAttribute("data-role")])).toEqual([["button", "picture"], ["button", "theme"]]);
    expect(v.walk.all().filter((e) => e.getAttribute("data-role") === "picture")).toEqual([]);
    const frame = page.replace(readBlock(page).raw, "");
    expect(frame).not.toMatch(/setInterval|requestAnimationFrame|setTimeout|transition|animation|@keyframes/);
  });
});

describe("a page from before the raised picture", () => {
  test.each(Object.keys(NO_LINES))("%s: check says outdated until update", (name) => {
    const repo = makeRepo(treeOf(NO_LINES[name]!));
    expect(run(["update"], repo).code).toBe(0);
    const outdated = () => {
      const out = run(["check"], repo);
      return (out.stdout + out.stderr).split("\n").some((l) => !l.startsWith("check:") && l.includes("outdated"));
    };
    expect(outdated()).toBe(false);
    // The page as it was: the same block without the raised picture.
    const page = readFileSync(join(repo, PAGE), "utf8");
    const { block, raw } = readBlock(page);
    const { raised: _raised, ...older } = block;
    writeFileSync(join(repo, PAGE), page.replace(raw, JSON.stringify(older)));
    expect(outdated()).toBe(true);
    expect(run(["check"], repo).code).toBe(1);
    expect(run(["update"], repo).code).toBe(0);
    expect(outdated()).toBe(false);
    expect(readFileSync(join(repo, PAGE), "utf8")).toBe(page);
  });
});
