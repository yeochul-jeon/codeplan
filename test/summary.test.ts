// The summary command: the plan as Markdown, or only its mermaid diagram.
import { describe, expect, test } from "vitest";
import { check, run } from "../src/cli.js";
import { lines, makeRepo, type Tree } from "./helpers.js";
import { treeState } from "./page-helpers.js";

const K: Tree = {
  "package.json": lines(1),
  "README.md": lines(1),
  "src/shop/cart.ts": lines(3),
  "src/shop/pay.ts": lines(2),
  "src/shop/cart.test.ts": lines(1),
  "src/auth/login.ts": lines(4),
};
const PLAN_FILE = "docs/codeplan/plan.json";

type Item = Record<string, unknown>;
interface Plan {
  name: string;
  about: string;
  parts: Item[];
  externals: Item[];
  scenarios: Item[];
}

function planWith(change: (plan: Plan) => void = () => {}): Plan {
  const plan: Plan & { format: number } = {
    format: 1,
    name: "shopfront",
    about: "The shop. {shop} calls {auth}.",
    parts: [
      {
        id: "shop",
        name: "Shop",
        zone: "store",
        about: "Cart and pay.",
        paths: ["src/shop/**"],
        uses: [{ to: "auth", why: "to sign in" }, { to: "mail" }],
      },
      { id: "auth", name: "", about: "", paths: ["src/auth/**"] },
    ],
    externals: [{ id: "mail", name: "Mail", about: "Sends receipts." }],
    scenarios: [
      {
        id: "buy",
        name: "Buy",
        steps: [
          { at: "shop", does: "takes the order" },
          { at: "auth", does: "" },
        ],
      },
    ],
  };
  change(plan);
  return plan;
}

const DIAGNOSTIC = /^(\S+): ([a-z-]+) \[(error|warning)\] (.*)$/;

// Runs summary and summary --mermaid; neither writes, and a second run
// prints the same bytes.
function summarised(plan: unknown, more: Tree = {}) {
  const tree: Tree = { ...K, ...more };
  if (plan !== null) tree[PLAN_FILE] = JSON.stringify(plan, null, 2);
  const repo = makeRepo(tree);
  const before = treeState(repo);
  const out = run(["summary"], repo);
  const mermaid = run(["summary", "--mermaid"], repo);
  expect(run(["summary"], repo)).toEqual(out);
  expect(run(["summary", "--mermaid"], repo)).toEqual(mermaid);
  expect(treeState(repo)).toEqual(before);
  expect(mermaid.code).toBe(out.code);
  expect(mermaid.stderr).toBe(out.stderr);
  const rows = out.stderr
    .split("\n")
    .map((l) => DIAGNOSTIC.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => [m[1], m[2], m[3]]);
  return { repo, out, mermaid, rows, text: out.stdout.split("\n"), diagram: mermaid.stdout.split("\n") };
}

const BASE_DIAGRAM = `flowchart LR
  subgraph z0["store"]
    p0["Shop"]
  end
  p1["auth"]
  x0[("Mail")]
  p0 -->|"to sign in"| p1
  p0 --> x0
`;

const BASE_TEXT = `# shopfront

The shop. **Shop** calls **auth**.

## Parts

| Part | Id | Zone | Files | Lines |
|---|---|---|---|---|
| Shop | shop | store | 2 | 5 |
| auth | auth |  | 1 | 4 |

### Shop

Cart and pay.

Uses:

- **auth**: to sign in
- **Mail**

### auth

## Externals

| External | Id | About |
|---|---|---|
| Mail | mail | Sends receipts. |

## Scenarios

### Buy

1. **Shop**: takes the order
2. **auth**

## Diagram

\`\`\`mermaid
${BASE_DIAGRAM}\`\`\`
`;

describe("summary", () => {
  test("prints the whole plan as Markdown, and --mermaid only the diagram", () => {
    const r = summarised(planWith());
    expect(r.out).toEqual({ code: 0, stdout: BASE_TEXT, stderr: "" });
    expect(r.mermaid).toEqual({ code: 0, stdout: BASE_DIAGRAM, stderr: "" });
  });

  test("plan text is written so that Markdown and mermaid show it as it is", () => {
    const r = summarised(
      planWith((p) => {
        const shop = p.parts[0]!;
        shop.name = "A|B *x*";
        shop.about = "<b>hi</b> & `c`\nnext";
        shop.zone = 'z"q#';
        (shop.uses as Item[])[0]!.why = 'say "hi" | <go>';
      }),
    );
    expect(r.out.code).toBe(0);
    const expected = BASE_TEXT.replace("| Shop | shop | store | 2 | 5 |", '| A\\|B \\*x\\* | shop | z"q\\# | 2 | 5 |')
      .replace("### Shop", "### A\\|B \\*x\\*")
      .replace("Cart and pay.", "\\<b\\>hi\\</b\\> \\& \\`c\\` next")
      .replace("- **auth**: to sign in", '- **auth**: say "hi" \\| \\<go\\>')
      .replace("The shop. **Shop** calls **auth**.", "The shop. **A\\|B \\*x\\*** calls **auth**.")
      .replace("1. **Shop**: takes the order", "1. **A\\|B \\*x\\***: takes the order")
      .replace('  subgraph z0["store"]', '  subgraph z0["z#34;q#35;"]')
      .replace('    p0["Shop"]', '    p0["A#124;B *x*"]')
      .replace('  p0 -->|"to sign in"| p1', '  p0 -->|"say #34;hi#34; #124; #60;go#62;"| p1');
    expect(r.out.stdout).toBe(expected);
  });

  test.each([
    ["- not a list", "\\- not a list"],
    ["12. first", "12\\. first"],
    ["+ x", "\\+ x"],
    ["= x", "\\= x"],
    ["3) x", "3\\) x"],
    ["# x", "\\# x"],
  ])("a paragraph that starts with %j does not start a list or heading", (about, line) => {
    const r = summarised(planWith((p) => (p.about = about)));
    expect(r.out.stdout).toBe(BASE_TEXT.replace("The shop. **Shop** calls **auth**.", line));
  });

  test.each([
    ["  - x", "\\- x\n\n"],
    ["    code", "code\n\n"],
    ["   ", ""],
    ["\t1. y  ", "1\\. y\n\n"],
    [" \n ", ""],
  ])("an about paragraph of %j loses the spaces and tabs at its ends", (about, block) => {
    const r = summarised(planWith((p) => (p.about = about)));
    expect(r.out.stdout).toBe(BASE_TEXT.replace("The shop. **Shop** calls **auth**.\n\n", block));
    // A part's about follows the same rule.
    const part = summarised(planWith((p) => (p.parts[0]!.about = about)));
    expect(part.out.stdout).toBe(BASE_TEXT.replace("Cart and pay.\n\n", block));
  });

  test("a percent sign in a mermaid label is written as a character code", () => {
    const r = summarised(planWith((p) => (p.parts[0]!.name = "50% %%{init}%%")));
    expect(r.diagram).toContain('    p0["50#37; #37;#37;{init}#37;#37;"]');
    expect(r.text).toContain("| 50% %%{init}%% | shop | store | 2 | 5 |");
  });

  test("a planned part shows planned for its counts and a dashed class in the diagram", () => {
    const r = summarised(
      planWith((p) => p.parts.push({ id: "refund", name: "Refund", about: "", paths: ["src/refund/**"], planned: true })),
    );
    expect(r.out.code).toBe(0);
    expect(r.out.stderr).toBe("");
    const diagram = BASE_DIAGRAM.replace('  x0[("Mail")]\n', '  p2["Refund"]\n  x0[("Mail")]\n').concat(
      "  classDef planned stroke-dasharray: 5 5\n  class p2 planned\n",
    );
    expect(r.mermaid.stdout).toBe(diagram);
    expect(r.out.stdout).toBe(
      BASE_TEXT.replace("| auth | auth |  | 1 | 4 |\n", "| auth | auth |  | 1 | 4 |\n| Refund | refund |  | planned | planned |\n")
        .replace("### auth\n", "### auth\n\n### Refund\n")
        .replace(BASE_DIAGRAM, diagram),
    );
  });

  test("zones come in code unit order, and node names never come from ids", () => {
    const part = (id: string, paths: string, more: Item = {}) => ({ id, name: "", about: "", paths: [paths], ...more });
    const r = summarised({
      format: 1,
      name: "shopfront",
      about: "",
      parts: [
        part("end", "src/shop/**", { zone: "web", uses: [{ to: "b" }] }),
        part("a", "src/auth/**", { zone: "core" }),
        part("b", "src/x/**"),
        part("c", "src/y/**", { zone: "web" }),
      ],
    });
    expect(r.rows).toEqual([
      ["parts[2].paths", "empty-part", "warning"],
      ["parts[3].paths", "empty-part", "warning"],
    ]);
    expect(r.out.stderr.split("\n").filter((l) => l.startsWith("  fix: empty-part: "))).toHaveLength(1);
    expect(r.out.code).toBe(0);
    expect(r.mermaid.stdout).toBe(`flowchart LR
  subgraph z0["core"]
    p1["a"]
  end
  subgraph z1["web"]
    p0["end"]
    p3["c"]
  end
  p2["b"]
  p0 --> p2
`);
  });

  test("an error in the plan gives no output and exit code 2", () => {
    const r = summarised(planWith((p) => ((p.parts[0]!.uses as Item[])[0]!.to = "ghost")));
    expect(r.out.stdout).toBe("");
    expect(r.mermaid.stdout).toBe("");
    // Without the use of auth, the scenario's two steps have no use between them.
    expect(r.rows).toEqual([
      ["parts[0].uses[0].to", "unknown-target", "error"],
      ["scenarios[0].steps[1].at", "gap-in-scenario", "warning"],
    ]);
    expect(r.out.stderr).toContain('part "shop"');
    expect(r.out.code).toBe(2);
  });

  test("no plan file gives no output and exit code 2", () => {
    const r = summarised(null);
    expect(r.out.stdout).toBe("");
    expect(r.rows).toEqual([["plan", "no-plan", "warning"]]);
    expect(r.out.code).toBe(2);
  });

  test("orphans and unwatched files get a line each after the table", () => {
    const r = summarised(planWith(), {
      "src/misc/x.ts": lines(1),
      "scripts/run.ts": lines(1),
      "codeplan.json": JSON.stringify({ watch: ["src/**/*.ts"] }),
    });
    expect(r.out.code).toBe(0);
    expect(r.out.stdout).toBe(
      BASE_TEXT.replace(
        "| auth | auth |  | 1 | 4 |\n",
        "| auth | auth |  | 1 | 4 |\n\n1 watched files belong to no part.\n\n1 code files are outside the watch set.\n",
      ),
    );
  });

  test("an unknown option is refused, and option order does not matter", () => {
    const repo = makeRepo({ ...K, [PLAN_FILE]: JSON.stringify(planWith()) });
    const bogus = run(["summary", "--bogus"], repo);
    expect(bogus.code).toBe(2);
    expect(bogus.stdout).toBe("");
    const a = run(["summary", "--mermaid", "--repo", repo], "/");
    const b = run(["summary", "--repo", repo, "--mermaid"], "/");
    expect(a).toEqual(b);
    expect(a.stdout).toBe(BASE_DIAGRAM);
    expect(run(["check", "--mermaid"], repo).code).toBe(2);
    expect(run(["summary", "--max-parts", "3"], repo).code).toBe(2);
  });

  test("the counts are the ones check reports", () => {
    const r = summarised(planWith(), { "src/shop/extra.ts": lines(7) });
    expect(r.text).toContain("| Shop | shop | store | 3 | 12 |");
    expect(run(["check"], r.repo).stdout).toContain("part shop: 3 files, 12 lines");
  });

  test("summary does not read the page place", () => {
    const repo = makeRepo({ ...K, [PLAN_FILE]: JSON.stringify(planWith()), "docs/codeplan/codeplan.html": "not a page" });
    expect(check(repo).kind).toBe("error");
    expect(run(["summary"], repo)).toEqual({ code: 0, stdout: BASE_TEXT, stderr: "" });
  });

  test("a reference to nothing stays as written, and an empty name falls back", () => {
    const r = summarised(
      planWith((p) => {
        p.name = "";
        p.about = "See {nobody} and {mail}.";
        (p.scenarios[0] as Item).name = "";
      }),
    );
    expect(r.rows).toEqual([["about", "unknown-reference", "warning"]]);
    expect(r.out.code).toBe(0);
    expect(r.text[0]).toBe("# codeplan");
    expect(r.text[2]).toBe("See {nobody} and **Mail**.");
    expect(r.text).toContain("### buy");
  });
});
