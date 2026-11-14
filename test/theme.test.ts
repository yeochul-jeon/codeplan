import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { run } from "../src/cli.js";
import { FRAME, THEMES } from "../src/page.js";
import { lines, makeRepo, type Tree } from "./helpers.js";
import { openViewer } from "./viewer-dom.js";

const TOKENS = [
  "--cp-bg", "--cp-text", "--cp-text-dim", "--cp-part-fill", "--cp-part-line", "--cp-ext-fill", "--cp-ext-line",
  "--cp-zone-fill", "--cp-zone-line", "--cp-zone-title", "--cp-part-side", "--cp-edge", "--cp-connector", "--cp-active",
  "--cp-control-fill", "--cp-control-line", "--cp-control-text",
];
const TEXT_PAIRS = [
  ["text", "bg"], ["text", "part-fill"], ["text", "ext-fill"], ["zone-title", "zone-fill"], ["text-dim", "bg"], ["control-text", "control-fill"],
  // The raised picture.
  ["text", "part-side"], ["zone-title", "bg"],
];
const LINE_PAIRS = [
  ["part-line", "bg"], ["part-line", "zone-fill"], ["ext-line", "bg"], ["zone-line", "bg"], ["edge", "bg"], ["edge", "zone-fill"],
  ["connector", "bg"], ["connector", "zone-fill"], ["active", "bg"], ["active", "zone-fill"], ["active", "part-fill"], ["control-line", "bg"],
  ["part-line", "part-side"],
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

describe("theme tokens", () => {
  test("seventeen opaque tokens in each theme, every pair above its contrast", () => {
    const mins: string[] = [];
    for (const [name, theme] of Object.entries(THEMES)) {
      expect(Object.keys(theme)).toEqual(TOKENS);
      for (const value of Object.values(theme)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
      const t = (k: string) => (theme as Record<string, string>)[`--cp-${k}`]!;
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

    const defined = [...css.matchAll(/(--cp-[a-z-]+)\s*:/g)].map((m) => m[1]!);
    expect([...new Set(defined)].sort()).toEqual([...TOKENS].sort());
    expect([...frame.matchAll(/--cp-[a-z-]+/g)].map((m) => m[0]).every((t) => TOKENS.includes(t))).toBe(true);
    const uses = [...frame.matchAll(/var\(([^)]*)\)/g)].map((m) => m[1]!.trim());
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(TOKENS, u).toContain(u);

    const withoutDefs = frame.replace(/--cp-[a-z-]+\s*:\s*[^;]+;/g, "");
    expect(withoutDefs).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/);
    for (const m of withoutDefs.matchAll(/(?:^|[;{\s])(fill|stroke|color|background(?:-color)?|border(?:-color)?)\s*:\s*([^;}]+)/g)) {
      const value = m[2]!.replace(/var\(--cp-[a-z-]+\)/g, "").replace(/\b(none|transparent|currentColor|inherit|solid|\d+(\.\d+)?px)\b/g, "").trim();
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
      /\.zone \{ fill: var\(--cp-zone-fill\); stroke: var\(--cp-zone-line\)/,
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
