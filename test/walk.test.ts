import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { run } from "../src/cli.js";
import { lines, makeRepo, type Tree } from "./helpers.js";
import { openViewer, type Viewer } from "./viewer-dom.js";

// The viewer code is run in node:vm against a stand-in document: the
// sandbox here cannot start a browser.
const K5: Tree = {
  "package.json": lines(1),
  "src/cart/add.ts": lines(3),
  "src/cart/total.ts": lines(2),
  "src/pay/charge.ts": lines(4),
  "src/pay/charge.test.ts": lines(1),
  "src/admin/panel.ts": lines(6),
};
const PAGE = "docs/codeplan/codeplan.html";

const WALK_PLAN = {
  format: 1,
  name: "mall",
  about: "",
  parts: [
    { id: "cart", name: "Cart", zone: "store", about: "", paths: ["src/cart/**"], uses: [{ to: "pay" }] },
    { id: "pay", name: "Pay", zone: "store", about: "", paths: ["src/pay/**"], uses: [{ to: "ledger" }] },
    { id: "admin", name: "Admin", about: "", paths: ["src/admin/**"] },
  ],
  externals: [{ id: "ledger", name: "Ledger", about: "" }],
  scenarios: [
    {
      id: "buy",
      name: "사기",
      steps: [
        { at: "cart", does: "장바구니를 연다" },
        { at: "pay", does: "{cart}에서 값을 받아 {ledger}에 적는다 {nope}" },
        { at: "pay", does: "영수증을 만든다" },
        { at: "cart", does: "돌아간다" },
        { at: "ledger", does: "기록을 남긴다" },
      ],
    },
    { id: "empty", name: "빈 것", steps: [] },
  ],
};

function pageFor(plan: unknown): string {
  const repo = makeRepo({ ...K5, "docs/codeplan/plan.json": JSON.stringify(plan) });
  const out = run(["update"], repo);
  expect(out.code, out.stderr).toBe(0);
  return join(repo, PAGE);
}

// The structure the page promises: rects and polylines match the layout.
function expectStructure(v: Viewer): void {
  const { layout } = v.block;
  const rects = v.plane.all().filter((e) => e.name === "rect" && e.hasAttribute("data-id"));
  expect(rects.map((r) => r.getAttribute("data-id"))).toEqual([...layout.parts, ...layout.externals].map((p) => p.id));
  for (const box of [...layout.parts, ...layout.externals]) {
    const r = rects.find((e) => e.getAttribute("data-id") === box.id)!;
    expect(["x", "y", "width", "height"].map((k) => Number(r.getAttribute(k)))).toEqual([box.x, box.y, box.w, box.h]);
  }
  const polylines = v.plane.all().filter((e) => e.name === "polyline");
  const asPoints = (list: [number, number][]) => list.map(([x, y]) => `${x},${y}`).join(" ");
  expect(polylines.map((p) => p.getAttribute("points"))).toEqual([
    ...layout.edges.map((e) => asPoints(e.points)),
    ...layout.connectors.map((c) => asPoints(c.points)),
  ]);
  expect(polylines.filter((p) => p.hasAttribute("data-from")).map((p) => [p.getAttribute("data-from"), p.getAttribute("data-to")])).toEqual(
    layout.edges.map((e) => [e.from, e.to]),
  );
  expect(polylines.filter((p) => p.hasAttribute("data-scenario")).map((p) => [p.getAttribute("data-scenario"), p.getAttribute("data-step")])).toEqual(
    layout.connectors.map((c) => [c.scenario, String(c.step)]),
  );
}

const closed = { step: "", rects: [], lines: [], hash: "", selected: 0 };

describe("the page without scenarios", () => {
  test("labels, external labels, legend and title; no scenario controls", () => {
    const v = openViewer(
      pageFor({
        format: 1,
        name: "mall",
        about: "",
        parts: [
          { id: "cart", name: "Cart", zone: "store", about: "", paths: ["src/cart/**"], uses: [{ to: "ledger" }] },
          { id: "pay", name: "", zone: "store", about: "", paths: ["src/pay/**"] },
          { id: "admin", name: "Admin", about: "", paths: ["src/admin/**"] },
        ],
        externals: [{ id: "ledger", name: "", about: "" }],
      }),
    );
    expectStructure(v);
    expect(v.plane.attrs.get("viewBox")).toBe(`0 0 ${v.block.layout.width} ${v.block.layout.height}`);
    const texts = v.plane.all().filter((e) => e.name === "text").map((e) => e.textContent);
    expect(texts).toEqual(["store", "Cart", "5 lines", "2 files", "pay", "4 lines", "1 files", "Admin", "6 lines", "1 files", "ledger", "external"]);
    expect(v.legend.children.map((c) => c.textContent)).toEqual(["4 files, 15 lines · mall"]);
    expect(v.doc.title).toBe("mall");
    expect(v.walk.children).toEqual([]);
  });
});

describe("walking through a scenario", () => {
  const page = () => pageFor(WALK_PLAN);

  test("opening without a fragment shows nothing walked", () => {
    const v = openViewer(page());
    expectStructure(v);
    expect(v.state()).toMatchObject({ ...closed, disabled: [true, true] });
    const select = v.walk.children.find((c) => c.name === "select")!;
    expect(select.children.map((o) => o.textContent)).toEqual(["(none)", "사기", "빈 것"]);
    expect(v.walk.children.filter((c) => c.name === "button")).toHaveLength(2);
    const visible = v.walk.all().map((e) => e.textContent).join(" ") + v.legend.all().map((e) => e.textContent).join(" ");
    expect(visible).not.toMatch(/Esc|←|→/);
    for (const b of v.walk.children.filter((c) => c.name === "button")) expect(b.title).toMatch(/arrow key/);
  });

  test("steps forward and back with the button and the arrow keys; Esc ends", () => {
    const v = openViewer(page(), "#scenario=buy&step=1");
    expect(v.state()).toMatchObject({
      step: "1/5 Cart: 장바구니를 연다", rects: ["cart"], lines: [], hash: "#scenario=buy&step=1", selected: 1, focusOnNext: true,
    });
    v.click("next");
    expect(v.state()).toMatchObject({
      step: "2/5 Pay: Cart에서 값을 받아 Ledger에 적는다 {nope}", rects: ["pay"], lines: ["cart->pay"], hash: "#scenario=buy&step=2", selected: 1, history: 1,
    });
    v.press("ArrowRight");
    expect(v.state()).toMatchObject({ step: "3/5 Pay: 영수증을 만든다", rects: ["pay"], lines: [], hash: "#scenario=buy&step=3" });
    v.press("ArrowRight");
    expect(v.state()).toMatchObject({ step: "4/5 Cart: 돌아간다", rects: ["cart"], lines: ["cart->pay"], hash: "#scenario=buy&step=4" });
    v.press("ArrowRight");
    expect(v.state()).toMatchObject({ step: "5/5 Ledger: 기록을 남긴다", rects: ["ledger"], lines: ["buy#4"], hash: "#scenario=buy&step=5", disabled: [false, true] });
    v.press("ArrowRight");
    expect(v.state()).toMatchObject({ step: "5/5 Ledger: 기록을 남긴다", rects: ["ledger"], lines: ["buy#4"], hash: "#scenario=buy&step=5", history: 1 });
    v.press("ArrowLeft");
    expect(v.state()).toMatchObject({ step: "4/5 Cart: 돌아간다", rects: ["cart"], lines: ["cart->pay"] });

    const select = v.walk.children.find((c) => c.name === "select")!;
    select.focus();
    v.press("Escape");
    expect(v.state()).toMatchObject({ step: "4/5 Cart: 돌아간다", selected: 1, hash: "#scenario=buy&step=4" });
    v.doc.activeElement = v.doc.body;
    v.press("Escape");
    expect(v.state()).toMatchObject({ ...closed, history: 1 });
  });

  test("back at the first step does nothing; the first item ends the walk", () => {
    const v = openViewer(page(), "#scenario=buy&step=1");
    v.press("ArrowLeft");
    expect(v.state()).toMatchObject({ step: "1/5 Cart: 장바구니를 연다", rects: ["cart"], hash: "#scenario=buy&step=1", disabled: [true, false] });
    v.choose(0);
    expect(v.state()).toMatchObject(closed);
  });

  test("choosing in the select box opens the first step and moves focus", () => {
    const v = openViewer(page());
    v.choose(1);
    expect(v.state()).toMatchObject({ step: "1/5 Cart: 장바구니를 연다", rects: ["cart"], lines: [], hash: "#scenario=buy&step=1", selected: 1, focusOnNext: true, history: 1 });
    const w = openViewer(page());
    w.choose(2);
    expect(w.state()).toMatchObject({ rects: [], lines: [], hash: "#scenario=empty", selected: 2, disabled: [true, true], focusOnNext: false, history: 1 });
    expect(w.state().step).not.toMatch(/^\d+\/\d+ /);
  });

  test.each([
    ["#scenario=buy", "1/5 Cart: 장바구니를 연다", true],
    ["#scenario=buy&step=5", "5/5 Ledger: 기록을 남긴다", false],
    ["#scenario=buy&step=9", "1/5 Cart: 장바구니를 연다", true],
    ["#scenario=buy&step=0", "1/5 Cart: 장바구니를 연다", true],
    ["#scenario=buy&step=abc", "1/5 Cart: 장바구니를 연다", true],
    ["#scenario=buy&step=2.5", "1/5 Cart: 장바구니를 연다", true],
    ["#scenario=buy&step=-2", "1/5 Cart: 장바구니를 연다", true],
    ["#scenario=buy&step=02", "2/5 Pay: Cart에서 값을 받아 Ledger에 적는다 {nope}", true],
  ] as [string, string, boolean][])("the fragment %s", (hash, step, focus) => {
    const v = openViewer(page(), hash);
    expect(v.state()).toMatchObject({ step, selected: 1, focusOnNext: focus });
  });

  test("an unknown scenario id opens nothing; a scenario without steps says so", () => {
    // An unknown id is ignored: nothing opens and the fragment is left as it is.
    expect(openViewer(page(), "#scenario=nope&step=2").state()).toMatchObject({ ...closed, hash: "#scenario=nope&step=2" });
    const v = openViewer(page(), "#scenario=empty&step=2");
    expect(v.state()).toMatchObject({ rects: [], lines: [], selected: 2, disabled: [true, true], focusOnNext: false });
    expect(v.state().step).not.toMatch(/^\d+\/\d+ /);
  });

  test("the frame has nothing that moves on its own", () => {
    const html = readFileSync(page(), "utf8");
    const outside = html.slice(0, html.indexOf('id="codeplan-data"')) + html.slice(html.indexOf("</script>"));
    expect(outside).not.toMatch(/@keyframes|animation:|<animate|requestAnimationFrame|setInterval|setTimeout|stroke-dashoffset/);
  });

  test("plan text stays text", () => {
    const v = openViewer(
      pageFor({
        format: 1,
        name: "<b>Shop</b>",
        about: '<img src=x onerror="window.__pwn=1">',
        parts: [
          { id: "cart", name: "Cart", about: "<b>굵게</b>", paths: ["src/cart/**"] },
          { id: "pay", name: "Pay", about: "", paths: ["src/pay/**"] },
          { id: "admin", name: "Admin", about: "", paths: ["src/admin/**"] },
        ],
        scenarios: [
          {
            id: "s",
            name: "<i>s</i>",
            steps: [
              { at: "cart", does: '<b>굵게</b> <img src=x onerror="window.__pwn=1">' },
              { at: "cart", does: "&amp; 그대로" },
            ],
          },
        ],
      }),
      "#scenario=s&step=1",
    );
    expect(v.state()).toMatchObject({ step: '1/2 Cart: <b>굵게</b> <img src=x onerror="window.__pwn=1">', rects: ["cart"], lines: [] });
    v.press("ArrowRight");
    expect(v.state()).toMatchObject({ step: "2/2 Cart: &amp; 그대로", rects: ["cart"], lines: [] });
    expect(v.doc.title).toBe("<b>Shop</b>");
    const all = [...v.plane.all(), ...v.walk.all(), ...v.legend.all()].map((e) => e.name);
    expect(all).not.toContain("img");
    expect(all).not.toContain("b");
  });
});

describe("walking through: more cases", () => {
  const plan = (parts: unknown[], externals: unknown[], scenarios: unknown[]) => ({ format: 1, name: "mall", about: "", parts, externals, scenarios });
  const cart = (extra: object = {}) => ({ id: "cart", name: "Cart", zone: "store", about: "", paths: ["src/cart/**"], ...extra });
  const pay = (extra: object = {}) => ({ id: "pay", name: "Pay", zone: "store", about: "", paths: ["src/pay/**"], ...extra });
  const admin = { id: "admin", name: "Admin", about: "", paths: ["src/admin/**"] };

  test("choosing the first item again ends the walk", () => {
    const v = openViewer(pageFor(WALK_PLAN), "#scenario=buy&step=2");
    expect(v.state()).toMatchObject({ step: "2/5 Pay: Cart에서 값을 받아 Ledger에 적는다 {nope}", rects: ["pay"], lines: ["cart->pay"], hash: "#scenario=buy&step=2", selected: 1 });
    v.choose(0);
    expect(v.state()).toMatchObject({ ...closed, history: 1 });
  });

  test("both edges between two places light up, whichever way the step goes", () => {
    const page = pageFor(plan([cart({ uses: [{ to: "pay" }] }), pay({ uses: [{ to: "cart" }] }), admin], [], [
      { id: "go", name: "오가기", steps: [{ at: "cart", does: "보낸다" }, { at: "pay", does: "받는다" }, { at: "cart", does: "돌려받는다" }] },
    ]));
    const v = openViewer(page, "#scenario=go&step=2");
    expect(v.state()).toMatchObject({ step: "2/3 Pay: 받는다", rects: ["pay"], lines: ["cart->pay", "pay->cart"], selected: 1 });
    v.press("ArrowRight");
    expect(v.state()).toMatchObject({ step: "3/3 Cart: 돌려받는다", rects: ["cart"], lines: ["cart->pay", "pay->cart"], selected: 1 });
  });

  test("empty names show ids", () => {
    const page = pageFor(plan([cart({ name: "", uses: [{ to: "ledger" }] }), pay(), admin], [{ id: "ledger", name: "", about: "" }], [
      { id: "trip", name: "", steps: [{ at: "cart", does: "{ledger}에 적는다" }, { at: "ledger", does: "{cart}에서 받는다" }] },
    ]));
    const first = openViewer(page);
    expect(first.state()).toMatchObject(closed);
    expect(first.walk.children.find((c) => c.name === "select")!.children.map((o) => o.textContent)).toEqual(["(none)", "trip"]);
    const v = openViewer(page, "#scenario=trip&step=1");
    expect(v.state()).toMatchObject({ step: "1/2 cart: ledger에 적는다", rects: ["cart"], lines: [], selected: 1 });
    v.press("ArrowRight");
    expect(v.state()).toMatchObject({ step: "2/2 ledger: cart에서 받는다", rects: ["ledger"], lines: ["cart->ledger"], selected: 1 });
    expect(v.block.layout.parts.find((p) => p.id === "cart")!.label.w).toBe(61);
  });

  test("a step at an external, and a connector from an external to a part", () => {
    const page = pageFor(plan([cart(), pay(), admin], [{ id: "ledger", name: "Ledger", about: "" }], [
      { id: "back", name: "되돌림", steps: [{ at: "ledger", does: "알린다" }, { at: "admin", does: "본다" }] },
    ]));
    const v = openViewer(page, "#scenario=back&step=1");
    expect(v.state()).toMatchObject({ step: "1/2 Ledger: 알린다", rects: ["ledger"], lines: [], selected: 1 });
    v.press("ArrowRight");
    expect(v.state()).toMatchObject({ step: "2/2 Admin: 본다", rects: ["admin"], lines: ["back#1"], selected: 1 });
  });

  test.each([
    ["1", "1/5 Cart: 장바구니를 연다", [true, false]],
    ["3", "3/5 Pay: 영수증을 만든다", [false, false]],
    ["5", "5/5 Ledger: 기록을 남긴다", [false, true]],
  ] as [string, string, [boolean, boolean]][])("buttons at step %s", (k, step, disabled) => {
    expect(openViewer(pageFor(WALK_PLAN), `#scenario=buy&step=${k}`).state()).toMatchObject({ step, disabled, selected: 1 });
  });
});

describe("walking through: keys with modifiers, fragment changes, arrowheads", () => {
  test("arrow keys and Esc with Alt, Ctrl or Meta are left to the browser", () => {
    const v = openViewer(pageFor(WALK_PLAN), "#scenario=buy&step=2");
    for (const mod of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
      v.press("ArrowRight", mod);
      v.press("ArrowLeft", mod);
      v.press("Escape", mod);
      expect(v.state()).toMatchObject({ step: "2/5 Pay: Cart에서 값을 받아 Ledger에 적는다 {nope}", hash: "#scenario=buy&step=2" });
    }
  });

  test("a fragment that changes after opening opens again; no fragment ends; an unknown id is ignored", () => {
    const v = openViewer(pageFor(WALK_PLAN));
    v.navigate("#scenario=buy&step=4");
    expect(v.state()).toMatchObject({ step: "4/5 Cart: 돌아간다", rects: ["cart"], lines: ["cart->pay"], selected: 1, focusOnNext: true, history: 1 });
    // Opened from the fragment: the fragment is left as written.
    v.navigate("#scenario=buy&step=02");
    expect(v.state()).toMatchObject({ step: "2/5 Pay: Cart에서 값을 받아 Ledger에 적는다 {nope}", lines: ["cart->pay"], hash: "#scenario=buy&step=02" });
    expect(openViewer(pageFor(WALK_PLAN), "#scenario=buy&step=9").state()).toMatchObject({ step: "1/5 Cart: 장바구니를 연다", hash: "#scenario=buy&step=9" });
    v.navigate("#scenario=buy&step=4");
    v.navigate("#scenario=nope&step=1");
    expect(v.state()).toMatchObject({ step: "4/5 Cart: 돌아간다", selected: 1 });
    v.navigate("#scenario=empty");
    expect(v.state()).toMatchObject({ rects: [], selected: 2, disabled: [true, true], hash: "#scenario=empty" });
    v.navigate("");
    expect(v.state()).toMatchObject({ ...closed, history: 1 });
  });

  test("the arrowhead keeps a fixed size in drawing units", () => {
    const v = openViewer(pageFor(WALK_PLAN));
    const marker = v.plane.all().find((e) => e.name === "marker")!;
    expect(marker.getAttribute("markerUnits")).toBe("userSpaceOnUse");
    const size = Math.max(Number(marker.getAttribute("markerWidth")), Number(marker.getAttribute("markerHeight")));
    // Shorter than the gap of 8 before a rectangle and the outer margin of 8.
    expect(size).toBeLessThan(8);
    const { layout } = v.block;
    for (const e of layout.edges) {
      const [x, y] = e.points.at(-1)!;
      expect(x >= size && y >= size && x <= layout.width - size && y <= layout.height - size).toBe(true);
    }
  });
});
