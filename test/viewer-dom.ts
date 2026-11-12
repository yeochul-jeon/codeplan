// A small stand-in for the browser, enough to run the page's viewer code in
// node:vm: elements with attributes, children, text, events and focus, a
// location hash and a history that replaceState does not grow.
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
  listeners = new Map<string, ((event: unknown) => void)[]>();
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
  addEventListener(type: string, fn: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
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
  walk: El;
  legend: El;
  block: Block;
  press(key: string, modifiers?: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }): void;
  // The fragment changes from outside (address bar, a link): hashchange.
  navigate(hash: string): void;
  theme(): { attr: string | null; text: string; button: El };
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

export function openViewer(pageFile: string, hash = "", storage: Storage = new Map()): Viewer {
  const page = readFileSync(pageFile, "utf8");
  const { block, raw } = readBlock(page);
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
  // The early theme script in the head, then the viewer at the end.
  if (scripts.length !== 2) throw new Error(`expected two scripts, found ${scripts.length}`);
  const doc = new FakeDocument();
  for (const id of ["tools", "plane", "tasks", "walk", "legend", "codeplan-data"]) {
    const el = new El(id === "plane" ? "svg" : id === "codeplan-data" ? "script" : "div", doc);
    doc.byId.set(id, el);
  }
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
    walk,
    legend: doc.byId.get("legend")!,
    block,
    themeBeforeViewer,
    headScriptBeforeBody,
    press(key, modifiers = {}) {
      for (const fn of doc.listeners.get("keydown") ?? []) fn({ key, ...modifiers, preventDefault() {} });
    },
    theme() {
      const button = doc.byId.get("tools")!.children.find((c) => c.getAttribute("data-role") === "theme")!;
      return { attr: doc.documentElement.getAttribute("data-theme"), text: button.textContent, button };
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
