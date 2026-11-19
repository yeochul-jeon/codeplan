// A small stand-in for the browser, enough to run the page's viewer code in
// node:vm: elements with attributes, children, text, events and focus, a
// location hash and a history that replaceState does not grow. The picture
// frame has a size, a place on the screen and scroll positions; it does not
// scroll on its own (no wheel scrolling, no scroll bars, no layout).
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { readBlock, type Block } from "./page-helpers.js";

export class El {
  attrs = new Map<string, string>();
  children: El[] = [];
  textContent = "";
  disabled = false;
  value = "";
  type = "";
  title = "";
  style: Record<string, string> = {};
  listeners = new Map<string, ((event: unknown) => void)[]>();
  // The third argument of addEventListener, for each type.
  listenerOptions = new Map<string, unknown>();
  captured: number | null = null;
  constructor(
    readonly name: string,
    readonly doc: FakeDocument,
  ) {}
  setAttribute(k: string, v: string) {
    this.attrs.set(k, String(v));
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  removeAttribute(k: string) {
    this.attrs.delete(k);
  }
  hasAttribute(k: string) {
    return this.attrs.has(k);
  }
  appendChild(c: El) {
    this.children.push(c);
    return c;
  }
  addEventListener(type: string, fn: (event: unknown) => void, options?: unknown) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
    if (options !== undefined) this.listenerOptions.set(type, options);
  }
  setPointerCapture(id: number) {
    this.captured = id;
  }
  releasePointerCapture() {
    this.captured = null;
  }
  dispatch(type: string, event: unknown = {}) {
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }
  focus() {
    this.doc.activeElement = this;
  }
  // Plan text must never be parsed as HTML.
  set innerHTML(_html: string) {
    throw new Error("innerHTML was set");
  }
  set outerHTML(_html: string) {
    throw new Error("outerHTML was set");
  }
  insertAdjacentHTML(): void {
    throw new Error("insertAdjacentHTML was called");
  }
  all(): El[] {
    return [this, ...this.children.flatMap((c) => c.all())];
  }
}

// The picture frame: its inner width is what the test gives, and its inner
// height is the height the viewer sets, at most 80% of the window height
// (max-height: 80vh). Its content is the picture that shows; a scroll
// position is cut to [0, content - inner size] when it is set.
export class Frame extends El {
  width = 800;
  windowHeight = 1000;
  box = { left: 0, top: 0 };
  private left = 0;
  private top = 0;
  get clientWidth() {
    return this.width;
  }
  get clientHeight() {
    return Math.min(parseFloat(this.style.height ?? "0"), this.windowHeight * 0.8);
  }
  private shown(attr: "width" | "height") {
    const svg = this.children.find((c) => !c.hasAttribute("hidden"));
    return Number(svg?.getAttribute(attr) ?? 0);
  }
  get scrollLeft() {
    return this.left;
  }
  set scrollLeft(v: number) {
    this.left = Math.min(Math.max(v, 0), Math.max(0, this.shown("width") - this.clientWidth));
  }
  get scrollTop() {
    return this.top;
  }
  set scrollTop(v: number) {
    this.top = Math.min(Math.max(v, 0), Math.max(0, this.shown("height") - this.clientHeight));
  }
  getBoundingClientRect() {
    return { left: this.box.left, top: this.box.top, right: this.box.left + this.width, bottom: this.box.top + this.clientHeight };
  }
}

export interface Wheel {
  deltaX?: number;
  deltaY?: number;
  deltaMode?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  clientX?: number;
  clientY?: number;
}

export interface Pointer {
  button?: number;
  pointerType?: string;
  pointerId?: number;
  clientX?: number;
  clientY?: number;
}

export class FakeDocument {
  title = "codeplan";
  activeElement: El | null = null;
  body: El;
  documentElement: El;
  byId = new Map<string, El>();
  listeners = new Map<string, ((event: unknown) => void)[]>();
  constructor() {
    this.body = new El("body", this);
    this.documentElement = new El("html", this);
    this.activeElement = this.body;
  }
  getElementById(id: string) {
    return this.byId.get(id) ?? null;
  }
  createElementNS(_ns: string, name: string) {
    return new El(name, this);
  }
  createElement(name: string) {
    return new El(name, this);
  }
  addEventListener(type: string, fn: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
}

export interface Viewer {
  doc: FakeDocument;
  location: { hash: string; pathname: string; search: string };
  history: { length: number; replaceState(state: unknown, title: string, url: string): void };
  plane: El;
  raised: El;
  walk: El;
  legend: El;
  frame: Frame;
  zones: El;
  // Ctrl or Cmd with the wheel, or the plain wheel, on the frame.
  wheel(event: Wheel): { prevented: boolean };
  pointer(type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel", event: Pointer): void;
  // The window changes size: the frame width and the window height.
  resize(width: number, height: number): void;
  // The scale, scroll and height of the picture that shows, read from its
  // width attribute and the frame.
  view(): { scale: number; left: number; top: number; height: number };
  block: Block;
  press(key: string, modifiers?: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }): void;
  // The fragment changes from outside (address bar, a link): hashchange.
  navigate(hash: string): void;
  theme(): { attr: string | null; text: string; button: El };
  // The picture that shows (the SVG without the hidden attribute) and the
  // picture button.
  picture(): { shown: string; text: string; button: El };
  // data-theme on <html> after the first script alone, before the viewer ran.
  themeBeforeViewer: string | null;
  // The first script sits before <body>.
  headScriptBeforeBody: boolean;
  click(which: "prev" | "next"): void;
  choose(index: number): void;
  state(): {
    step: string;
    rects: string[];
    lines: string[];
    hash: string;
    selected: number;
    focusOnNext: boolean;
    disabled: [boolean, boolean];
    history: number;
  };
}

// A localStorage stand-in: a map, or one that throws on every use.
export type Storage = Map<string, string> | "throws";

export function openViewer(
  pageFile: string,
  hash = "",
  storage: Storage = new Map(),
  size: { width: number; height: number } = { width: 800, height: 1000 },
): Viewer {
  const page = readFileSync(pageFile, "utf8");
  const { block, raw } = readBlock(page);
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
  // The early theme script in the head, then the viewer at the end.
  if (scripts.length !== 2) throw new Error(`expected two scripts, found ${scripts.length}`);
  const doc = new FakeDocument();
  const frame = new Frame("div", doc);
  frame.width = size.width;
  frame.windowHeight = size.height;
  doc.byId.set("view", frame);
  for (const id of ["tools", "zones", "plane", "raised", "tasks", "walk", "legend", "codeplan-data"]) {
    const el = new El(id === "plane" || id === "raised" ? "svg" : id === "codeplan-data" ? "script" : "div", doc);
    doc.byId.set(id, el);
  }
  frame.appendChild(doc.byId.get("plane")!);
  frame.appendChild(doc.byId.get("raised")!);
  doc.byId.get("codeplan-data")!.textContent = raw;
  const location = { hash, pathname: "/repo/docs/codeplan/codeplan.html", search: "" };
  const history = {
    length: 1,
    replaceState(_state: unknown, _title: string, url: string) {
      location.hash = url.startsWith("#") ? url : "";
    },
  };
  const windowListeners = new Map<string, (() => void)[]>();
  const window = {
    addEventListener(type: string, fn: () => void) {
      windowListeners.set(type, [...(windowListeners.get(type) ?? []), fn]);
    },
  };
  const fail = () => {
    throw new Error("SecurityError");
  };
  const localStorage =
    storage === "throws"
      ? { getItem: fail, setItem: fail, removeItem: fail }
      : {
          getItem: (k: string) => storage.get(k) ?? null,
          setItem: (k: string, v: string) => void storage.set(k, String(v)),
          removeItem: (k: string) => void storage.delete(k),
        };
  const context = { document: doc, window, location, history, localStorage, JSON, String, Number, Object, parseInt };
  // The head script runs alone first; what it leaves is kept for tests.
  runInNewContext(scripts[0]!, context);
  const themeBeforeViewer = doc.documentElement.getAttribute("data-theme");
  const headScriptBeforeBody = page.indexOf(`<script>${scripts[0]}</script>`) < page.indexOf("<body>");
  runInNewContext(scripts[1]!, context);
  const plane = doc.byId.get("plane")!;
  const walk = doc.byId.get("walk")!;
  const find = (name: string) => walk.children.filter((c) => c.name === name);
  return {
    doc,
    location,
    history,
    plane,
    raised: doc.byId.get("raised")!,
    walk,
    legend: doc.byId.get("legend")!,
    frame,
    zones: doc.byId.get("zones")!,
    block,
    themeBeforeViewer,
    headScriptBeforeBody,
    wheel(event) {
      let prevented = false;
      const full = { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, clientX: 0, clientY: 0, ...event };
      frame.dispatch("wheel", { ...full, preventDefault: () => void (prevented = true) });
      return { prevented };
    },
    pointer(type, event) {
      frame.dispatch(type, { button: 0, pointerType: "mouse", pointerId: 1, clientX: 0, clientY: 0, ...event });
    },
    resize(width, height) {
      frame.width = width;
      frame.windowHeight = height;
      for (const fn of windowListeners.get("resize") ?? []) fn();
    },
    view() {
      const shown = (["plane", "raised"] as const).find((id) => !doc.byId.get(id)!.hasAttribute("hidden"))!;
      const width = shown === "plane" ? block.layout.width : block.raised.width;
      const svg = doc.byId.get(shown)!;
      return { scale: Number(svg.getAttribute("width")) / width, left: frame.scrollLeft, top: frame.scrollTop, height: frame.clientHeight };
    },
    press(key, modifiers = {}) {
      for (const fn of doc.listeners.get("keydown") ?? []) fn({ key, ...modifiers, preventDefault() {} });
    },
    theme() {
      const button = doc.byId.get("tools")!.children.find((c) => c.getAttribute("data-role") === "theme")!;
      return { attr: doc.documentElement.getAttribute("data-theme"), text: button.textContent, button };
    },
    picture() {
      const button = doc.byId.get("tools")!.children.find((c) => c.getAttribute("data-role") === "picture")!;
      const shown = (["plane", "raised"] as const).filter((id) => !doc.byId.get(id)!.hasAttribute("hidden"));
      return { shown: shown.join("+"), text: button.textContent, button };
    },
    navigate(hash) {
      location.hash = hash;
      for (const fn of windowListeners.get("hashchange") ?? []) fn();
    },
    click(which) {
      const [prev, next] = find("button");
      const button = which === "prev" ? prev! : next!;
      if (!button.disabled) button.dispatch("click");
    },
    choose(index) {
      const select = find("select")[0]!;
      select.value = select.children[index]!.value;
      select.dispatch("change");
    },
    state() {
      const select = find("select")[0];
      const [prev, next] = find("button");
      const lines = plane.all().filter((e) => e.name === "polyline" && e.hasAttribute("data-active"));
      return {
        step: walk.all().find((e) => e.getAttribute("data-role") === "step")?.textContent ?? "",
        rects: plane
          .all()
          .filter((e) => e.name === "rect" && e.hasAttribute("data-active"))
          .map((e) => e.getAttribute("data-id")!),
        lines: lines.map((e) =>
          e.hasAttribute("data-from")
            ? `${e.getAttribute("data-from")}->${e.getAttribute("data-to")}`
            : `${e.getAttribute("data-scenario")}#${e.getAttribute("data-step")}`,
        ),
        hash: location.hash,
        selected: select ? select.children.findIndex((o) => o.value === select.value) : -1,
        focusOnNext: next !== undefined && doc.activeElement === next,
        disabled: [prev?.disabled ?? true, next?.disabled ?? true],
        history: history.length,
      };
    },
  };
}
