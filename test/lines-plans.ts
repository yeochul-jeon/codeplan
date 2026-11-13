// Plans for the tests of lines: a tree and a plan file from a short list.
import { lines, type Tree } from "./helpers.js";

export interface PartSpec {
  id: string;
  name?: string;
  zone?: string;
  lines: number;
  uses?: string[];
}
export interface PlanSpec {
  parts: PartSpec[];
  externals?: { id: string; name: string }[];
  // Each scenario as the places of its steps.
  scenarios?: string[][];
}

export function treeOf(spec: PlanSpec): Tree {
  const tree: Tree = { "package.json": lines(1) };
  for (const p of spec.parts) tree[`src/${p.id}/f.ts`] = lines(p.lines);
  tree["docs/codeplan/plan.json"] = JSON.stringify({
    format: 1,
    name: "lines",
    about: "",
    parts: spec.parts.map((p) => ({
      id: p.id,
      name: p.name ?? p.id,
      ...(p.zone ? { zone: p.zone } : {}),
      about: "",
      paths: [`src/${p.id}/**`],
      uses: (p.uses ?? []).map((to) => ({ to })),
    })),
    externals: (spec.externals ?? []).map((x) => ({ ...x, about: "" })),
    scenarios: (spec.scenarios ?? []).map((steps, i) => ({
      id: `s${i}`,
      name: `Scenario ${i}`,
      steps: steps.map((at) => ({ at, does: "step" })),
    })),
  });
  return tree;
}

// Plans that draw no line.
export const NO_LINES: Record<string, PlanSpec> = {
  "parts, zones and an external": {
    parts: [
      { id: "cart", name: "Cart", zone: "store", lines: 30 },
      { id: "pay", name: "", zone: "store", lines: 400 },
      { id: "stock", zone: "back", lines: 2500 },
      { id: "admin", name: "Admin", lines: 6 },
    ],
    externals: [{ id: "bank", name: "Bank" }, { id: "mail", name: "" }],
  },
  "a part that uses only itself": {
    parts: [
      { id: "cart", zone: "store", lines: 30, uses: ["cart"] },
      { id: "pay", zone: "store", lines: 400, uses: ["pay", "pay"] },
      { id: "admin", lines: 6 },
    ],
  },
  "a scenario whose steps stay in one place": {
    parts: [
      { id: "cart", zone: "store", lines: 30 },
      { id: "pay", lines: 400 },
    ],
    externals: [{ id: "bank", name: "Bank" }],
    scenarios: [["cart", "cart", "cart"], ["bank"], []],
  },
};

// The size of a plan seen in use: 11 parts, 2 externals, 21 edges and one
// scenario of 10 steps.
export const HOST: PlanSpec = {
  parts: [
    { id: "web", name: "Web API", zone: "api", lines: 150, uses: ["auth", "chat", "agents", "tools", "config"] },
    { id: "auth", name: "Auth", zone: "api", lines: 35, uses: ["store", "config"] },
    { id: "stream", name: "Streaming", zone: "api", lines: 54, uses: ["chat", "config"] },
    { id: "chat", name: "Chat", zone: "core", lines: 200, uses: ["agents", "memory", "llm", "store"] },
    { id: "agents", name: "Agents", zone: "core", lines: 258, uses: ["tools", "llm", "memory"] },
    { id: "tools", name: "Tools", zone: "core", lines: 125, uses: ["search", "config"] },
    { id: "memory", name: "Memory", zone: "core", lines: 75, uses: ["store"] },
    { id: "store", name: "Store", zone: "data", lines: 100, uses: ["config"] },
    { id: "search", name: "Search", zone: "data", lines: 58 },
    { id: "config", name: "Config", lines: 21 },
    { id: "jobs", name: "Jobs", lines: 45, uses: ["agents"] },
  ],
  externals: [{ id: "llm", name: "LLM" }, { id: "db", name: "DB" }],
  scenarios: [["web", "auth", "web", "chat", "agents", "tools", "search", "agents", "llm", "stream"]],
};
