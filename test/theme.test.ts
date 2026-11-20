import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { run } from "../src/cli.js";
import { FRAME, THEMES, ZONES } from "../src/page.js";
import { lines, makeRepo, type Tree } from "./helpers.js";
import { openViewer } from "./viewer-dom.js";

const TOKENS = [
  "--cp-bg", "--cp-text", "--cp-text-dim", "--cp-part-fill", "--cp-part-line", "--cp-ext-fill", "--cp-ext-line",
  "--cp-zone-fill", "--cp-zone-line", "--cp-zone-title", "--cp-part-side", "--cp-edge", "--cp-connector", "--cp-active",
  "--cp-control-fill", "--cp-control-line", "--cp-control-text",
];
// The zone colours of the page alone.
const COLOURS = [1, 2, 3, 4, 5, 6];
const ZONE_TOKENS = COLOURS.map((c) => `--cp-zone-${c}`);
const PAGE_TOKENS = [...TOKENS, ...ZONE_TOKENS];
const TEXT_PAIRS = [
  ["text", "bg"], ["text", "part-fill"], ["text", "ext-fill"], ["text-dim", "bg"], ["control-text", "control-fill"],
  // The raised picture.
  ["text", "part-side"], ["zone-title", "bg"],
  ...COLOURS.map((c) => ["zone-title", `zone-${c}`]),
  // A label box of the raised picture can lie on a zone colour.
  ...COLOURS.map((c) => ["text", `zone-${c}`]),
];
const LINE_PAIRS = [
  ["part-line", "bg"], ["ext-line", "bg"], ["zone-line", "bg"], ["edge", "bg"],
  ["connector", "bg"], ["active", "bg"], ["active", "part-fill"], ["control-line", "bg"],
  ["part-line", "part-side"],
  ...COLOURS.flatMap((c) => ["part-line", "edge", "connector", "active"].map((k) => [k, `zone-${c}`])),
];

// WCAG 2 relative luminance and contrast ratio.
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

const K5: Tree = {
  "package.json": lines(1),
  "src/cart/add.ts": lines(3),
  "src/cart/total.ts": lines(2),
  "src/pay/charge.ts": lines(4),
  "src/pay/charge.test.ts": lines(1),
  "src/admin/panel.ts": lines(6),
};
const SIMPLE = {
  format: 1, name: "mall", about: "",
  parts: [
    { id: "cart", name: "Cart", zone: "store", about: "", paths: ["src/cart/**"] },
    { id: "pay", name: "Pay", zone: "store", about: "", paths: ["src/pay/**"] },
    { id: "admin", name: "Admin", about: "", paths: ["src/admin/**"] },
  ],
};
const WALK = {
  format: 1, name: "mall", about: "",
  parts: [
    { id: "cart", name: "Cart", zone: "store", about: "", paths: ["src/cart/**"], uses: [{ to: "pay" }] },
    { id: "pay", name: "Pay", zone: "store", about: "", paths: ["src/pay/**"], uses: [{ to: "ledger" }] },
    { id: "admin", name: "Admin", about: "", paths: ["src/admin/**"] },
  ],
  externals: [{ id: "ledger", name: "Ledger", about: "" }],
  scenarios: [{
    id: "buy", name: "사기",
    steps: [
      { at: "cart", does: "장바구니를 연다" }, { at: "pay", does: "{cart}에서 값을 받아 {ledger}에 적는다" },
      { at: "pay", does: "영수증을 만든다" }, { at: "cart", does: "돌아간다" }, { at: "ledger", does: "기록을 남긴다" },
    ],
  }],
};

function pageFile(plan: unknown): string {
  const repo = makeRepo({ ...K5, "docs/codeplan/plan.json": JSON.stringify(plan) });
  const out = run(["update"], repo);
  expect(out.code, out.stderr).toBe(0);
  return join(repo, "docs/codeplan/codeplan.html");
}

// The hue of a colour in degrees (HSL), and max - min of its channels.
function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
const spread = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return Math.max(...c) - Math.min(...c);
};

// A page with one part for each entry; the entry is its zone or "".
function zonedPage(zones: string[], extra: Record<string, unknown> = {}): string {
  const ids = zones.map((_, i) => `p${i}`);
  const tree: Tree = { "package.json": lines(1) };
  for (const id of ids) tree[`src/${id}/f.ts`] = lines(2);
  const plan = {
    format: 1, name: "zones", about: "",
    parts: ids.map((id, i) => ({ id, name: id, ...(zones[i] ? { zone: zones[i] } : {}), about: "", paths: [`src/${id}/**`] })),
    ...extra,
  };
  const repo = makeRepo({ ...tree, "docs/codeplan/plan.json": JSON.stringify(plan) });
  const out = run(["update"], repo);
  expect(out.code, out.stderr).toBe(0);
  return join(repo, "docs/codeplan/codeplan.html");
}

describe("the name lines of labels", () => {
  test("a rule of weight 600 matches each name line by its own classes and no line of counts", () => {
    const html = readFileSync(pageFile(WALK), "utf8");
    const css = html.slice(html.indexOf("<style>") + 7, html.indexOf("</style>"));
    // The selectors of the rules that set weight 600; each is one compound
    // of classes, with no combinator.
    const bold = [...css.matchAll(/([^{}]+)\{[^}]*font-weight: 600;[^}]*\}/g)].flatMap((m) => m[1]!.split(",").map((t) => t.trim()));
    expect(bold).toContain(".name");
    for (const selector of bold) expect(selector, selector).toMatch(/^(\.[a-z-]+)+$/);
    const matches = (el: { getAttribute(k: string): string | null }) =>
      bold.some((selector) => selector.slice(1).split(".").every((c) => (el.getAttribute("class") ?? "").split(" ").includes(c)));
    const v = openViewer(pageFile(WALK));
    for (const picture of [v.plane, v.raised]) {
      const labels = picture.children.filter((e) => e.name === "svg" && e.children[0]?.getAttribute("class")?.startsWith("label"));
      expect(labels.length).toBe(4);
      for (const box of labels) {
        const [name, ...rest] = box.children;
        expect(matches(name!), name!.textContent).toBe(true);
        for (const line of rest) expect(matches(line), line.textContent).toBe(false);
      }
    }
  });
});

describe("zone colours", () => {
  test("six opaque colours in each theme, apart in hue and away from grey, and not the background", () => {
    for (const [name, zones] of Object.entries(ZONES)) {
      const theme = THEMES[name as keyof typeof THEMES];
      expect(Object.keys(zones)).toEqual(ZONE_TOKENS);
      const values = Object.values(zones);
      for (const value of values) {
        expect(value).toMatch(/^#[0-9a-f]{6}$/);
        expect(spread(value), `${name} ${value}`).toBeGreaterThanOrEqual(24);
        expect([theme["--cp-bg"], theme["--cp-part-fill"]]).not.toContain(value);
      }
      for (let i = 0; i < values.length; i++) {
        for (let j = i + 1; j < values.length; j++) {
          const d = Math.abs(hue(values[i]!) - hue(values[j]!));
          expect(Math.min(d, 360 - d), `${name} ${values[i]} ${values[j]}`).toBeGreaterThanOrEqual(40);
        }
      }
    }
  });

  // The zone rectangles of the plane picture and the items of the list of
  // zones, each as [zone, colour].
  const drawn = (file: string, hash = "") => {
    const v = openViewer(file, hash);
    const rects = v.plane.children.filter((e) => e.getAttribute("class") === "zone").map((e) => [e.getAttribute("data-zone"), e.getAttribute("data-colour")]);
    const items = v.zones.children.map((e) => [e.getAttribute("data-zone"), e.getAttribute("data-colour"), e.textContent]);
    return { v, rects, items };
  };

  test("colours follow the order zones first come in the parts, not the order of the drawn zones", () => {
    const { v, rects, items } = drawn(zonedPage(["b", "", "a", "b"]));
    expect(v.block.layout.zones.map((z) => z.name)).toEqual(["a", "b"]);
    expect(rects).toEqual([["a", "2"], ["b", "1"]]);
    expect(items).toEqual([["b", "1", "b"], ["a", "2", "a"]]);
    expect(v.plane.children.filter((e) => e.getAttribute("class") === "zone").every((e) => !e.hasAttribute("data-id"))).toBe(true);
  });

  test("no zones: no list items; one zone: colour 1; the seventh zone takes colour 1 again", () => {
    const none = drawn(zonedPage(["", ""]));
    expect([none.rects, none.items]).toEqual([[], []]);
    expect(drawn(zonedPage(["only"])).items).toEqual([["only", "1", "only"]]);
    const seven = drawn(zonedPage(["z1", "z2", "z3", "z4", "z5", "z6", "z7"]));
    expect(seven.items.map((i) => i[1])).toEqual(["1", "2", "3", "4", "5", "6", "1"]);
    expect(seven.rects.find((r) => r[0] === "z7")).toEqual(["z7", "1"]);
  });

  test("the list stays with the raised picture, with the same items", () => {
    const file = zonedPage(["b", "a"]);
    const { v, items } = drawn(file);
    const picture = v.doc.byId.get("tools")!.children.find((c) => c.getAttribute("data-role") === "picture")!;
    const listed = () => v.zones.children.map((e) => [e.getAttribute("data-zone"), e.getAttribute("data-colour"), e.textContent]);
    picture.dispatch("click");
    expect(v.picture().shown).toBe("raised");
    expect([v.zones.hasAttribute("hidden"), listed()]).toEqual([false, items]);
    picture.dispatch("click");
    expect([v.zones.hasAttribute("hidden"), listed()]).toEqual([false, items]);
    const opened = drawn(file, "#picture=raised");
    expect([opened.v.picture().shown, opened.v.zones.hasAttribute("hidden"), opened.items]).toEqual(["raised", false, items]);
  });

  test("the zones of the raised picture have the colours of the plane picture", () => {
    for (const zones of [["b", "", "a", "b"], ["z1", "z2", "z3", "z4", "z5", "z6", "z7"]]) {
      const { v, rects } = drawn(zonedPage(zones));
      const grounds = v.raised.children.filter((e) => e.name === "polygon" && e.getAttribute("class") === "zone");
      expect(grounds.length).toBe(rects.length);
      expect(grounds.map((e) => [e.getAttribute("data-zone"), e.getAttribute("data-colour")]).sort()).toEqual([...rects].sort());
    }
  });

  test("a step of a walk-through leaves the zone colours as they are", () => {
    const file = zonedPage(["a", "b"], { scenarios: [{ id: "s", name: "S", steps: [{ at: "p0", does: "x" }, { at: "p1", does: "y" }] }] });
    const before = drawn(file).rects;
    const { v } = drawn(file, "#scenario=s&step=2");
    const zoneRects = v.plane.children.filter((e) => e.getAttribute("class") === "zone");
    expect(zoneRects.map((e) => [e.getAttribute("data-zone"), e.getAttribute("data-colour")])).toEqual(before);
    expect(zoneRects.filter((e) => e.hasAttribute("data-active"))).toEqual([]);
    expect(v.state().rects).toEqual(["p1"]);
  });
});

describe("theme tokens", () => {
  test("seventeen opaque tokens in each theme, every pair above its contrast, with the zone colours too", () => {
    const mins: string[] = [];
    for (const [name, theme] of Object.entries(THEMES)) {
      expect(Object.keys(theme)).toEqual(TOKENS);
      for (const value of Object.values(theme)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
      const all: Record<string, string> = { ...theme, ...ZONES[name as keyof typeof ZONES] };
      const t = (k: string) => all[`--cp-${k}`]!;
      const textMin = Math.min(...TEXT_PAIRS.map(([a, b]) => contrast(t(a!), t(b!))));
      const lineMin = Math.min(...LINE_PAIRS.map(([a, b]) => contrast(t(a!), t(b!))));
      for (const [a, b] of TEXT_PAIRS) expect(contrast(t(a!), t(b!)), `${name} ${a}/${b}`).toBeGreaterThanOrEqual(4.5);
      for (const [a, b] of LINE_PAIRS) expect(contrast(t(a!), t(b!)), `${name} ${a}/${b}`).toBeGreaterThanOrEqual(3);
      mins.push(`${name}: text ${textMin.toFixed(2)}, lines ${lineMin.toFixed(2)}`);
    }
    console.log(`lowest contrast: ${mins.join("; ")}`);
    for (const theme of Object.values(THEMES)) expect(theme["--cp-part-side"]).not.toBe(theme["--cp-part-fill"]);
    expect(JSON.stringify(THEMES.light)).not.toBe(JSON.stringify(THEMES.dark));
  });

  test("the frame keeps colours in token definitions and has no theme state", () => {
    const html = readFileSync(pageFile(WALK), "utf8");
    const at = html.indexOf('<script type="application/json"');
    const frame = html.slice(0, at) + html.slice(html.indexOf("</script>", at));
    const css = frame.slice(frame.indexOf("<style>") + 7, frame.indexOf("</style>"));

    const defined = [...css.matchAll(/(--cp-[a-z0-9-]+)\s*:/g)].map((m) => m[1]!);
    expect([...new Set(defined)].sort()).toEqual([...PAGE_TOKENS].sort());
    expect([...frame.matchAll(/--cp-[a-z0-9-]+/g)].map((m) => m[0]).every((t) => PAGE_TOKENS.includes(t))).toBe(true);
    const uses = [...frame.matchAll(/var\(([^)]*)\)/g)].map((m) => m[1]!.trim());
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(PAGE_TOKENS, u).toContain(u);
    // The page draws with the zone colours; the zone-fill token is only defined.
    expect(uses).not.toContain("--cp-zone-fill");

    const withoutDefs = frame.replace(/--cp-[a-z0-9-]+\s*:\s*[^;]+;/g, "");
    expect(withoutDefs).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/);
    for (const m of withoutDefs.matchAll(/(?:^|[;{\s])(fill|stroke|color|background(?:-color)?|border(?:-color)?)\s*:\s*([^;}]+)/g)) {
      const value = m[2]!.replace(/var\(--cp-[a-z0-9-]+\)/g, "").replace(/\b(none|transparent|currentColor|inherit|solid|\d+(\.\d+)?px)\b/g, "").trim();
      expect(value, `${m[1]}: ${m[2]}`).toBe("");
    }
    expect(frame).not.toMatch(/transition/);
    expect(frame).not.toMatch(/setInterval|requestAnimationFrame/);
    expect(html).toMatch(/<html lang="en">/);
    expect(html.slice(0, html.indexOf("<html")) + html.slice(html.indexOf("<html"), html.indexOf(">", html.indexOf("<html")))).not.toContain("data-theme");
    expect(html.indexOf("codeplan-theme")).toBeGreaterThan(0);
    expect(html.indexOf("codeplan-theme")).toBeLessThan(html.indexOf("<body>"));

    // Where each token is used.
    for (const rule of [
      /html, body \{[^}]*background: var\(--cp-bg\)[^}]*color: var\(--cp-text\)/,
      /\.part \{ fill: var\(--cp-part-fill\); stroke: var\(--cp-part-line\)/,
      /\.external \{ fill: var\(--cp-ext-fill\); stroke: var\(--cp-ext-line\)/,
      /\.zone \{ stroke: var\(--cp-zone-line\)/,
      ...COLOURS.map((c) => new RegExp(`\\.zone\\[data-colour="${c}"\\], #zones \\[data-colour="${c}"\\]::before \\{ fill: var\\(--cp-zone-${c}\\); background: var\\(--cp-zone-${c}\\); \\}`)),
      /#zones span::before \{[^}]*border: 1px solid var\(--cp-zone-line\)/,
      /#zones \{[^}]*color: var\(--cp-zone-title\)/,
      /\.zone-title \{ fill: var\(--cp-zone-title\)/,
      /\.label \{ fill: var\(--cp-text\)/,
      /\.edge \{[^}]*stroke: var\(--cp-edge\)/,
      /\.connector \{[^}]*stroke: var\(--cp-connector\)/,
      /\.arrow \{ fill: var\(--cp-edge\)/,
      /rect\[data-active\] \{ stroke: var\(--cp-active\)/,
      /polyline\[data-active\] \{ stroke: var\(--cp-active\)/,
      /button, select \{ background: var\(--cp-control-fill\); color: var\(--cp-control-text\); border: 1px solid var\(--cp-control-line\)/,
      /#legend \{[^}]*color: var\(--cp-text-dim\)/,
      /:root \{ color-scheme: light dark;/,
      /:root\[data-theme="light"\] \{ color-scheme: light;/,
      /:root\[data-theme="dark"\] \{ color-scheme: dark;/,
      /@media \(prefers-color-scheme: dark\) \{ :root:not\(\[data-theme\]\)/,
    ]) {
      expect(css).toMatch(rule);
    }
    expect(FRAME.head).toContain('<div id="tools"></div>');
    // The zones of the raised picture are filled too: the colour rules match
    // any element of class zone, and no rule takes the fill away there.
    expect(css).not.toMatch(/#raised \.zone/);
    for (const c of COLOURS) expect(css).toContain(`.zone[data-colour="${c}"]`);
  });
});

describe("the theme button", () => {
  test("cycles auto, light, dark, auto and stores light or dark only", () => {
    const storage = new Map<string, string>();
    const v = openViewer(pageFile(SIMPLE), "", storage);
    expect(v.theme()).toMatchObject({ attr: null, text: "auto" });
    expect(storage.has("codeplan-theme")).toBe(false);
    for (const [attr, text, stored] of [["light", "light", "light"], ["dark", "dark", "dark"], [null, "auto", undefined]] as const) {
      v.theme().button.dispatch("click");
      expect(v.theme()).toMatchObject({ attr, text });
      expect(storage.get("codeplan-theme")).toBe(stored);
      expect(v.location.hash).toBe("");
      expect(v.history.length).toBe(1);
    }
  });

  test("a stored theme applies from the head script; other values read as auto and stay", () => {
    for (const stored of ["dark", "light"]) {
      const v = openViewer(pageFile(SIMPLE), "", new Map([["codeplan-theme", stored]]));
      // Applied by the script before <body>, before the viewer runs.
      expect(v.headScriptBeforeBody).toBe(true);
      expect(v.themeBeforeViewer).toBe(stored);
      expect(v.theme()).toMatchObject({ attr: stored, text: stored });
    }
    expect(openViewer(pageFile(SIMPLE), "", new Map([["codeplan-theme", "blue"]])).themeBeforeViewer).toBe(null);
    const blue = new Map([["codeplan-theme", "blue"]]);
    const b = openViewer(pageFile(SIMPLE), "", blue);
    expect(b.theme()).toMatchObject({ attr: null, text: "auto" });
    expect(blue.get("codeplan-theme")).toBe("blue");
    b.theme().button.dispatch("click");
    expect(blue.get("codeplan-theme")).toBe("light");
    const auto = new Map([["codeplan-theme", "auto"]]);
    const a = openViewer(pageFile(SIMPLE), "", auto);
    expect(auto.get("codeplan-theme")).toBe("auto");
    for (let i = 0; i < 3; i++) a.theme().button.dispatch("click");
    expect(a.theme()).toMatchObject({ attr: null, text: "auto" });
    expect(auto.has("codeplan-theme")).toBe(false);
  });

  test("a storage that throws: the page opens in auto and the button still works", () => {
    const v = openViewer(pageFile(SIMPLE), "", "throws");
    expect(v.theme()).toMatchObject({ attr: null, text: "auto" });
    for (const [text, attr] of [["light", "light"], ["dark", "dark"], ["auto", null]] as const) {
      v.theme().button.dispatch("click");
      expect(v.theme()).toMatchObject({ text, attr });
    }
  });

  test("the walk-through stays as it is across theme changes; keys work with focus on the theme button", () => {
    const v = openViewer(pageFile(WALK), "#scenario=buy&step=2");
    const at = () => ({ step: v.state().step, rects: v.state().rects, lines: v.state().lines, hash: v.state().hash, history: v.state().history });
    const before = at();
    expect(before).toMatchObject({ step: "2/5 Pay: Cart에서 값을 받아 Ledger에 적는다", rects: ["pay"], lines: ["cart->pay"], hash: "#scenario=buy&step=2" });
    for (let i = 0; i < 3; i++) {
      v.theme().button.dispatch("click");
      expect(at()).toEqual(before);
    }
    v.theme().button.focus();
    v.press("ArrowRight");
    expect(v.state()).toMatchObject({ step: "3/5 Pay: 영수증을 만든다", rects: ["pay"], lines: [], hash: "#scenario=buy&step=3" });
    expect(v.doc.activeElement).toBe(v.theme().button);
    v.press("ArrowLeft");
    expect(v.state()).toMatchObject({ step: "2/5 Pay: Cart에서 값을 받아 Ledger에 적는다", lines: ["cart->pay"], hash: "#scenario=buy&step=2" });
    v.press("Escape");
    expect(v.state()).toMatchObject({ step: "", hash: "" });
  });

  test("pages without scenarios or parts still have one theme button, outside the scenario controls", () => {
    for (const plan of [SIMPLE, { format: 1, name: "empty", about: "", parts: [] }]) {
      const v = openViewer(pageFile(plan));
      expect(v.walk.children).toEqual([]);
      expect(v.doc.byId.get("tools")!.children.filter((c) => c.getAttribute("data-role") === "theme")).toHaveLength(1);
      v.theme().button.dispatch("click");
      expect(v.theme().text).toBe("light");
    }
  });
});
