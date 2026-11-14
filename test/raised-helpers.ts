// The rules of the raised picture, counted again here apart from the code
// under test: expectRaised for the data, expectRaisedPage for what the
// viewer draws from it.
import { expect } from "vitest";
import { raisedPicture } from "../src/raised.js";
import { extA, labelA, titleW, type Block } from "./page-helpers.js";
import type { El, Viewer } from "./viewer-dom.js";

type Point = [number, number];
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// The same in every plan.
export const K = 1;
export const H0 = 8;
export const PROJECTION = { x: [1, 0, 1, 8], y: [0, 1, -1, 8] };

const keysOf = (o: object) => Object.keys(o);
const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

// The convex hull, counter-clockwise, without points on a side.
export function hull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (list: Point[]) => {
    const out: Point[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half(sorted.reverse())];
}

// Two convex shapes overlap with an area unless a side of one of them has
// the other shape wholly on its outer side or on it.
export function overlap(a: Point[], b: Point[]): boolean {
  for (const [one, other] of [[a, b], [b, a]] as const) {
    for (let i = 0; i < one.length; i++) {
      const p = one[i]!;
      const q = one[(i + 1) % one.length]!;
      if (other.every((r) => cross(p, q, r) <= 0)) return false;
    }
  }
  return true;
}

// A point in a convex shape or on its side.
const holds = (shape: Point[], p: Point) => shape.every((q, i) => cross(q, shape[(i + 1) % shape.length]!, p) >= 0);
const corners = (b: Box): Point[] => hull([[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]]);
const apart = (a: Box, b: Box) =>
  a.x + a.w + 8 <= b.x || b.x + b.w + 8 <= a.x || a.y + a.h + 8 <= b.y || b.y + b.h + 8 <= a.y;

// The places on the screen of a rectangle on the ground lifted to height z.
export function lifted(raised: Block["raised"], b: Box, z: number): Point[] {
  const [ax, ay, az, ox] = raised.projection.x as [number, number, number, number];
  const [bx, by, bz, oy] = raised.projection.y as [number, number, number, number];
  const at = (x: number, y: number): Point => [ax * x + ay * y + az * z + ox, bx * x + by * y + bz * z + oy];
  return [at(b.x, b.y), at(b.x + b.w, b.y), at(b.x + b.w, b.y + b.h), at(b.x, b.y + b.h)];
}

export function expectRaised(block: Pick<Block, "plan" | "measure" | "layout" | "raised">): void {
  const { raised, layout, plan, measure } = block;
  const planExternals = plan.externals ?? [];
  expect(keysOf(raised)).toEqual(["width", "height", "projection", "zones", "parts", "externals", "order"]);
  expect(keysOf(raised.projection)).toEqual(["x", "y"]);
  const numbers: number[] = [raised.width, raised.height, ...raised.projection.x, ...raised.projection.y];
  for (const z of raised.zones) {
    expect(keysOf(z)).toEqual(["name", "x", "y", "w", "h", "title"]);
    expect(keysOf(z.title)).toEqual(["x", "y", "w", "h"]);
    numbers.push(z.x, z.y, z.w, z.h, z.title.x, z.title.y, z.title.w, z.title.h);
  }
  for (const p of raised.parts) {
    expect(keysOf(p)).toEqual(["id", "x", "y", "w", "h", "z", "label"]);
    expect(keysOf(p.label)).toEqual(["x", "y", "w", "h"]);
    numbers.push(p.x, p.y, p.w, p.h, p.z, p.label.x, p.label.y, p.label.w, p.label.h);
  }
  for (const x of raised.externals) {
    expect(keysOf(x)).toEqual(["id", "x", "y", "w", "h", "label"]);
    expect(keysOf(x.label)).toEqual(["x", "y", "w", "h"]);
    numbers.push(x.x, x.y, x.w, x.h, x.label.x, x.label.y, x.label.w, x.label.h);
  }
  for (const n of numbers) expect(Number.isInteger(n), String(n)).toBe(true);
  expect(raised.parts.map((p) => p.id)).toEqual(plan.parts.map((p) => p.id));
  expect(raised.externals.map((x) => x.id)).toEqual(planExternals.map((x) => x.id));
  expect(raised.zones.map((z) => z.name)).toEqual(layout.zones.map((z) => z.name));

  // P: the projection, the same in every plan.
  const [ax, ay, az] = raised.projection.x as [number, number, number];
  const [bx, by, bz] = raised.projection.y as [number, number, number];
  for (const c of [ax, ay, az, bx, by, bz]) expect(c >= -16 && c <= 16, String(c)).toBe(true);
  expect(ax * by - ay * bx).not.toBe(0);
  expect(bz).toBeLessThan(0);
  expect(raised.projection).toEqual(PROJECTION);

  // B: the plane sizes. Z: the heights.
  raised.parts.forEach((p, i) => {
    expect([p.w, p.h], p.id).toEqual([layout.parts[i]!.w, layout.parts[i]!.h]);
    const lines = measure.parts[i]!.lines;
    const z = plan.parts[i]!.planned === true || lines === 0 ? H0 : Math.max(H0, Math.round(K * Math.sqrt(lines)));
    expect(p.z, p.id).toBe(z);
  });
  raised.externals.forEach((x, i) => {
    expect([x.w, x.h], x.id).toEqual([layout.externals[i]!.w, layout.externals[i]!.h]);
    expect("z" in x).toBe(false);
  });

  // G: places on the ground.
  const grounds = [...raised.parts, ...raised.externals];
  for (const g of grounds) expect(g.x >= 0 && g.y >= 0, g.id).toBe(true);
  for (let i = 0; i < grounds.length; i++) {
    for (let j = i + 1; j < grounds.length; j++) {
      expect(apart(grounds[i]!, grounds[j]!), `${grounds[i]!.id} / ${grounds[j]!.id}`).toBe(true);
    }
  }
  raised.zones.forEach((zone, i) => {
    expect(zone.x >= 0 && zone.y >= 0, zone.name).toBe(true);
    for (const other of raised.zones.slice(i + 1)) expect(apart(zone, other), `${zone.name} / ${other.name}`).toBe(true);
    for (const x of raised.externals) expect(apart(zone, x), `${zone.name} / ${x.id}`).toBe(true);
    raised.parts.forEach((p, k) => {
      if ((plan.parts[k]!.zone ?? "") === zone.name) {
        const margins = p.x - zone.x >= 8 && p.y - zone.y >= 8 && zone.x + zone.w - (p.x + p.w) >= 8 && zone.y + zone.h - (p.y + p.h) >= 8;
        expect(margins, `${p.id} in ${zone.name}`).toBe(true);
      } else expect(apart(zone, p), `${zone.name} / ${p.id}`).toBe(true);
    });
  });

  // W: the picture's size, and everything inside it.
  const W = raised.width;
  const H = raised.height;
  expect(W >= 1 && H >= 1 && W <= 3 * H && H <= 3 * W, `${W}x${H}`).toBe(true);
  if (grounds.length === 0) {
    expect([W, H, raised.zones.length, raised.order.length]).toEqual([1, 1, 0, 0]);
  }
  const shapes = new Map<string, Point[]>();
  const tops = new Map<string, Point[]>();
  for (const p of raised.parts) {
    shapes.set(p.id, hull([...lifted(raised, p, 0), ...lifted(raised, p, p.z)]));
    tops.set(p.id, hull(lifted(raised, p, p.z)));
  }
  for (const x of raised.externals) {
    shapes.set(x.id, hull(lifted(raised, x, 0)));
    tops.set(x.id, shapes.get(x.id)!);
  }
  const within = (points: Point[]) => points.every(([x, y]) => x >= 8 && x <= W - 8 && y >= 8 && y <= H - 8);
  for (const [id, shape] of shapes) expect(within(shape), id).toBe(true);
  for (const g of grounds) expect(within(corners(g.label)), `${g.id} label`).toBe(true);
  for (const z of raised.zones) expect(within(corners(z.title)), `${z.name} title`).toBe(true);

  // L: labels.
  raised.parts.forEach((p, i) => {
    const m = measure.parts[i]!;
    const a = labelA(plan.parts[i]!.name, p.id, m.lines, m.files, plan.parts[i]!.planned === true);
    expect([p.label.w, p.label.h], p.id).toEqual([a, 56]);
  });
  raised.externals.forEach((x, i) => {
    expect([x.label.w, x.label.h], x.id).toEqual([extA(planExternals[i]!.name, x.id), 40]);
  });
  // The middle of a box, counted in halves so it stays whole.
  const doubled = (points: Point[]): Point[] => points.map(([x, y]) => [2 * x, 2 * y]);
  const middle = (b: Box): Point => [2 * b.x + b.w, 2 * b.y + b.h];
  grounds.forEach((g, i) => {
    expect(holds(doubled(shapes.get(g.id)!), middle(g.label)), `${g.id} label middle`).toBe(true);
    for (const other of grounds.slice(i + 1)) {
      expect(overlap(corners(g.label), corners(other.label)), `labels ${g.id} / ${other.id}`).toBe(false);
    }
    for (const [id, shape] of shapes) {
      if (id !== g.id) expect(overlap(corners(g.label), shape), `${g.id} label / ${id}`).toBe(false);
    }
  });

  // T: zone titles.
  raised.zones.forEach((z, i) => {
    expect([z.title.w, z.title.h], z.name).toEqual([titleW(z.name), 20]);
    expect(holds(doubled(hull(lifted(raised, z, 0))), middle(z.title)), `${z.name} title middle`).toBe(true);
    for (const [id, shape] of shapes) expect(overlap(corners(z.title), shape), `${z.name} title / ${id}`).toBe(false);
    for (const g of grounds) expect(overlap(corners(z.title), corners(g.label)), `${z.name} title / ${g.id} label`).toBe(false);
    for (const other of raised.zones.slice(i + 1)) {
      expect(overlap(corners(z.title), corners(other.title)), `titles ${z.name} / ${other.name}`).toBe(false);
    }
  });

  // O: the order, and tops that nothing drawn later covers.
  expect([...raised.order].sort()).toEqual(grounds.map((g) => g.id).sort());
  expect(new Set(raised.order).size).toBe(raised.order.length);
  raised.order.forEach((id, i) => {
    for (const later of raised.order.slice(i + 1)) {
      expect(overlap(tops.get(id)!, shapes.get(later)!), `top of ${id} / ${later}`).toBe(false);
    }
  });

  // D: nothing but the parts, their measures and the externals.
  const again = raisedPicture(
    plan.parts.map((p, i) => ({
      id: p.id,
      name: p.name,
      zone: p.zone,
      lines: measure.parts[i]!.lines,
      files: measure.parts[i]!.files,
      planned: p.planned === true,
    })),
    planExternals.map((x) => ({ id: x.id, name: x.name })),
  );
  expect(JSON.stringify(raised)).toBe(JSON.stringify(again));
}

const text = (points: Point[]) => points.map((p) => p.join(",")).join(" ");
const pointsOf = (el: El): Point[] =>
  el.getAttribute("points")!.split(" ").map((p) => p.split(",").map(Number) as Point);

// S: what the page draws for the raised picture.
export function expectRaisedPage(page: string, v: Viewer): void {
  const { raised, plan, measure } = v.block;
  expect(page.split("data-picture=").length - 1).toBe(2);
  expect(page).toMatch(/<svg id="plane" data-picture="plane"[^>]*>/);
  expect(page).toMatch(/<svg id="raised" data-picture="raised"[^>]*>/);
  expect(v.raised.getAttribute("viewBox")).toBe(`0 0 ${raised.width} ${raised.height}`);

  const inside = v.raised.all().slice(1);
  expect([...new Set(inside.map((e) => e.name))].sort().filter((n) => !["g", "polygon", "svg", "text"].includes(n))).toEqual([]);
  expect(inside.filter((e) => e.hasAttribute("data-active"))).toEqual([]);
  // Nothing in it reacts to a pointer or a key.
  expect(inside.filter((e) => e.listeners.size > 0 || e.hasAttribute("tabindex"))).toEqual([]);
  expect(v.raised.listeners.size).toBe(0);

  const drawn = v.raised.children.filter((e) => e.name === "g");
  expect(inside.filter((e) => e.hasAttribute("data-id"))).toEqual(drawn);
  expect(drawn.map((g) => g.getAttribute("data-id"))).toEqual(raised.order);
  const partOf = new Map(raised.parts.map((p, i) => [p.id, { p, planned: plan.parts[i]!.planned === true }]));
  const externalOf = new Map(raised.externals.map((x) => [x.id, x]));
  for (const g of drawn) {
    const id = g.getAttribute("data-id")!;
    const part = partOf.get(id);
    expect(g.children.every((c) => c.name === "polygon"), id).toBe(true);
    if (!part) {
      expect(g.hasAttribute("data-planned"), id).toBe(false);
      expect(g.children.map((c) => [c.getAttribute("class"), c.getAttribute("points")])).toEqual([
        ["external", text(lifted(raised, externalOf.get(id)!, 0))],
      ]);
      continue;
    }
    expect(g.getAttribute("data-planned"), id).toBe(part.planned ? "true" : null);
    expect(g.children.map((c) => c.getAttribute("class")), id).toEqual(["side", "side", "top"]);
    expect(g.children[2]!.getAttribute("points"), id).toBe(text(lifted(raised, part.p, part.p.z)));
    const outline = hull(g.children.flatMap(pointsOf));
    expect(outline, id).toEqual(hull([...lifted(raised, part.p, 0), ...lifted(raised, part.p, part.p.z)]));
  }
  // Zone lines come first, then the shapes, then the text.
  const kinds = v.raised.children.map((e) => (e.name === "polygon" ? "zone" : e.name === "g" ? "shape" : e.name));
  expect(kinds).toEqual([
    ...raised.zones.map(() => "zone"),
    ...raised.order.map(() => "shape"),
    ...[...raised.parts, ...raised.externals, ...raised.zones].map(() => "svg"),
  ]);
  const zoneLines = v.raised.children.filter((e) => e.name === "polygon");
  expect(zoneLines.map((e) => [e.getAttribute("class"), e.getAttribute("points")])).toEqual(
    raised.zones.map((z) => ["zone", text(lifted(raised, z, 0))]),
  );
  // Text only, in the boxes of the data: no box is drawn.
  const boxes = v.raised.children.filter((e) => e.name === "svg");
  const names = new Map([...plan.parts, ...(plan.externals ?? [])].map((p) => [p.id, p.name === "" ? p.id : p.name]));
  const wanted = [
    ...raised.parts.map((p, i) => ({
      box: p.label,
      lines: [names.get(p.id), `${measure.parts[i]!.lines} lines`, plan.parts[i]!.planned === true ? "planned" : `${measure.parts[i]!.files} files`],
    })),
    ...raised.externals.map((x) => ({ box: x.label, lines: [names.get(x.id), "external"] })),
    ...raised.zones.map((z) => ({ box: z.title, lines: [z.name] })),
  ];
  expect(
    boxes.map((b) => ({
      box: { x: Number(b.getAttribute("x")), y: Number(b.getAttribute("y")), w: Number(b.getAttribute("width")), h: Number(b.getAttribute("height")) },
      lines: b.children.map((t) => (t.name === "text" ? t.textContent : `<${t.name}>`)),
    })),
  ).toEqual(wanted);
  for (const b of boxes) expect(b.getAttribute("overflow")).toBe("hidden");
  expect(v.plane.all().filter((e) => e.name === "g" || e.name === "polygon")).toEqual([]);
}
