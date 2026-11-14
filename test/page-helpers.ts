import {
  cpSync,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  utimesSync,
  lutimesSync,
} from "node:fs";
import { hostname } from "node:os";
import { basename, join } from "node:path";
import { expect } from "vitest";
import { check, run } from "../src/cli.js";
import { tempDir } from "./helpers.js";
import { expectRaised, expectRaisedPage } from "./raised-helpers.js";
import { openViewer } from "./viewer-dom.js";

export const MARK = "<!doctype html><!-- codeplan page -->";
const OPEN = '<script type="application/json" id="codeplan-data">';

// Widths counted again here, apart from the code under test.
export const width = (text: string) => [...text].reduce((s, c) => s + (c.codePointAt(0)! < 0x1100 ? 7 : 13), 0);
export const labelA = (name: string, id: string, lines: number, files: number, planned = false) =>
  Math.min(
    240,
    Math.max(width(name === "" ? id : name), width(`${lines} lines`), width(planned ? "planned" : `${files} files`)) + 12,
  );
export const titleW = (zone: string) => Math.min(240, width(zone) + 12);

export interface Block {
  format: number;
  plan: {
    name?: unknown;
    parts: { id: string; name: string; zone?: string; planned?: unknown; uses?: { to: string }[] }[];
    externals?: { id: string; name: string }[];
    scenarios?: { id: string; steps: { at: string }[] }[];
  } & Record<string, unknown>;
  measure: { parts: { id: string; files: number; lines: number }[]; files: number; lines: number };
  orphans: string[];
  unwatched: number;
  tasks: { id: string; marks: string[]; missing: string[] }[];
  layout: {
    width: number;
    height: number;
    zones: { name: string; x: number; y: number; w: number; h: number; title: Box }[];
    parts: { id: string; x: number; y: number; w: number; h: number; label: Box }[];
    externals: { id: string; x: number; y: number; w: number; h: number; label: Box }[];
    edges: { from: string; to: string; points: [number, number][] }[];
    connectors: { scenario: string; step: number; points: [number, number][] }[];
  };
  raised: {
    width: number;
    height: number;
    projection: { x: number[]; y: number[] };
    zones: { name: string; x: number; y: number; w: number; h: number; title: Box }[];
    parts: { id: string; x: number; y: number; w: number; h: number; z: number; label: Box }[];
    externals: { id: string; x: number; y: number; w: number; h: number; label: Box }[];
    order: string[];
  };
}
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function readBlock(page: string): { block: Block; raw: string } {
  const at = page.indexOf(OPEN);
  const start = at + OPEN.length;
  const raw = page.slice(start, page.indexOf("</script>", start));
  return { block: JSON.parse(raw) as Block, raw };
}

const keysOf = (o: object) => Object.keys(o);
const overlap = (a: Box, b: Box) =>
  Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y);
const apart = (a: Box, b: Box) =>
  a.x + a.w + 8 <= b.x || b.x + b.w + 8 <= a.x || a.y + a.h + 8 <= b.y || b.y + b.h + 8 <= a.y;
// Inside the canvas with the outer margin of 8.
const inside = (box: Box, w: number, h: number) =>
  box.x >= 8 && box.y >= 8 && box.x + box.w <= w - 8 && box.y + box.h <= h - 8;
export const extA = (name: string, id: string) => Math.min(240, Math.max(width(name === "" ? id : name), 56) + 12);

// Edges and connectors as the plan defines them.
export function expectedLines(plan: Block["plan"]): { edges: [string, string][]; connectors: [string, number][] } {
  const edges: [string, string][] = [];
  for (const part of plan.parts) {
    for (const use of part.uses ?? []) {
      if (use.to === part.id || edges.some(([f, t]) => f === part.id && t === use.to)) continue;
      edges.push([part.id, use.to]);
    }
  }
  const linked = (a: string, b: string) => edges.some(([f, t]) => (f === a && t === b) || (f === b && t === a));
  const connectors: [string, number][] = [];
  for (const scenario of plan.scenarios ?? []) {
    scenario.steps.forEach((step, k) => {
      const before = scenario.steps[k - 1]?.at;
      if (k > 0 && before !== step.at && !linked(before!, step.at)) connectors.push([scenario.id, k]);
    });
  }
  return { edges, connectors };
}

const onSide = ([x, y]: [number, number], r: Box) =>
  ((x === r.x || x === r.x + r.w) && y >= r.y && y <= r.y + r.h) ||
  ((y === r.y || y === r.y + r.h) && x >= r.x && x <= r.x + r.w);
const crossesInside = (a: [number, number], b: [number, number], r: Box) => {
  if (a[1] === b[1]) {
    const y = a[1];
    return y > r.y && y < r.y + r.h && Math.max(Math.min(a[0], b[0]), r.x) < Math.min(Math.max(a[0], b[0]), r.x + r.w);
  }
  const x = a[0];
  return x > r.x && x < r.x + r.w && Math.max(Math.min(a[1], b[1]), r.y) < Math.min(Math.max(a[1], b[1]), r.y + r.h);
};

// The rules every edge and connector line keeps.
export function expectLine(points: [number, number][], from: Box, to: Box, rects: Box[], W: number, H: number, what: string): void {
  expect(points.length >= 2, what).toBe(true);
  for (const [x, y] of points) {
    expect(Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x <= W && y <= H, what).toBe(true);
  }
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1]!, points[i]!];
    expect((a[0] === b[0]) !== (a[1] === b[1]), `${what} segment ${i}`).toBe(true);
    for (const r of rects) expect(crossesInside(a, b, r), `${what} segment ${i}`).toBe(false);
  }
  expect(onSide(points[0]!, from), `${what} start`).toBe(true);
  expect(onSide(points.at(-1)!, to), `${what} end`).toBe(true);
}

// The rules lines keep among themselves. `g` is the least distance between
// two lines that go the same way side by side.
interface DrawnLine {
  what: string;
  kind: "edge" | "connector";
  from: string;
  to: string;
  points: [number, number][];
}
const g = 8;

export function drawnLines(layout: Block["layout"], plan: Block["plan"]): DrawnLine[] {
  const lines: DrawnLine[] = layout.edges.map((e) => ({
    what: `${e.from}->${e.to}`, kind: "edge", from: e.from, to: e.to, points: e.points,
  }));
  for (const c of layout.connectors) {
    const steps = (plan.scenarios ?? []).find((s) => s.id === c.scenario)!.steps;
    lines.push({
      what: `${c.scenario}#${c.step}`, kind: "connector",
      from: steps[c.step - 1]!.at, to: steps[c.step]!.at, points: c.points,
    });
  }
  return lines;
}

// The stretches of `a` (as distances along it) where `b` runs together with
// it, joined where they touch; and the first place two same-way pieces of
// the two lines are closer than g without being at distance 0.
export function together(a: [number, number][], b: [number, number][]): { runs: [number, number][]; near: string | null } {
  const pieces: [number, number][] = [];
  let near: string | null = null;
  let along = 0;
  for (let i = 1; i < a.length; i++) {
    const [p, q] = [a[i - 1]!, a[i]!];
    const axis = p[1] === q[1] ? 0 : 1;
    const [lo, hi] = [Math.min(p[axis]!, q[axis]!), Math.max(p[axis]!, q[axis]!)];
    for (let j = 1; j < b.length; j++) {
      const [r, s] = [b[j - 1]!, b[j]!];
      if ((r[1] === s[1] ? 0 : 1) !== axis) continue;
      const from = Math.max(lo, Math.min(r[axis]!, s[axis]!));
      const to = Math.min(hi, Math.max(r[axis]!, s[axis]!));
      if (to - from < 1) continue;
      const distance = Math.abs(p[1 - axis]! - r[1 - axis]!);
      if (distance === 0) {
        const [d1, d2] = [Math.abs(from - p[axis]!), Math.abs(to - p[axis]!)];
        pieces.push([along + Math.min(d1, d2), along + Math.max(d1, d2)]);
      } else if (distance < g) {
        near ??= `pieces ${i} and ${j} are ${distance} apart`;
      }
    }
    along += hi - lo;
  }
  pieces.sort((x, y) => x[0] - y[0]);
  const runs: [number, number][] = [];
  for (const piece of pieces) {
    const last = runs.at(-1);
    if (last && piece[0] <= last[1]) last[1] = Math.max(last[1], piece[1]);
    else runs.push([piece[0], piece[1]]);
  }
  return { runs, near };
}

const lengthOf = (points: [number, number][]) =>
  points.reduce((sum, p, i) => (i === 0 ? 0 : sum + Math.abs(p[0] - points[i - 1]![0]) + Math.abs(p[1] - points[i - 1]![1])), 0);

// Every way the lines break the rules, as text; empty when they keep them.
export function lineFaults(lines: DrawnLine[], rects: (Box & { id: string })[]): string[] {
  const faults: string[] = [];
  const lengths = lines.map((l) => lengthOf(l.points));
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const [a, b] = [lines[i]!, lines[j]!];
      const pair = `${a.what} / ${b.what}`;
      const seenFromA = together(a.points, b.points);
      if (seenFromA.near !== null) faults.push(`N ${pair}: ${seenFromA.near}`);
      if (seenFromA.runs.length === 0) continue;
      const seenFromB = together(b.points, a.points);
      if (a.kind !== b.kind) {
        faults.push(`T ${pair}: lines of two kinds run together`);
        continue;
      }
      if (a.from === b.from && a.to === b.to) {
        if (JSON.stringify(a.points) !== JSON.stringify(b.points)) faults.push(`T ${pair}: same ends, other points`);
        continue;
      }
      const one = seenFromA.runs.length === 1 && seenFromB.runs.length === 1;
      const [ra, rb] = [seenFromA.runs[0]!, seenFromB.runs[0]!];
      const atEnd = a.to === b.to && one && ra[1] === lengths[i] && rb[1] === lengths[j];
      const atStart = a.from === b.from && one && ra[0] === 0 && rb[0] === 0;
      if (!atEnd && !atStart) faults.push(`T ${pair}: run together at ${JSON.stringify(seenFromA.runs)}`);
    }
  }

  // Ends on one side of a rectangle.
  const ends = lines.flatMap((l, i) => [
    { line: i, rect: l.from, first: true, at: l.points[0]! },
    { line: i, rect: l.to, first: false, at: l.points.at(-1)! },
  ]);
  const byId = new Map(rects.map((r) => [r.id, r]));
  const sidesOf = ([x, y]: [number, number], r: Box) =>
    [x === r.x && "left", x === r.x + r.w && "right", y === r.y && "top", y === r.y + r.h && "bottom"].filter(Boolean);
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      const [a, b] = [ends[i]!, ends[j]!];
      if (a.rect !== b.rect || a.line === b.line) continue;
      const r = byId.get(a.rect)!;
      if (!sidesOf(a.at, r).some((side) => sidesOf(b.at, r).includes(side))) continue;
      const distance = Math.abs(a.at[0] - b.at[0]) + Math.abs(a.at[1] - b.at[1]);
      const same = lines[a.line]!.kind === lines[b.line]!.kind && a.first === b.first;
      if (distance === 0 ? !same : distance < g) {
        faults.push(`E ${lines[a.line]!.what} / ${lines[b.line]!.what} on ${a.rect}: ends ${distance} apart`);
      }
    }
  }

  // No piece of a line goes along a side of a rectangle.
  for (const l of lines) {
    for (let i = 1; i < l.points.length; i++) {
      const [p, q] = [l.points[i - 1]!, l.points[i]!];
      for (const r of rects) {
        const onSideLine =
          p[1] === q[1]
            ? (p[1] === r.y || p[1] === r.y + r.h) &&
              Math.min(Math.max(p[0], q[0]), r.x + r.w) - Math.max(Math.min(p[0], q[0]), r.x) >= 1
            : (p[0] === r.x || p[0] === r.x + r.w) &&
              Math.min(Math.max(p[1], q[1]), r.y + r.h) - Math.max(Math.min(p[1], q[1]), r.y) >= 1;
        if (onSideLine) faults.push(`S ${l.what}: piece ${i} goes along a side of ${r.id}`);
      }
    }
  }
  return faults;
}

// Every rule the layout must keep, for a block whose plan has no errors.
export function expectLayout(block: Block): void {
  const { layout, plan, measure } = block;
  expect(keysOf(layout)).toEqual(["width", "height", "zones", "parts", "externals", "edges", "connectors"]);
  const numbers: number[] = [layout.width, layout.height];
  for (const z of layout.zones) {
    expect(keysOf(z)).toEqual(["name", "x", "y", "w", "h", "title"]);
    expect(keysOf(z.title)).toEqual(["x", "y", "w", "h"]);
    numbers.push(z.x, z.y, z.w, z.h, z.title.x, z.title.y, z.title.w, z.title.h);
  }
  for (const p of layout.parts) {
    expect(keysOf(p)).toEqual(["id", "x", "y", "w", "h", "label"]);
    expect(keysOf(p.label)).toEqual(["x", "y", "w", "h"]);
    numbers.push(p.x, p.y, p.w, p.h, p.label.x, p.label.y, p.label.w, p.label.h);
  }
  for (const n of numbers) expect(Number.isInteger(n) && n >= 0, String(n)).toBe(true);

  expect(layout.parts.map((p) => p.id)).toEqual(plan.parts.map((p) => p.id));
  const zoneOf = (i: number) => plan.parts[i]!.zone ?? "";
  const names = [...new Set(plan.parts.map((_, i) => zoneOf(i)).filter((z) => z !== ""))].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  expect(layout.zones.map((z) => z.name)).toEqual(names);

  const W = layout.width;
  const H = layout.height;
  expect(W >= 1 && H >= 1 && W <= 3 * H && H <= 3 * W, `${W}x${H}`).toBe(true);
  const planExternals = plan.externals ?? [];
  if (plan.parts.length === 0 && planExternals.length === 0) expect([W, H, layout.zones.length]).toEqual([1, 1, 0]);
  else expect(W >= 17 && H >= 17).toBe(true);

  // Externals: a by 40, below every part and frame, rows in plan order.
  expect(layout.externals.map((x) => x.id)).toEqual(planExternals.map((x) => x.id));
  const lowest = Math.max(0, ...layout.parts.map((p) => p.y + p.h), ...layout.zones.map((z) => z.y + z.h));
  layout.externals.forEach((x, i) => {
    expect(keysOf(x)).toEqual(["id", "x", "y", "w", "h", "label"]);
    expect(keysOf(x.label)).toEqual(["x", "y", "w", "h"]);
    for (const n of [x.x, x.y, x.w, x.h]) expect(Number.isInteger(n) && n >= 0).toBe(true);
    const a = extA(planExternals[i]!.name, x.id);
    expect([x.w, x.h], x.id).toEqual([a, 40]);
    expect(x.label).toEqual({ x: x.x, y: x.y, w: a, h: 40 });
    expect(inside(x, W, H), x.id).toBe(true);
    if (layout.parts.length > 0) expect(x.y >= lowest + 8, x.id).toBe(true);
    const before = layout.externals[i - 1];
    if (before) expect(before.y < x.y || (before.y === x.y && before.x < x.x), x.id).toBe(true);
  });
  const boxes = [...layout.parts, ...layout.externals];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      expect(apart(boxes[i]!, boxes[j]!), `${boxes[i]!.id} / ${boxes[j]!.id}`).toBe(true);
    }
  }
  for (const z of layout.zones) for (const x of layout.externals) expect(apart(z, x), `${z.name} / ${x.id}`).toBe(true);

  // Edges and connectors: the plan's list, and lines that keep the rules.
  const want = expectedLines(plan);
  expect(layout.edges.map((e) => [e.from, e.to])).toEqual(want.edges);
  expect(layout.connectors.map((c) => [c.scenario, c.step])).toEqual(want.connectors);
  const place = new Map(boxes.map((b) => [b.id, b]));
  for (const e of layout.edges) {
    expect(keysOf(e)).toEqual(["from", "to", "points"]);
    expectLine(e.points, place.get(e.from)!, place.get(e.to)!, boxes, W, H, `${e.from}->${e.to}`);
  }
  const seenPair = new Map<string, string>();
  for (const c of layout.connectors) {
    expect(keysOf(c)).toEqual(["scenario", "step", "points"]);
    const steps = (plan.scenarios ?? []).find((s) => s.id === c.scenario)!.steps;
    const [a, b] = [steps[c.step - 1]!.at, steps[c.step]!.at];
    expectLine(c.points, place.get(a)!, place.get(b)!, boxes, W, H, `${c.scenario}#${c.step}`);
    const key = JSON.stringify([a, b]);
    if (seenPair.has(key)) expect(JSON.stringify(c.points)).toBe(seenPair.get(key));
    seenPair.set(key, JSON.stringify(c.points));
  }

  expect(lineFaults(drawnLines(layout, plan), boxes).slice(0, 5)).toEqual([]);

  layout.parts.forEach((p, i) => {
    const m = measure.parts[i]!;
    const a = labelA(plan.parts[i]!.name, p.id, m.lines, m.files, plan.parts[i]!.planned === true);
    expect(p.label, p.id).toEqual({ x: p.x, y: p.y, w: a, h: 56 });
    const area = p.w * p.h;
    expect(p.w >= a && p.h >= 56, p.id).toBe(true);
    expect(area ** 2 >= 160000 * m.lines, p.id).toBe(true);
    expect(area ** 2 <= 250000 * m.lines || area <= a * 56, p.id).toBe(true);
    const ratio = Math.max(p.w, p.h) / Math.min(p.w, p.h);
    expect(ratio <= Math.max(3, a / 56, 56 / a) + 1e-9, p.id).toBe(true);
    expect(inside(p, W, H) && inside(p.label, W, H), p.id).toBe(true);
  });

  for (const z of layout.zones) {
    expect(z.title).toEqual({ x: z.x + 8, y: z.y, w: titleW(z.name), h: 20 });
    expect(z.w >= z.title.w + 16).toBe(true);
    expect(inside(z, W, H) && inside(z.title, W, H), z.name).toBe(true);
    layout.parts.forEach((p, i) => {
      expect(overlap(z.title, p), `${z.name} title / ${p.id}`).toBe(false);
      if (zoneOf(i) === z.name) {
        const margins = p.x - z.x >= 8 && p.y - z.y >= 8 && z.x + z.w - (p.x + p.w) >= 8 && z.y + z.h - (p.y + p.h) >= 8;
        expect(margins, `${p.id} in ${z.name}`).toBe(true);
      } else {
        expect(apart(z, p), `${z.name} / ${p.id}`).toBe(true);
      }
    });
  }
  for (let i = 0; i < layout.parts.length; i++) {
    for (let j = i + 1; j < layout.parts.length; j++) {
      expect(apart(layout.parts[i]!, layout.parts[j]!), `${layout.parts[i]!.id} / ${layout.parts[j]!.id}`).toBe(true);
    }
  }
  for (let i = 0; i < layout.zones.length; i++) {
    for (let j = i + 1; j < layout.zones.length; j++) {
      expect(apart(layout.zones[i]!, layout.zones[j]!)).toBe(true);
    }
  }
}

// What every written page must be.
export function expectPage(repo: string, pagePath: string): Block {
  const page = readFileSync(join(repo, pagePath), "utf8");
  expect(page.startsWith(MARK)).toBe(true);
  expect(page.includes("\r")).toBe(false);
  expect(page.split(OPEN).length - 1).toBe(1);
  const { block, raw } = readBlock(page);
  expect(raw).not.toMatch(/[<>&\u2028\u2029]/);
  for (const m of raw.matchAll(/\\u([0-9a-fA-F]{4})/g)) {
    if (["003c", "003e", "0026", "2028", "2029"].includes(m[1]!.toLowerCase())) expect(m[1]).toBe(m[1]!.toLowerCase());
  }
  expect(keysOf(block)).toEqual(["format", "plan", "measure", "orphans", "unwatched", "tasks", "layout", "raised"]);
  expect(block.format).toBe(2);
  expect(keysOf(block.measure)).toEqual(["parts", "files", "lines"]);
  for (const p of block.measure.parts) expect(keysOf(p)).toEqual(["id", "files", "lines"]);

  const result = check(repo);
  if (result.kind !== "measured") throw new Error(result.message);
  const planText = readFileSync(join(repo, result.config.home, "plan.json"), "utf8");
  expect(JSON.stringify(block.plan)).toBe(JSON.stringify(JSON.parse(planText)));
  expect(block.measure.parts.map((p) => p.id)).toEqual(block.plan.parts.map((p) => p.id));
  expect(block.measure.parts).toEqual(result.measurement.parts);
  expect(block.measure.files).toBe(block.measure.parts.reduce((s, p) => s + p.files, 0));
  expect(block.measure.lines).toBe(block.measure.parts.reduce((s, p) => s + p.lines, 0));
  expect(block.orphans).toEqual(result.measurement.orphans);
  expect(block.unwatched).toBe(result.measurement.unwatched.length);
  expectLayout(block);
  expectRaised(block);
  expectRaisedPage(page, openViewer(join(repo, pagePath)));

  const outside = page.replace(raw, "");
  for (const net of [/(?:src|href)\s*=\s*["']?\s*\/\//i, /url\(\s*["']?\/\//i, /@import/i, /<link[^>]*stylesheet/i, /fetch\(/, /XMLHttpRequest/]) {
    expect(outside).not.toMatch(net);
  }
  expect(page).not.toContain(repo);
  expect(page).not.toContain(basename(repo));
  if (hostname().length >= 4) expect(page).not.toContain(hostname());
  return block;
}

export interface PlaceState {
  kind: "absent" | "file" | "dir" | "link";
  bytes?: string;
  list?: string[];
  target?: string;
  mtime?: number;
  ino?: number;
}

export function placeState(path: string): PlaceState {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return { kind: "absent" };
  if (stat.isSymbolicLink()) return { kind: "link", target: readlinkSync(path), mtime: stat.mtimeMs, ino: stat.ino };
  if (stat.isDirectory()) return { kind: "dir", list: readdirSync(path).sort(), mtime: stat.mtimeMs, ino: stat.ino };
  return { kind: "file", bytes: readFileSync(path, "latin1"), mtime: stat.mtimeMs, ino: stat.ino };
}

// Sets the place's modification time into the past, so a write shows.
export function agePlace(path: string): void {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return;
  const past = new Date("2001-02-03T04:05:06Z");
  if (stat.isSymbolicLink()) lutimesSync(path, past, past);
  else utimesSync(path, past, past);
}

// The whole repository tree with bytes and modification times.
export function treeState(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const stat = lstatSync(full);
      const key = `${prefix}${name}`;
      if (stat.isSymbolicLink()) out[key] = `link ${readlinkSync(full)} ${stat.mtimeMs}`;
      else if (stat.isDirectory()) {
        out[key] = `dir ${stat.mtimeMs}`;
        walk(full, `${key}/`);
      } else out[key] = `file ${stat.mtimeMs} ${readFileSync(full, "latin1")}`;
    }
  };
  walk(root, "");
  return out;
}

// The page made from a copy of the tree, without the page, in a directory
// with another name and depth.
export function pageFromCopy(repo: string, pagePath: string): string {
  const copy = join(tempDir(), "deeper", "another-name");
  cpSync(repo, copy, { recursive: true, verbatimSymlinks: true });
  rmSync(join(copy, pagePath), { force: true, recursive: true });
  const out = run(["update"], copy);
  expect(out.code, out.stderr).toBe(0);
  expect(existsSync(join(copy, pagePath))).toBe(true);
  return readFileSync(join(copy, pagePath), "latin1");
}
