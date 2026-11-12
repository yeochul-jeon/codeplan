// The plane layout written into the page: a rectangle for each part, sized
// by its line count, and a frame for each zone around its parts. Blocks
// (zone frames, and parts without a zone) are packed in rows; parts inside a
// frame are packed in rows the same way.
import { byCodeUnit } from "./measure.js";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutZone extends Box {
  name: string;
  title: Box;
}

export interface LayoutPart extends Box {
  id: string;
  label: Box;
}

export interface Layout {
  width: number;
  height: number;
  zones: LayoutZone[];
  parts: LayoutPart[];
  externals: LayoutPart[];
  edges: { from: string; to: string; points: [number, number][] }[];
  connectors: { scenario: string; step: number; points: [number, number][] }[];
}

export interface PartInput {
  id: string;
  name: string;
  zone: string | undefined;
  lines: number;
  files: number;
  // A planned part: the third label line reads "planned".
  planned?: boolean;
}

export const GAP = 8;
export const LABEL_HEIGHT = 3 * 16 + 8;
export const TITLE_HEIGHT = 20;
const LABEL_CAP = 240;
const RATIO = 3;

// Width of a text: 7 for each code point below U+1100, 13 from U+1100 up.
export function textWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += ch.codePointAt(0)! < 0x1100 ? 7 : 13;
  return width;
}

export function labelLines(p: PartInput): string[] {
  return [p.name === "" ? p.id : p.name, `${p.lines} lines`, p.planned ? "planned" : `${p.files} files`];
}

export function labelWidth(p: PartInput): number {
  return Math.min(LABEL_CAP, Math.max(...labelLines(p).map(textWidth)) + 12);
}

export function titleWidth(zone: string): number {
  return Math.min(LABEL_CAP, textWidth(zone) + 12);
}

// The part's rectangle: the label box when the target area T = 400·√lines
// fits in it, otherwise a rectangle close to a square with area in
// [T, 1.25·T]. Area bounds are decided on squares, in integers:
// (w·h)² ≥ 160000·lines and (w·h)² ≤ 250000·lines.
export function partSize(a: number, lines: number): { w: number; h: number } {
  const b = LABEL_HEIGHT;
  const t2 = 160000 * lines;
  if ((a * b) ** 2 >= t2) return { w: a, h: b };
  const w = Math.max(a, Math.ceil(Math.sqrt(Math.sqrt(t2))));
  let h = Math.max(b, Math.floor(Math.sqrt(t2) / w));
  while ((w * h) ** 2 < t2) h++;
  if ((w * h) ** 2 > 250000 * lines) throw new Error(`no part size for ${a} and ${lines} lines`);
  return { w, h };
}

interface Block {
  w: number;
  h: number;
  // Places the block's contents with its top-left corner at (x, y).
  place(x: number, y: number): void;
}

// Packs blocks left to right in rows no wider than `width` (a block wider
// than that gets a row of its own), GAP apart in both directions.
function packRows(blocks: Block[], width: number): { w: number; h: number; place(x: number, y: number): void } {
  const rows: { blocks: Block[]; w: number; h: number }[] = [];
  for (const block of blocks) {
    const row = rows.at(-1);
    if (row && row.w + GAP + block.w <= width) {
      row.blocks.push(block);
      row.w += GAP + block.w;
      row.h = Math.max(row.h, block.h);
    } else {
      rows.push({ blocks: [block], w: block.w, h: block.h });
    }
  }
  const w = Math.max(0, ...rows.map((r) => r.w));
  const h = rows.reduce((sum, r, i) => sum + r.h + (i > 0 ? GAP : 0), 0);
  return {
    w,
    h,
    place(x: number, y: number) {
      let top = y;
      for (const row of rows) {
        let left = x;
        for (const block of row.blocks) {
          block.place(left, top);
          left += block.w + GAP;
        }
        top += row.h + GAP;
      }
    },
  };
}

// A row width that makes the packing close to square.
function rowWidth(blocks: Block[]): number {
  const area = blocks.reduce((sum, b) => sum + (b.w + GAP) * (b.h + GAP), 0);
  return Math.max(Math.ceil(Math.sqrt(area)), ...blocks.map((b) => b.w));
}

export interface ExternalInput {
  id: string;
  name: string;
}

export interface Relations {
  edges: { from: string; to: string }[];
  connectors: { scenario: string; step: number; from: string; to: string }[];
}

export const EXTERNAL_HEIGHT = 2 * 16 + 8;
const MARGIN = 8;

export function externalWidth(e: ExternalInput): number {
  return Math.min(LABEL_CAP, Math.max(textWidth(e.name === "" ? e.id : e.name), textWidth("external")) + 12);
}

// Parts and zone frames come from the parts alone; externals go in rows
// below them; then edges and connectors are routed around every part and
// external rectangle.
export function layOut(
  inputs: PartInput[],
  externalInputs: ExternalInput[] = [],
  relations: Relations = { edges: [], connectors: [] },
): Layout {
  if (inputs.length === 0 && externalInputs.length === 0) {
    return { width: 1, height: 1, zones: [], parts: [], externals: [], edges: [], connectors: [] };
  }

  const parts: LayoutPart[] = inputs.map((p) => {
    const a = labelWidth(p);
    const { w, h } = partSize(a, p.lines);
    return { id: p.id, x: 0, y: 0, w, h, label: { x: 0, y: 0, w: a, h: LABEL_HEIGHT } };
  });
  const partBlock = (part: LayoutPart): Block => ({
    w: part.w,
    h: part.h,
    place(x, y) {
      part.x = x;
      part.y = y;
      part.label.x = x;
      part.label.y = y;
    },
  });

  const zoneNames = [...new Set(inputs.map((p) => p.zone ?? "").filter((z) => z !== ""))].sort(byCodeUnit);
  const zones: LayoutZone[] = [];
  const blocks: Block[] = [];
  for (const name of zoneNames) {
    const members = parts.filter((_, i) => inputs[i]!.zone === name).map(partBlock);
    const inner = packRows(members, rowWidth(members));
    const tw = titleWidth(name);
    const zone: LayoutZone = {
      name,
      x: 0,
      y: 0,
      // Side margins GAP; parts start below the title box and a GAP.
      w: Math.max(inner.w, tw) + 2 * GAP,
      h: TITLE_HEIGHT + GAP + inner.h + GAP,
      title: { x: 0, y: 0, w: tw, h: TITLE_HEIGHT },
    };
    zones.push(zone);
    blocks.push({
      w: zone.w,
      h: zone.h,
      place(x, y) {
        zone.x = x;
        zone.y = y;
        zone.title.x = x + GAP;
        zone.title.y = y;
        inner.place(x + GAP, y + TITLE_HEIGHT + GAP);
      },
    });
  }
  parts.forEach((part, i) => {
    const zone = inputs[i]!.zone ?? "";
    if (zone === "") blocks.push(partBlock(part));
  });

  const all = packRows(blocks, blocks.length > 0 ? rowWidth(blocks) : 0);
  all.place(MARGIN, MARGIN);

  // Externals: in plan order, in rows starting a GAP below every part and
  // frame, no wider than the parts above (or than they need on their own).
  const externals: LayoutPart[] = externalInputs.map((e) => {
    const w = externalWidth(e);
    return { id: e.id, x: 0, y: 0, w, h: EXTERNAL_HEIGHT, label: { x: 0, y: 0, w, h: EXTERNAL_HEIGHT } };
  });
  let contentW = all.w;
  let contentH = all.h;
  if (externals.length > 0) {
    const extBlocks = externals.map(partBlock);
    const rows = packRows(extBlocks, Math.max(all.w, rowWidth(extBlocks)));
    const top = blocks.length > 0 ? all.h + GAP : 0;
    rows.place(MARGIN, MARGIN + top);
    contentW = Math.max(all.w, rows.w);
    contentH = top + rows.h;
  }

  let width = contentW + 2 * MARGIN;
  let height = contentH + 2 * MARGIN;
  if (width > RATIO * height) height = Math.ceil(width / RATIO);
  if (height > RATIO * width) width = Math.ceil(height / RATIO);

  // Routes are computed only when there are lines, once for each pair.
  const placeOf = new Map<string, Box>([...parts, ...externals].map((r) => [r.id, r]));
  let router: ((a: Box, b: Box) => Point[]) | null = null;
  const routes = new Map<string, Point[]>();
  const route = (from: string, to: string): Point[] => {
    const key = JSON.stringify([from, to]);
    let points = routes.get(key);
    if (!points) {
      router ??= makeRouter([...parts, ...externals]);
      points = router(placeOf.get(from)!, placeOf.get(to)!);
      routes.set(key, points);
    }
    return points.map((p) => [p[0], p[1]] as Point);
  };
  const edges = relations.edges.map((e) => ({ from: e.from, to: e.to, points: route(e.from, e.to) }));
  const connectors = relations.connectors.map((c) => ({
    scenario: c.scenario,
    step: c.step,
    points: route(c.from, c.to),
  }));
  return { width, height, zones, parts, externals, edges, connectors };
}

// ---- routing ----------------------------------------------------------

type Point = [number, number];
const PAD = 4;
const BEND = 24;

// Orthogonal routes that never enter a rectangle's inside. Each rectangle
// is padded by 4 (half the gap rectangles keep), so padded rectangles never
// overlap and the space outside them is connected (the outer margin of 8
// leaves a free ring). Routes run on the grid of padded edges: a line leaves
// the middle of a side, goes 4 out to the padded edge, slides along it to a
// corner, crosses the grid by A* (length plus a cost for each bend), and
// comes in the same way at the other rectangle.
function makeRouter(rects: Box[]): (a: Box, b: Box) => Point[] {
  const padded = rects.map((r) => ({ l: r.x - PAD, r: r.x + r.w + PAD, t: r.y - PAD, b: r.y + r.h + PAD }));
  const xs = [...new Set(padded.flatMap((p) => [p.l, p.r]))].sort((a, b) => a - b);
  const ys = [...new Set(padded.flatMap((p) => [p.t, p.b]))].sort((a, b) => a - b);
  const nx = xs.length;
  const ny = ys.length;
  const xi = new Map(xs.map((x, i) => [x, i]));
  const yi = new Map(ys.map((y, j) => [y, j]));
  // blockedH[j*nx+i]: (xs[i], ys[j]) to (xs[i+1], ys[j]); blockedV[j*nx+i]:
  // (xs[i], ys[j]) to (xs[i], ys[j+1]). A segment is blocked when it runs
  // through a padded rectangle's inside.
  const blockedH = new Uint8Array(nx * ny);
  const blockedV = new Uint8Array(nx * ny);
  for (const p of padded) {
    const [l, r, t, b] = [xi.get(p.l)!, xi.get(p.r)!, yi.get(p.t)!, yi.get(p.b)!];
    for (let j = t + 1; j < b; j++) for (let i = l; i < r; i++) blockedH[j * nx + i] = 1;
    for (let j = t; j < b; j++) for (let i = l + 1; i < r; i++) blockedV[j * nx + i] = 1;
  }

  const states = nx * ny * 4;
  const dist = new Float64Array(states);
  const prev = new Int32Array(states);
  const seen = new Int32Array(states);
  let search = 0;
  // A binary heap of (f, g, state), in parallel arrays.
  let heapF = new Float64Array(1024);
  let heapS = new Int32Array(1024);
  let size = 0;
  const push = (f: number, s: number) => {
    if (size === heapF.length) {
      const f2 = new Float64Array(size * 2);
      f2.set(heapF);
      heapF = f2;
      const s2 = new Int32Array(size * 2);
      s2.set(heapS);
      heapS = s2;
    }
    let i = size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heapF[parent]! < f || (heapF[parent]! === f && heapS[parent]! <= s)) break;
      heapF[i] = heapF[parent]!;
      heapS[i] = heapS[parent]!;
      i = parent;
    }
    heapF[i] = f;
    heapS[i] = s;
  };
  const pop = (): number => {
    const top = heapS[0]!;
    size--;
    if (size > 0) {
      const f = heapF[size]!;
      const s = heapS[size]!;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= size) break;
        const r = l + 1;
        const c = r < size && (heapF[r]! < heapF[l]! || (heapF[r]! === heapF[l]! && heapS[r]! < heapS[l]!)) ? r : l;
        if (heapF[c]! > f || (heapF[c]! === f && heapS[c]! >= s)) break;
        heapF[i] = heapF[c]!;
        heapS[i] = heapS[c]!;
        i = c;
      }
      heapF[i] = f;
      heapS[i] = s;
    }
    return top;
  };

  const step = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ] as const;
  // For each side: the middle of the side, the point 4 out, and the padded
  // corners at the two ends with the direction of sliding toward each.
  interface Port {
    side: Point;
    out: Point;
    corner: Point;
    dir: number;
  }
  const ports = (r: Box): Port[] => {
    const p = { l: r.x - PAD, r: r.x + r.w + PAD, t: r.y - PAD, b: r.y + r.h + PAD };
    const cx = r.x + Math.floor(r.w / 2);
    const cy = r.y + Math.floor(r.h / 2);
    return [
      { side: [r.x + r.w, cy], out: [p.r, cy], corner: [p.r, p.t], dir: 3 },
      { side: [r.x + r.w, cy], out: [p.r, cy], corner: [p.r, p.b], dir: 1 },
      { side: [cx, r.y + r.h], out: [cx, p.b], corner: [p.r, p.b], dir: 0 },
      { side: [cx, r.y + r.h], out: [cx, p.b], corner: [p.l, p.b], dir: 2 },
      { side: [r.x, cy], out: [p.l, cy], corner: [p.l, p.b], dir: 1 },
      { side: [r.x, cy], out: [p.l, cy], corner: [p.l, p.t], dir: 3 },
      { side: [cx, r.y], out: [cx, p.t], corner: [p.l, p.t], dir: 2 },
      { side: [cx, r.y], out: [cx, p.t], corner: [p.r, p.t], dir: 0 },
    ];
  };
  const along = (q: Port) => PAD + Math.abs(q.corner[0] - q.out[0]) + Math.abs(q.corner[1] - q.out[1]);
  const nodeOf = (p: Point) => yi.get(p[1])! * nx + xi.get(p[0])!;

  return (a: Box, b: Box): Point[] => {
    search++;
    size = 0;
    const goalBox = { l: b.x - PAD, r: b.x + b.w + PAD, t: b.y - PAD, b: b.y + b.h + PAD };
    const h = (n: number) => {
      const x = xs[n % nx]!;
      const y = ys[Math.floor(n / nx)]!;
      return Math.max(0, goalBox.l - x, x - goalBox.r) + Math.max(0, goalBox.t - y, y - goalBox.b);
    };
    const visit = (s: number, g: number, from: number) => {
      if (seen[s] === search && dist[s]! <= g) return;
      seen[s] = search;
      dist[s] = g;
      prev[s] = from;
      push(g + h(s >> 2), s);
    };
    const starts = ports(a);
    // A start state carries -2 - (port index) as its previous state.
    starts.forEach((q, k) => visit(nodeOf(q.corner) * 4 + q.dir, along(q), -2 - k));
    // Leaving the grid at a padded corner of b: the cheapest finish there.
    const finishes = new Map<number, { cost: number; port: Port }>();
    for (const q of ports(b)) {
      const n = nodeOf(q.corner);
      const cost = along(q) + BEND;
      if (!finishes.has(n) || finishes.get(n)!.cost > cost) finishes.set(n, { cost, port: q });
    }
    let best = Infinity;
    let bestState = -1;
    while (size > 0) {
      const top = heapF[0]!;
      if (top >= best) break;
      const s = pop();
      const g = dist[s]!;
      if (g + h(s >> 2) > top) continue;
      const n = s >> 2;
      const finish = finishes.get(n);
      if (finish && g + finish.cost < best) {
        best = g + finish.cost;
        bestState = s;
      }
      const dir = s & 3;
      const i = n % nx;
      const j = (n - i) / nx;
      for (let nd = 0; nd < 4; nd++) {
        if (nd === (dir + 2) % 4) continue;
        const [dx, dy] = step[nd]!;
        const ni = i + dx;
        const nj = j + dy;
        if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
        if (dx !== 0 ? blockedH[j * nx + Math.min(i, ni)] : blockedV[Math.min(j, nj) * nx + i]) continue;
        const len = Math.abs(xs[ni]! - xs[i]!) + Math.abs(ys[nj]! - ys[j]!);
        visit((nj * nx + ni) * 4 + nd, g + len + (nd === dir ? 0 : BEND), s);
      }
    }
    if (bestState < 0) throw new Error("no route between two rectangles");

    const finish = finishes.get(bestState >> 2)!.port;
    const path: Point[] = [finish.side, finish.out];
    let s = bestState;
    for (;;) {
      const n = s >> 2;
      const i = n % nx;
      path.push([xs[i]!, ys[(n - i) / nx]!]);
      const p = prev[s]!;
      if (p <= -2) {
        const q = starts[-2 - p]!;
        path.push(q.out, q.side);
        break;
      }
      s = p;
    }
    path.reverse();
    // Drop repeated points and middle points on a straight run.
    const out: Point[] = [];
    for (const p of path) {
      const last = out.at(-1);
      if (last && last[0] === p[0] && last[1] === p[1]) continue;
      if (out.length >= 2) {
        const q = out.at(-2)!;
        if ((q[0] === last![0] && last![0] === p[0]) || (q[1] === last![1] && last![1] === p[1])) out.pop();
      }
      out.push(p);
    }
    return out;
  };
}
