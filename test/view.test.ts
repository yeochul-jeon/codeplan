// The view of the picture: the first state, zoom buttons and keys, Ctrl or
// Cmd with the wheel, the drag, when the first state comes back, and the
// scroll to the rectangle of a scenario step. The pages are written from a
// data block made here, so each picture has the size a test needs.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { pageHtml } from "../src/page.js";
import { tempDir } from "./helpers.js";
import { openViewer, type Viewer } from "./viewer-dom.js";

interface Rect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

// A page whose plane picture is W x H with the given part rectangles, and
// whose raised picture is RW x RH with no shapes.
function pageFile(o: { W: number; H: number; RW?: number; RH?: number; parts?: Rect[]; steps?: string[]; task?: string }): string {
  const parts = o.parts ?? [];
  const label = (r: Rect) => ({ x: r.x, y: r.y, w: Math.min(r.w, 60), h: 20 });
  const data = {
    format: 2,
    plan: {
      format: 1,
      name: "view",
      about: "",
      parts: parts.map((r) => ({ id: r.id, name: r.id, about: "", paths: [`src/${r.id}/**`] })),
      externals: [],
      scenarios: o.steps ? [{ id: "s", name: "S", steps: o.steps.map((at) => ({ at, does: "x" })) }] : [],
      ...(o.task ? { tasks: [{ id: "t", name: "T", status: "open", makes: [] }] } : {}),
    },
    measure: { parts: parts.map((r) => ({ id: r.id, files: 1, lines: 1 })), files: parts.length, lines: parts.length },
    orphans: [],
    unwatched: 0,
    tasks: o.task ? [{ id: "t", marks: [o.task], missing: [] }] : [],
    layout: {
      width: o.W,
      height: o.H,
      zones: [],
      parts: parts.map((r) => ({ ...r, label: label(r) })),
      externals: [],
      edges: [],
      connectors: [],
    },
    raised: {
      width: o.RW ?? 600,
      height: o.RH ?? 300,
      projection: { x: [1, 0, 1, 8], y: [0, 1, -1, 8] },
      zones: [],
      parts: [],
      externals: [],
      order: [],
    },
  };
  const file = join(tempDir(), "codeplan.html");
  writeFileSync(file, pageHtml(data as unknown as Parameters<typeof pageHtml>[0]));
  return file;
}

// The frame is 800 wide, the window 1000 high (80% is 800), and the frame
// sits at (16, 40) on the screen.
const SIZE = { width: 800, height: 1000 };
function open(file: string, hash = "", storage = new Map<string, string>()): Viewer {
  const v = openViewer(file, hash, storage, SIZE);
  v.frame.box = { left: 16, top: 40 };
  return v;
}
const button = (v: Viewer, role: string) => v.doc.byId.get("tools")!.children.find((c) => c.getAttribute("data-role") === role)!;
const press = (v: Viewer, role: string) => button(v, role).dispatch("click");
// The drawing point at (x, y) in the frame, for the plane picture.
function pointAt(v: Viewer, W: number, H: number, x: number, y: number): [number, number] {
  const { scale: s, left, top, height } = v.view();
  const gap = (f: number, l: number) => Math.max(0, (f - l * s) / 2);
  return [(left + x - gap(800, W)) / s, (top + y - gap(height, H)) / s];
}
const near = (a: number[], b: number[]) => a.forEach((n, i) => expect(n).toBeCloseTo(b[i]!, 9));

// Tall: 1000 x 4000, as wide as the frame at 0.8, frame 800 high.
const TALL = { W: 1000, H: 4000 };
// Wide: 2000 x 500, at 0.4, frame 200 high.
const WIDE = { W: 2000, H: 500 };
// Small: 100 x 50, at 2 (the first scale is at most 2), frame 100 high.
const SMALL = { W: 100, H: 50 };

describe("the first state", () => {
  test("a tall picture is as wide as the frame, top left, in a frame 80% of the window high", () => {
    const v = open(pageFile(TALL));
    expect(v.view()).toEqual({ scale: 0.8, left: 0, top: 0, height: 800 });
    expect([v.plane.getAttribute("width"), v.plane.getAttribute("height")]).toEqual(["800", "3200"]);
    expect(v.frame.style.height).toBe("3200px");
  });

  test("a wide picture has a frame as high as the picture, and fit gives the same", () => {
    const v = open(pageFile(WIDE));
    expect(v.view()).toEqual({ scale: 0.4, left: 0, top: 0, height: 200 });
    press(v, "fit");
    expect(v.view()).toEqual({ scale: 0.4, left: 0, top: 0, height: 200 });
    press(v, "fit-width");
    expect(v.view()).toEqual({ scale: 0.4, left: 0, top: 0, height: 200 });
  });

  test("a small picture opens at 2 and zooms in up to 4", () => {
    const v = open(pageFile(SMALL));
    expect(v.view()).toEqual({ scale: 2, left: 0, top: 0, height: 100 });
    const scales = [];
    for (let i = 0; i < 5; i++) {
      press(v, "zoom-in");
      scales.push(v.view().scale);
    }
    near(scales, [2.5, 3.125, 3.90625, 4, 4]);
  });

  test("a plan with no parts opens at 2 in a frame 2px high", () => {
    const v = open(pageFile({ W: 1, H: 1 }));
    expect(v.view()).toEqual({ scale: 2, left: 0, top: 0, height: 2 });
  });
});

describe("the zoom buttons", () => {
  test("+ and − keep the drawing point at the middle of the frame", () => {
    const v = open(pageFile(TALL));
    const middle = pointAt(v, TALL.W, TALL.H, 400, 400);
    press(v, "zoom-in");
    expect(v.view().scale).toBeCloseTo(1, 12);
    near(pointAt(v, TALL.W, TALL.H, 400, 400), middle);
    expect([v.view().left, v.view().top]).toEqual([100, 100]);
    press(v, "zoom-out");
    expect(v.view().scale).toBeCloseTo(0.8, 12);
    near(pointAt(v, TALL.W, TALL.H, 400, 400), middle);
    press(v, "zoom-out");
    expect(v.view().scale).toBeCloseTo(0.64, 12);
  });

  test("fit shows the whole picture; width goes back to the first state", () => {
    const v = open(pageFile(TALL));
    press(v, "zoom-in");
    press(v, "fit");
    expect(v.view()).toEqual({ scale: 0.2, left: 0, top: 0, height: 800 });
    press(v, "fit-width");
    expect(v.view()).toEqual({ scale: 0.8, left: 0, top: 0, height: 800 });
    press(v, "zoom-in");
    press(v, "fit-width");
    expect(v.view()).toEqual({ scale: 0.8, left: 0, top: 0, height: 800 });
  });

  test("+ at the largest scale and − at the smallest change nothing", () => {
    const v = open(pageFile(SMALL));
    press(v, "zoom-out");
    expect(v.view()).toEqual({ scale: 2, left: 0, top: 0, height: 100 });
    for (let i = 0; i < 4; i++) press(v, "zoom-in");
    const at = v.view();
    press(v, "zoom-in");
    expect(v.view()).toEqual(at);
  });

  test("the buttons have their text and name their key", () => {
    const v = open(pageFile(TALL));
    expect(["zoom-in", "zoom-out", "fit", "fit-width"].map((r) => button(v, r).textContent)).toEqual(["+", "−", "fit", "width"]);
    expect(button(v, "zoom-in").title).toContain("+");
    expect(button(v, "zoom-out").title).toContain("-");
    expect(button(v, "fit").title).toContain("0");
  });
});

describe("the wheel", () => {
  // The pointer at (200, 300) in the frame.
  const at = { clientX: 216, clientY: 340 };
  const zoomed = (event: Parameters<Viewer["wheel"]>[0]) => {
    const v = open(pageFile(TALL));
    const before = pointAt(v, TALL.W, TALL.H, 200, 300);
    const result = v.wheel({ ...at, ...event });
    return { v, before, result, factor: v.view().scale / 0.8 };
  };

  test("Ctrl with the wheel zooms by 1.25 for each 100 of deltaY, at most 1.25 at a time, at the pointer", () => {
    const one = zoomed({ ctrlKey: true, deltaY: -100 });
    expect(one.factor).toBeCloseTo(1.25, 12);
    near(pointAt(one.v, TALL.W, TALL.H, 200, 300), one.before);
    expect(one.result.prevented).toBe(true);
    expect(zoomed({ ctrlKey: true, deltaY: -1000 }).factor).toBeCloseTo(1.25, 12);
    expect(zoomed({ ctrlKey: true, deltaY: 10 }).factor).toBeCloseTo(1.25 ** -0.1, 12);
    // Zoomed in first, so the smaller scale needs no cut scroll.
    const v = open(pageFile(TALL));
    press(v, "zoom-in");
    const before = pointAt(v, TALL.W, TALL.H, 200, 300);
    v.wheel({ ...at, ctrlKey: true, deltaY: 10 });
    expect(v.view().scale).toBeCloseTo(1.25 ** -0.1, 12);
    near(pointAt(v, TALL.W, TALL.H, 200, 300), before);
  });

  test("in lines or pages only the sign of deltaY counts; Cmd works as Ctrl", () => {
    expect(zoomed({ ctrlKey: true, deltaMode: 1, deltaY: -3 }).factor).toBeCloseTo(1.25, 12);
    expect(zoomed({ ctrlKey: true, deltaMode: 1, deltaY: 3 }).factor).toBeCloseTo(0.8, 12);
    expect(zoomed({ ctrlKey: true, deltaMode: 2, deltaY: -1 }).factor).toBeCloseTo(1.25, 12);
    expect(zoomed({ metaKey: true, deltaY: -100 }).factor).toBeCloseTo(1.25, 12);
    const none = zoomed({ ctrlKey: true, deltaY: 0 });
    expect([none.factor, none.result.prevented]).toEqual([1, true]);
  });

  test("Ctrl with the wheel at the largest scale changes nothing and still keeps the page from zooming", () => {
    const v = open(pageFile(SMALL));
    for (let i = 0; i < 4; i++) press(v, "zoom-in");
    const before = v.view();
    expect(v.wheel({ ctrlKey: true, deltaY: -100 }).prevented).toBe(true);
    expect(v.view()).toEqual(before);
    expect(v.frame.listenerOptions.get("wheel")).toEqual({ passive: false });
  });

  test("the plain wheel is left to the browser", () => {
    const v = open(pageFile(TALL));
    expect(v.wheel({ ...at, deltaY: 100 }).prevented).toBe(false);
    expect(v.wheel({ ...at, deltaX: 100, deltaY: 0 }).prevented).toBe(false);
    expect(v.view()).toEqual({ scale: 0.8, left: 0, top: 0, height: 800 });
  });
});

describe("the drag", () => {
  // Zoomed to 1: the scroll is (100, 100).
  const zoomedIn = () => {
    const v = open(pageFile(TALL));
    press(v, "zoom-in");
    return v;
  };
  const down = { clientX: 316, clientY: 340 };

  test("a move under 4px does nothing; from 4px on the picture follows the pointer", () => {
    const v = zoomedIn();
    v.pointer("pointerdown", down);
    v.pointer("pointermove", { clientX: 313, clientY: 337 });
    v.pointer("pointerup", { clientX: 313, clientY: 337 });
    expect([v.view().left, v.view().top, v.frame.captured]).toEqual([100, 100, null]);
    v.pointer("pointerdown", down);
    v.pointer("pointermove", { clientX: 316, clientY: 336 });
    expect([v.view().left, v.view().top, v.frame.captured]).toEqual([100, 104, 1]);
    v.pointer("pointermove", { clientX: 266, clientY: 280 });
    expect([v.view().left, v.view().top]).toEqual([150, 160]);
    v.pointer("pointermove", { clientX: -2000, clientY: 340 });
    expect([v.view().left, v.view().top]).toEqual([200, 100]);
    v.pointer("pointerup", {});
    v.pointer("pointermove", { clientX: 0, clientY: 0 });
    expect([v.view().left, v.view().top]).toEqual([200, 100]);
  });

  test("pointercancel ends the drag", () => {
    const v = zoomedIn();
    v.pointer("pointerdown", down);
    v.pointer("pointermove", { clientX: 300, clientY: 340 });
    v.pointer("pointercancel", {});
    v.pointer("pointermove", { clientX: 200, clientY: 340 });
    expect(v.view().left).toBe(116);
  });

  test("another button, a touch, and a press on the scroll bar do not drag", () => {
    for (const start of [
      { ...down, button: 2 },
      { ...down, pointerType: "touch" },
      { clientX: 16 + 800, clientY: 340 },
      { clientX: 316, clientY: 40 + 800 },
    ]) {
      const v = zoomedIn();
      v.pointer("pointerdown", start);
      v.pointer("pointermove", { clientX: 216, clientY: 240 });
      expect([v.view().left, v.view().top, v.frame.captured]).toEqual([100, 100, null]);
    }
    const pen = zoomedIn();
    pen.pointer("pointerdown", { ...down, pointerType: "pen" });
    pen.pointer("pointermove", { clientX: 216, clientY: 340 });
    expect(pen.view().left).toBe(200);
  });
});

describe("the keys", () => {
  const PLAN = { ...TALL, parts: [{ id: "a", x: 50, y: 100, w: 200, h: 100 }], steps: ["a"] };

  test("+ and = zoom in, - zooms out, 0 fits; with Alt, Ctrl or Cmd they do nothing", () => {
    const v = open(pageFile(PLAN));
    v.press("+");
    expect(v.view().scale).toBeCloseTo(1, 12);
    v.press("=");
    expect(v.view().scale).toBeCloseTo(1.25, 12);
    v.press("-");
    expect(v.view().scale).toBeCloseTo(1, 12);
    v.press("0");
    expect(v.view().scale).toBeCloseTo(0.2, 12);
    for (const modifier of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
      v.press("+", modifier);
      v.press("0", modifier);
      expect(v.view().scale).toBeCloseTo(0.2, 12);
    }
  });

  test("with the focus on the scenario list the keys do nothing; during a walk-through + zooms and the step stays", () => {
    const v = open(pageFile(PLAN));
    v.walk.children.find((c) => c.name === "select")!.focus();
    v.press("+");
    expect(v.view().scale).toBe(0.8);
    v.choose(1);
    const state = v.state();
    v.doc.body.focus();
    v.press("+");
    expect(v.view().scale).toBeCloseTo(1, 12);
    expect(v.state()).toEqual(state);
  });

  test("nothing is kept: the fragment, the history and the storage stay as they were", () => {
    const storage = new Map<string, string>();
    const v = open(pageFile(PLAN), "", storage);
    v.press("+");
    press(v, "zoom-out");
    press(v, "fit");
    v.wheel({ ctrlKey: true, deltaY: -100 });
    v.pointer("pointerdown", { clientX: 100, clientY: 100 });
    v.pointer("pointermove", { clientX: 50, clientY: 50 });
    v.pointer("pointerup", {});
    expect([v.location.hash, v.history.length, [...storage]]).toEqual(["", 1, []]);
  });
});

describe("when the first state comes back", () => {
  // a stays in the frame at scale 1 with the scroll at (100, 100).
  const PLAN = { ...TALL, parts: [{ id: "a", x: 200, y: 200, w: 200, h: 100 }], steps: ["a"], task: "a" };

  test("on a change of picture, and not when the plane picture is asked for again", () => {
    const v = open(pageFile(PLAN));
    press(v, "zoom-in");
    const zoomed = v.view();
    v.choose(1);
    v.choose(0);
    v.doc.byId.get("tasks")!.all().find((e) => e.getAttribute("data-task") === "t")!.dispatch("click");
    v.navigate("#task=t");
    v.navigate("#scenario=nothing");
    expect(v.view().scale).toBe(zoomed.scale);
    expect(v.view().left).toBe(zoomed.left);
    press(v, "picture");
    expect(v.view()).toEqual({ scale: 800 / 600, left: 0, top: 0, height: 400 });
    press(v, "zoom-in");
    press(v, "picture");
    expect(v.view()).toEqual({ scale: 0.8, left: 0, top: 0, height: 800 });
  });

  test("on a change of the frame width, and not of the window height alone", () => {
    const v = open(pageFile(PLAN));
    press(v, "zoom-in");
    v.resize(800, 600);
    expect(v.view()).toEqual({ scale: 1, left: 100, top: 100, height: 480 });
    v.resize(500, 600);
    expect(v.view()).toEqual({ scale: 0.5, left: 0, top: 0, height: 480 });
  });

  test("the raised picture has its own view; the hidden plane picture keeps its size", () => {
    const v = open(pageFile({ ...TALL, RW: 2000, RH: 3000 }));
    const plane = [v.plane.getAttribute("width"), v.plane.getAttribute("height")];
    press(v, "picture");
    expect(v.view()).toEqual({ scale: 0.4, left: 0, top: 0, height: 800 });
    press(v, "zoom-in");
    v.press("+");
    v.wheel({ ctrlKey: true, deltaY: -100, clientX: 16, clientY: 40 });
    expect(v.view().scale).toBeCloseTo(0.4 * 1.25 ** 3, 12);
    const left = v.view().left;
    v.pointer("pointerdown", { clientX: 416, clientY: 440 });
    v.pointer("pointermove", { clientX: 316, clientY: 440 });
    expect(v.view().left).toBe(left + 100);
    press(v, "fit");
    expect(v.view().scale).toBeCloseTo(800 / 3000, 12);
    expect([v.plane.getAttribute("width"), v.plane.getAttribute("height")]).toEqual(plane);
  });
});

describe("the rectangle of a scenario step", () => {
  // At 0.8: a is in the frame, b is below it, c is higher than the frame.
  const PLAN = {
    ...TALL,
    parts: [
      { id: "a", x: 50, y: 100, w: 200, h: 100 },
      { id: "b", x: 700, y: 3000, w: 200, h: 100 },
      { id: "c", x: 0, y: 1000, w: 1000, h: 1500 },
    ],
    steps: ["a", "b", "c"],
    task: "b",
  };
  const at = (v: Viewer) => [v.view().left, v.view().top];

  test("a rectangle in the frame does not move it; one outside comes 16px in on its own axis", () => {
    const v = open(pageFile(PLAN));
    v.choose(1);
    expect(at(v)).toEqual([0, 0]);
    v.click("next");
    expect(at(v)).toEqual([0, 2400 - 704]);
    expect(v.view().scale).toBe(0.8);
  });

  test("a rectangle higher than the frame puts its top at the top of the frame; going back moves by the least", () => {
    const v = open(pageFile(PLAN));
    v.choose(1);
    v.press("ArrowRight");
    v.press("ArrowRight");
    expect(at(v)).toEqual([0, 800]);
    v.press("ArrowLeft");
    expect(at(v)).toEqual([0, 1696]);
  });

  test("zoomed in, only the axis that is out moves, and the scale stays", () => {
    const v = open(pageFile(PLAN));
    press(v, "zoom-in");
    v.choose(1);
    expect(at(v)).toEqual([34, 100]);
    expect(v.view().scale).toBeCloseTo(1, 12);
  });

  test("the fragment opens a step the same way; choosing a task does not move the view", () => {
    expect(at(open(pageFile(PLAN), "#scenario=s&step=2"))).toEqual([0, 1696]);
    const v = open(pageFile(PLAN));
    v.navigate("#task=t");
    expect(at(v)).toEqual([0, 0]);
  });

  test("from the raised picture the plane picture opens in its first state and then the step rule applies", () => {
    const v = open(pageFile({ ...PLAN, steps: ["b"] }));
    press(v, "picture");
    press(v, "zoom-in");
    v.choose(1);
    expect(v.picture().shown).toBe("plane");
    expect(v.view().scale).toBe(0.8);
    expect(at(v)).toEqual([0, 1696]);
  });

  test("a change of the frame width during a walk-through gives the first state and then the step rule", () => {
    const v = open(pageFile(PLAN));
    v.choose(1);
    v.click("next");
    press(v, "zoom-in");
    v.resize(500, 1000);
    expect(v.view().scale).toBe(0.5);
    // b at 0.5: from 1500 to 1550 in a frame 800 high.
    expect(at(v)).toEqual([0, 1500 - (800 - 16 - 50)]);
  });
});
