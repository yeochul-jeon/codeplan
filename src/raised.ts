// The raised picture written into the page: each part is a raised rectangle
// that stands on a rectangle of its plane size, and its height comes from
// its line count. Places come from the parts and externals alone, never from
// uses, scenarios or tasks.
//
// A shape's cell is the smallest upright rectangle on the screen that holds
// it. Cells never overlap, so no shape covers another and every label lies
// on the top of its own shape. Cells are not put in rows: a list is cut in
// two and the two halves are joined side by side or one above the other.
import {
  EXTERNAL_HEIGHT,
  GAP,
  LABEL_HEIGHT,
  TITLE_HEIGHT,
  externalWidth,
  labelWidth,
  partSize,
  titleWidth,
  type ExternalInput,
  type LayoutPart,
  type LayoutZone,
  type PartInput,
} from "./layout.js";
import { byCodeUnit } from "./measure.js";

export interface RaisedPart extends LayoutPart {
  z: number;
}

export interface Raised {
  width: number;
  height: number;
  projection: { x: number[]; y: number[] };
  zones: LayoutZone[];
  parts: RaisedPart[];
  externals: LayoutPart[];
  order: string[];
}

// Height: max(H0, round(K·√lines)); a planned part is H0 high.
const K = 1;
const H0 = 8;
// The same for every plan: X = x + z + 8, Y = y − z + 8. The top of a shape
// is the rectangle it stands on moved right and up by its height, and the
// sides seen are the left one and the front one.
const PROJECTION = { x: [1, 0, 1, 8], y: [0, 1, -1, 8] };
const MARGIN = 8;
const RATIO = 3;

// A cell or a block of cells: its size, and how to put it at a place.
interface Block {
  w: number;
  h: number;
  area: number;
  place(x: number, y: number): void;
}

// Cuts the list where the areas before the cut are nearest to half of all,
// makes a block of each half the same way, and joins the two with a gap:
// side by side or one above the other, whichever has the shorter long side.
function joined(list: Block[]): Block {
  if (list.length === 1) return list[0]!;
  const total = list.reduce((sum, g) => sum + g.area, 0);
  let cut = 1;
  let before = 0;
  let nearest = Infinity;
  for (let i = 1; i < list.length; i++) {
    before += list[i - 1]!.area;
    const off = Math.abs(2 * before - total);
    if (off < nearest) {
      nearest = off;
      cut = i;
    }
  }
  const a = joined(list.slice(0, cut));
  const b = joined(list.slice(cut));
  const beside = { w: a.w + GAP + b.w, h: Math.max(a.h, b.h) };
  const below = { w: Math.max(a.w, b.w), h: a.h + GAP + b.h };
  const area = a.area + b.area;
  if (Math.max(beside.w, beside.h) <= Math.max(below.w, below.h)) {
    return { ...beside, area, place: (x, y) => (a.place(x, y), b.place(x + a.w + GAP, y)) };
  }
  return { ...below, area, place: (x, y) => (a.place(x, y), b.place(x, y + a.h + GAP)) };
}

export function raisedPicture(inputs: PartInput[], externalInputs: ExternalInput[]): Raised {
  if (inputs.length === 0 && externalInputs.length === 0) {
    return { width: 1, height: 1, projection: PROJECTION, zones: [], parts: [], externals: [], order: [] };
  }
  const [ax, , az, ox] = PROJECTION.x as [number, number, number, number];
  const [, by, bz, oy] = PROJECTION.y as [number, number, number, number];

  const parts: RaisedPart[] = inputs.map((p) => {
    const a = labelWidth(p);
    const { w, h } = partSize(a, p.lines);
    const z = p.planned ? H0 : Math.max(H0, Math.round(K * Math.sqrt(p.lines)));
    return { id: p.id, x: 0, y: 0, w, h, z, label: { x: 0, y: 0, w: a, h: LABEL_HEIGHT } };
  });
  // The cell of a part is its top and its two sides: w + z by h + z. The
  // rectangle it stands on is at the cell's left and z below the cell's
  // top; the label box is at the left and the top of the shape's top.
  const partCell = (part: RaisedPart): Block => ({
    w: part.w + part.z,
    h: part.h + part.z,
    area: (part.w + part.z) * (part.h + part.z),
    place(x, y) {
      part.x = x;
      part.y = y + part.z;
      part.label.x = ax * part.x + az * part.z + ox;
      part.label.y = by * part.y + bz * part.z + oy;
    },
  });

  // A zone's rectangle holds the cells of its parts, with the title in a
  // strip above them.
  const zones: LayoutZone[] = [];
  const zoneBlocks = new Map<string, Block>();
  const zoneNames = [...new Set(inputs.map((p) => p.zone ?? "").filter((name) => name !== ""))].sort(byCodeUnit);
  for (const name of zoneNames) {
    const inner = joined(parts.filter((_, i) => inputs[i]!.zone === name).map(partCell));
    const tw = titleWidth(name);
    const zone: LayoutZone = {
      name,
      x: 0,
      y: 0,
      w: Math.max(inner.w, tw) + 2 * GAP,
      h: TITLE_HEIGHT + GAP + inner.h + GAP,
      title: { x: 0, y: 0, w: tw, h: TITLE_HEIGHT },
    };
    zones.push(zone);
    zoneBlocks.set(name, {
      w: zone.w,
      h: zone.h,
      area: zone.w * zone.h,
      place(x, y) {
        zone.x = x;
        zone.y = y;
        zone.title.x = ax * (x + GAP) + ox;
        zone.title.y = by * y + oy;
        inner.place(x + GAP, y + TITLE_HEIGHT + GAP);
      },
    });
  }

  const externals: LayoutPart[] = externalInputs.map((e) => {
    const w = externalWidth(e);
    return { id: e.id, x: 0, y: 0, w, h: EXTERNAL_HEIGHT, label: { x: 0, y: 0, w, h: EXTERNAL_HEIGHT } };
  });

  // Parts in plan order, a zone where its first part is, then the externals.
  const top: Block[] = [];
  inputs.forEach((p, i) => {
    const zone = zoneBlocks.get(p.zone ?? "");
    if (!zone) top.push(partCell(parts[i]!));
    else if (!top.includes(zone)) top.push(zone);
  });
  for (const external of externals) {
    top.push({
      w: external.w,
      h: external.h,
      area: external.w * external.h,
      place(x, y) {
        external.x = x;
        external.y = y;
        external.label.x = ax * x + ox;
        external.label.y = by * y + oy;
      },
    });
  }
  const all = joined(top);
  all.place(0, 0);

  let width = all.w + 2 * MARGIN;
  let height = all.h + 2 * MARGIN;
  if (width > RATIO * height) height = Math.ceil(width / RATIO);
  if (height > RATIO * width) width = Math.ceil(height / RATIO);
  // No shape covers another, so any order draws the same picture.
  const order = [...parts.map((p) => p.id), ...externals.map((e) => e.id)];
  return { width, height, projection: PROJECTION, zones, parts, externals, order };
}
