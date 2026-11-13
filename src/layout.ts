// The plane layout written into the page: a rectangle for each part, sized
// by its line count, and a frame for each zone around its parts. Blocks
// (zone frames, and parts without a zone) are packed in rows; parts inside a
// frame are packed in rows the same way. Lines get places of their own in
// the gaps below the rows, which open as far as the lines need.
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

// Where the lines of one kind leave a rectangle, or come into it: a point
// on its bottom side. Every line that starts at an out end (or finishes at
// an in end) goes the same way between the end and the right margin, so
// those lines run together there and nowhere else. The way is a drop to a
// level in the gap below the rectangle's row; for a part in a zone, along
// that level to a column in the zone's right margin and down it to a level
// in the gap below the zone's row; then along the level to the right margin.
// No two ends have the same level in one gap or the same column in one
// margin, so lines of different ends only cross or touch at one point.
// Two ends that come down into the same gap, or are in the same zone, are
// joined there and not by the right margin.
interface End {
  // Kind and direction in a fixed order: edges out, edges in, connectors
  // out, connectors in.
  order: number;
  x: number;
  bottom: number;
  // In a zone: the level below the part's row and the column in the frame.
  innerLevel: number | null;
  column: number | null;
  level: number;
  // The zone, and the rows whose gaps hold the two levels.
  zone: LayoutZone | null;
  innerRow: object | null;
  row: object | null;
  // The column in the right margin, for the ends that have one.
  marginColumn: number | null;
}

interface Block {
  w: number;
  h: number;
  // The ends that come down out of the block's bottom.
  ends: End[];
  // Places the block's contents with its top-left corner at (x, y).
  place(x: number, y: number): void;
  // After place: the x where each end comes down.
  downAt(end: End): number;
}

// Packs blocks left to right in rows no wider than `width` (a block wider
// than that gets a row of its own), GAP apart sideways. Below each row the
// gap holds one level for each end of the row, GAP apart, and `setLevel`
// gets each: the end that comes down furthest right has the level nearest
// the row, so a drop never crosses a level of its own row. The height
// counts the levels below the last row but no gap after them.
function packRows(
  blocks: Block[],
  width: number,
  setLevel: (end: End, y: number, row: object) => void,
): { w: number; h: number; place(x: number, y: number): void } {
  const rows: { blocks: Block[]; w: number; h: number; ends: number }[] = [];
  for (const block of blocks) {
    const row = rows.at(-1);
    if (row && row.w + GAP + block.w <= width) {
      row.blocks.push(block);
      row.w += GAP + block.w;
      row.h = Math.max(row.h, block.h);
      row.ends += block.ends.length;
    } else {
      rows.push({ blocks: [block], w: block.w, h: block.h, ends: block.ends.length });
    }
  }
  const w = Math.max(0, ...rows.map((r) => r.w));
  const h = rows.reduce((sum, r, i) => sum + r.h + GAP * r.ends + (i > 0 ? GAP : 0), 0);
  return {
    w,
    h,
    place(x: number, y: number) {
      let top = y;
      for (const row of rows) {
        let left = x;
        const down: { end: End; x: number }[] = [];
        for (const block of row.blocks) {
          block.place(left, top);
          for (const end of block.ends) down.push({ end, x: block.downAt(end) });
          left += block.w + GAP;
        }
        down.sort((a, b) => b.x - a.x);
        down.forEach((d, k) => setLevel(d.end, top + row.h + GAP * (k + 1), row));
        top += row.h + GAP * (row.ends + 1);
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

// Part sizes come from the parts alone. Zone frames and the places of all
// rectangles also make room for the lines: externals go in rows below the
// parts, and every gap is as wide as the lines in it need. Without lines
// the gaps are GAP wide everywhere.
export function layOut(
  inputs: PartInput[],
  externalInputs: ExternalInput[] = [],
  relations: Relations = { edges: [], connectors: [] },
): Layout {
  if (inputs.length === 0 && externalInputs.length === 0) {
    return { width: 1, height: 1, zones: [], parts: [], externals: [], edges: [], connectors: [] };
  }

  // The ends the lines need, in the order the lines first name them.
  const lines = [
    ...relations.edges.map((e) => ({ from: e.from, to: e.to, kind: 0 })),
    ...relations.connectors.map((c) => ({ from: c.from, to: c.to, kind: 1 })),
  ];
  const ends: End[] = [];
  const endsOf = new Map<string, End[]>();
  const endOf = (id: string, kind: number, out: boolean): End => {
    const order = 2 * kind + (out ? 0 : 1);
    const list = endsOf.get(id) ?? [];
    endsOf.set(id, list);
    let end = list.find((e) => e.order === order);
    if (!end) {
      end = {
        order, x: 0, bottom: 0, innerLevel: null, column: null, level: 0,
        zone: null, innerRow: null, row: null, marginColumn: null,
      };
      list.push(end);
      list.sort((a, b) => a.order - b.order);
      ends.push(end);
    }
    return end;
  };
  const drawn = lines.map((l) => ({ out: endOf(l.from, l.kind, true), in: endOf(l.to, l.kind, false) }));

  const parts: LayoutPart[] = inputs.map((p) => {
    const a = labelWidth(p);
    const { w, h } = partSize(a, p.lines);
    return { id: p.id, x: 0, y: 0, w, h, label: { x: 0, y: 0, w: a, h: LABEL_HEIGHT } };
  });
  // A rectangle's ends sit on its bottom side, evenly apart.
  const rectBlock = (rect: LayoutPart): Block => {
    const own = endsOf.get(rect.id) ?? [];
    return {
      w: rect.w,
      h: rect.h,
      ends: own,
      place(x, y) {
        rect.x = x;
        rect.y = y;
        rect.label.x = x;
        rect.label.y = y;
        own.forEach((end, i) => {
          end.x = x + Math.floor(((i + 1) * rect.w) / (own.length + 1));
          end.bottom = y + rect.h;
        });
      },
      downAt: (end) => end.x,
    };
  };
  const setLevel = (end: End, y: number, row: object) => {
    end.level = y;
    end.row = row;
  };

  const zoneNames = [...new Set(inputs.map((p) => p.zone ?? "").filter((z) => z !== ""))].sort(byCodeUnit);
  const zones: LayoutZone[] = [];
  const blocks: Block[] = [];
  for (const name of zoneNames) {
    const members = parts.filter((_, i) => inputs[i]!.zone === name).map(rectBlock);
    const own = members.flatMap((m) => m.ends);
    const inner = packRows(members, rowWidth(members), (end, y, row) => {
      end.innerLevel = y;
      end.innerRow = row;
    });
    const tw = titleWidth(name);
    const zone: LayoutZone = {
      name,
      x: 0,
      y: 0,
      // Side margins GAP, and on the right a column for each end; parts
      // start below the title box and a GAP.
      w: Math.max(inner.w + GAP * own.length, tw) + 2 * GAP,
      h: TITLE_HEIGHT + GAP + inner.h + GAP,
      title: { x: 0, y: 0, w: tw, h: TITLE_HEIGHT },
    };
    zones.push(zone);
    for (const end of own) end.zone = zone;
    blocks.push({
      w: zone.w,
      h: zone.h,
      ends: own,
      place(x, y) {
        zone.x = x;
        zone.y = y;
        zone.title.x = x + GAP;
        zone.title.y = y;
        inner.place(x + GAP, y + TITLE_HEIGHT + GAP);
        // The end with the highest level has the column furthest right, so
        // a level never crosses a column of its own zone.
        [...own]
          .sort((a, b) => a.innerLevel! - b.innerLevel!)
          .forEach((end, k) => {
            end.column = x + GAP + inner.w + GAP * (own.length - k);
          });
      },
      downAt: (end) => end.column!,
    });
  }
  parts.forEach((part, i) => {
    const zone = inputs[i]!.zone ?? "";
    if (zone === "") blocks.push(rectBlock(part));
  });

  const all = packRows(blocks, blocks.length > 0 ? rowWidth(blocks) : 0, setLevel);
  all.place(MARGIN, MARGIN);

  // Externals: in plan order, in rows starting a GAP below every part and
  // frame and the levels below them, no wider than the parts above (or than
  // they need on their own).
  const externals: LayoutPart[] = externalInputs.map((e) => {
    const w = externalWidth(e);
    return { id: e.id, x: 0, y: 0, w, h: EXTERNAL_HEIGHT, label: { x: 0, y: 0, w, h: EXTERNAL_HEIGHT } };
  });
  let contentW = all.w;
  let contentH = all.h;
  if (externals.length > 0) {
    const extBlocks = externals.map(rectBlock);
    const rows = packRows(extBlocks, Math.max(all.w, rowWidth(extBlocks)), setLevel);
    const top = blocks.length > 0 ? all.h + GAP : 0;
    rows.place(MARGIN, MARGIN + top);
    contentW = Math.max(all.w, rows.w);
    contentH = top + rows.h;
  }

  // The way from an end as far as the gap below its row; for a part in a
  // zone that is down to its level in the zone and along it to its column.
  const downTo = (end: End): Point[] =>
    end.column === null
      ? [[end.x, end.bottom]]
      : [[end.x, end.bottom], [end.x, end.innerLevel!], [end.column, end.innerLevel!]];
  // Two ends that can be joined without the right margin, as the points
  // from `a` to `b`. In one gap the end further left has the lower level:
  // the line goes along that level to under the other end and straight up
  // into it. In one zone with levels in two gaps, the lower end's level
  // goes on to the column of the upper end. Only lines of the one end go
  // along its level and only lines of the other end go up, so the rules
  // hold as they do in the margin.
  const near = (a: End, b: End): Point[] | null => {
    if (a.zone !== null && a.zone === b.zone) {
      if (a.innerRow === b.innerRow) {
        const [left, right] = a.x < b.x ? [a, b] : [b, a];
        const way: Point[] = [[left.x, left.bottom], [left.x, left.innerLevel!], [right.x, left.innerLevel!], [right.x, right.bottom]];
        return left === a ? way : way.reverse();
      }
      const [upper, lower] = a.innerLevel! < b.innerLevel! ? [a, b] : [b, a];
      const way: Point[] = [
        [lower.x, lower.bottom], [lower.x, lower.innerLevel!], [upper.column!, lower.innerLevel!],
        [upper.column!, upper.innerLevel!], [upper.x, upper.innerLevel!], [upper.x, upper.bottom],
      ];
      return lower === a ? way : way.reverse();
    }
    if (a.row !== b.row) return null;
    const at = (end: End) => end.column ?? end.x;
    const [left, right] = at(a) < at(b) ? [a, b] : [b, a];
    const way: Point[] = [...downTo(left), [at(left), left.level], [at(right), left.level], ...downTo(right).reverse()];
    return left === a ? way : way.reverse();
  };

  // Any other line goes from its out end to the right margin, up or down a
  // column there, and back to its in end. The column belongs to one of the
  // two ends, and each such line of that end takes it. The ends that get a
  // column are picked one at a time: the end with the most lines still
  // without one, the first such end when several have as many.
  const nearWay = new Map(drawn.map((line) => [line, near(line.out, line.in)]));
  const columnOf = new Map<(typeof drawn)[number], End>();
  for (;;) {
    const count = new Map<End, number>();
    for (const line of drawn) {
      if (columnOf.has(line) || nearWay.get(line) !== null) continue;
      count.set(line.out, (count.get(line.out) ?? 0) + 1);
      count.set(line.in, (count.get(line.in) ?? 0) + 1);
    }
    let pick: End | null = null;
    for (const end of ends) {
      if ((count.get(end) ?? 0) > (pick === null ? 0 : count.get(pick)!)) pick = end;
    }
    if (pick === null) break;
    for (const line of drawn) {
      if (!columnOf.has(line) && nearWay.get(line) === null && (line.out === pick || line.in === pick)) columnOf.set(line, pick);
    }
  }
  const withColumn = ends.filter((end) => [...columnOf.values()].includes(end));
  withColumn.forEach((end, k) => {
    end.marginColumn = MARGIN + contentW + GAP * (k + 1);
  });

  let width = contentW + GAP * withColumn.length + 2 * MARGIN;
  let height = contentH + 2 * MARGIN;
  if (width > RATIO * height) height = Math.ceil(width / RATIO);
  if (height > RATIO * width) width = Math.ceil(height / RATIO);

  const wayOf = (end: End): Point[] => [...downTo(end), [end.column ?? end.x, end.level]];
  const points = drawn.map((line): Point[] => {
    const joined = nearWay.get(line);
    if (joined) return straightened(joined);
    const x = columnOf.get(line)!.marginColumn!;
    return [...wayOf(line.out), [x, line.out.level], [x, line.in.level], ...wayOf(line.in).reverse()];
  });
  const edges = relations.edges.map((e, i) => ({ from: e.from, to: e.to, points: points[i]! }));
  const connectors = relations.connectors.map((c, i) => ({
    scenario: c.scenario,
    step: c.step,
    points: points[relations.edges.length + i]!,
  }));
  return { width, height, zones, parts, externals, edges, connectors };
}

type Point = [number, number];

// The points without the middle one of three on a straight run.
function straightened(points: Point[]): Point[] {
  return points
    .filter((p, i) => {
      const [before, after] = [points[i - 1], points[i + 1]];
      if (!before || !after) return true;
      return !((before[0] === p[0] && p[0] === after[0]) || (before[1] === p[1] && p[1] === after[1]));
    })
    .map((p): Point => [p[0], p[1]]);
}
