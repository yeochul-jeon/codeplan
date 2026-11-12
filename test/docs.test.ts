import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { COMMANDS, OPTIONS, run } from "../src/cli.js";
import { KEYS } from "../src/config.js";
import { THEMES } from "../src/page.js";
import { diagnosePlan, KNOWN, preparePlan, SEVERITY } from "../src/validate.js";
import { lines, makeRepo } from "./helpers.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skill = join(root, "skill/codeplan");
const docsDir = join(skill, "docs");
const DOCS = [
  join(root, "README.md"),
  join(skill, "SKILL.md"),
  ...readdirSync(docsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => join(docsDir, f)),
];
const read = (path: string) => readFileSync(path, "utf8");
const doc = (name: string) => read(join(docsDir, name));

// Text outside code blocks and inline code. Blocks with a fence of four
// backticks (they hold a three-backtick block) go first.
const prose = (text: string) =>
  text
    .replace(/````[\s\S]*?````/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "");

// The backticked names in the first column of the tables under a heading.
function firstColumn(text: string, heading: string): string[] {
  const start = text.indexOf(heading);
  if (start < 0) throw new Error(`no heading ${heading}`);
  const next = text.slice(start + heading.length).search(/\n#{1,2} /);
  const section = next < 0 ? text.slice(start) : text.slice(start, start + heading.length + next);
  return [...section.matchAll(/^\| `([^`]+)`/gm)].map((m) => m[1]!.split(" ")[0]!);
}

const sorted = (items: Iterable<string>) => [...new Set(items)].sort();

describe("names in the code and in the docs", () => {
  test("diagnostic codes", () => {
    expect(sorted(firstColumn(doc("diagnostics.md"), "## Codes"))).toEqual(sorted(Object.keys(SEVERITY)));
  });
  test("commands and options", () => {
    const text = doc("commands.md");
    const names = firstColumn(text, "# Commands");
    expect(sorted(names.filter((n) => !n.startsWith("--")))).toEqual(sorted(COMMANDS));
    expect(sorted(names.filter((n) => n.startsWith("--")))).toEqual(sorted(OPTIONS));
  });
  test("config keys", () => {
    expect(sorted(firstColumn(doc("config.md"), "## Keys"))).toEqual(sorted(KEYS));
  });
  test("plan file keys", () => {
    expect(sorted(firstColumn(doc("plan-file.md"), "## Fields"))).toEqual(sorted(Object.values(KNOWN).flat()));
  });
  test("theme tokens", () => {
    expect(sorted(firstColumn(doc("page.md"), "## Themes"))).toEqual(sorted(Object.keys(THEMES.light)));
    const all = DOCS.flatMap((f) => [...read(f).matchAll(/--cp-[a-z-]+/g)].map((m) => m[0]));
    for (const token of all) expect(Object.keys(THEMES.light)).toContain(token);
  });
  test("every --option named in the docs exists", () => {
    const named = DOCS.flatMap((f) => [...read(f).matchAll(/`(--[a-z][a-z-]*)/g)].map((m) => m[1]!));
    for (const option of named) {
      if (option.startsWith("--cp-")) continue;
      expect(OPTIONS, option).toContain(option);
    }
  });
});

describe("examples in the docs", () => {
  test("every JSON example parses, and every plan file example has no error", () => {
    let plans = 0;
    for (const file of DOCS) {
      for (const m of read(file).matchAll(/```json\n([\s\S]*?)```/g)) {
        const value = JSON.parse(m[1]!) as Record<string, unknown>;
        if (value && typeof value === "object" && "format" in value && "parts" in value) {
          plans++;
          const errors = diagnosePlan(preparePlan(value), { repo: root, files: new Map(), owners: new Map() }).filter(
            (d) => d.severity === "error",
          );
          expect(errors, file).toEqual([]);
        }
      }
    }
    expect(plans).toBeGreaterThan(0);
  });

  test("the README quick start runs and check exits with 0", () => {
    const readme = read(join(root, "README.md"));
    const section = readme.slice(readme.indexOf("## Quick start"));
    const script = /```sh\n([\s\S]*?)```/.exec(section)![1]!.replaceAll("/path/to/codeplan", root);
    const repo = makeRepo({
      "package.json": lines(1),
      "src/shop/cart.ts": lines(3),
      "src/shop/pay.ts": lines(2),
      "src/admin/panel.ts": lines(4),
    });
    const out = spawnSync("sh", ["-e", "-c", script], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}` },
      timeout: 60_000,
    });
    expect(out.status, out.stderr + out.stdout).toBe(0);
    expect(out.stdout).toContain("check: ok");
    expect(run(["check"], repo).code).toBe(0);
    expect(run(["summary"], repo).code).toBe(0);
  });

  test("the summary doc shows what summary prints for the plan file doc's example", () => {
    const plan = /```json\n([\s\S]*?)```/.exec(doc("plan-file.md"))![1]!;
    const shownOutput = /````markdown\n([\s\S]*?)````/.exec(doc("summary.md"))![1]!;
    const repo = makeRepo({
      "package.json": lines(1),
      "src/cart/index.ts": lines(4),
      "src/cart/checkout.ts": lines(14),
      "src/pay/charge.ts": lines(9),
      "docs/codeplan/plan.json": plan,
      "docs/codeplan/codeplan.mjs": read(join(skill, "codeplan.mjs")),
    });
    expect(run(["summary"], repo)).toEqual({ code: 0, stdout: shownOutput, stderr: "" });
    const diagram = /```mermaid\n([\s\S]*?)```/.exec(shownOutput)![1]!;
    const sh = (script: string) =>
      spawnSync("sh", ["-e", "-c", script], {
        cwd: repo,
        encoding: "utf8",
        env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}` },
        timeout: 60_000,
      });

    // The command lines the docs show, run as written.
    const diagramCommand = [...doc("summary.md").matchAll(/```sh\n([\s\S]*?)```/g)]
      .map((m) => m[1]!)
      .find((script) => script.includes("> plan.mmd"))!;
    expect(sh(diagramCommand).status).toBe(0);
    expect(read(join(repo, "plan.mmd"))).toBe(diagram);

    const skillText = read(join(skill, "SKILL.md"));
    const section = skillText.slice(skillText.indexOf("## The plan as text"));
    const out = sh(/```sh\n([\s\S]*?)```/.exec(section)![1]!);
    expect(out.status, out.stderr).toBe(0);
    expect(out.stdout).toBe(shownOutput);
  });

  test("the CI doc's workflow steps run in a git repository and print the report the doc shows", () => {
    const text = doc("ci.md");
    const shownReport = /````markdown\n([\s\S]*?)````/.exec(text)![1]!;
    const yaml = /```yaml\n([\s\S]*?)```/.exec(text)![1]!;
    // The run steps: a block after `run: |`, or the rest of a `run:` line.
    const steps = [...yaml.matchAll(/^( *)run: (?:\|\n((?:\1 {2,}.*\n)+)|(.*)\n)/gm)].map((m) => m[2] ?? m[3]!);
    expect(steps).toHaveLength(3);

    const repo = makeRepo({
      "package.json": lines(1),
      "src/cart/index.ts": lines(4),
      "src/cart/checkout.ts": lines(14),
      "src/pay/charge.ts": lines(9),
      "docs/codeplan/plan.json": /```json\n([\s\S]*?)```/.exec(doc("plan-file.md"))![1]!,
      "docs/codeplan/codeplan.mjs": read(join(skill, "codeplan.mjs")),
    });
    const git = (...args: string[]) => {
      const out = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", ...args], {
        cwd: repo,
        encoding: "utf8",
      });
      expect(out.status, out.stderr).toBe(0);
      return out.stdout.trim();
    };
    git("init", "-q");
    expect(run(["update"], repo).code).toBe(0);
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    const base = git("rev-parse", "HEAD");
    writeFileSync(join(repo, "src/pay/refund.ts"), lines(6));
    expect(run(["update"], repo).code).toBe(0);
    git("add", "-A");
    git("commit", "-q", "-m", "head");

    const temp = makeRepo({});
    const summaryFile = join(temp, "summary.md");
    for (const step of steps) {
      const out = spawnSync("sh", ["-e", "-c", step.replace("${{ github.event.pull_request.base.sha }}", base)], {
        cwd: repo,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
          RUNNER_TEMP: temp,
          GITHUB_STEP_SUMMARY: summaryFile,
        },
        timeout: 60_000,
      });
      expect(out.status, `${step}\n${out.stderr}`).toBe(0);
    }
    expect(read(summaryFile)).toBe(shownReport);
    expect(JSON.parse(read(join(temp, "base.json"))).snapshot).toBe(1);

    // The command shown without a base, as written.
    const alone = [...text.matchAll(/```sh\n([\s\S]*?)```/g)].map((m) => m[1]!);
    expect(alone).toHaveLength(1);
    const out = spawnSync("sh", ["-e", "-c", alone[0]!], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}` },
    });
    expect(out.stdout).toBe("## codeplan\n\ncheck: ok\n");
  });

  test("the snapshot fields in the CI doc are the fields snapshot prints", () => {
    const repo = makeRepo({ "package.json": lines(1), "src/a.ts": lines(1) });
    const printed = JSON.parse(run(["snapshot"], repo).stdout) as Record<string, unknown>;
    expect(firstColumn(doc("ci.md"), "## What snapshot prints")).toEqual(Object.keys(printed));
  });

  test("the SKILL.md first-plan commands keep the other keys of a codeplan.json that is already there", () => {
    const text = read(join(skill, "SKILL.md"));
    const section = text.slice(text.indexOf("## The repository has no plan yet"));
    const script = /```sh\n([\s\S]*?)```/.exec(section)![1]!;
    expect(script).toContain("node -e");
    const repo = makeRepo({
      "package.json": lines(1),
      "src/shop/cart.ts": lines(3),
      "src/admin/panel.ts": lines(4),
      "vendor/lib.ts": lines(5),
      "codeplan.json": `${JSON.stringify({ skip: ["vendor/**"], tests: false, watch: ["old/**"] })}\n`,
    });
    const out = spawnSync("sh", ["-e", "-c", script], {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
        CLAUDE_SKILL_DIR: skill,
      },
      timeout: 60_000,
    });
    expect(out.status, out.stderr + out.stdout).toBe(0);
    expect(JSON.parse(read(join(repo, "codeplan.json")))).toEqual({ skip: ["vendor/**"], tests: false, languages: ["js"] });
    expect(existsSync(join(repo, "codeplan-draft.json"))).toBe(false);
    expect(run(["update"], repo).code).toBe(0);
    expect(run(["check"], repo).code).toBe(0);
  });
});

describe("the skill folder", () => {
  test("SKILL.md has only the allowed header keys and a short body", () => {
    const text = read(join(skill, "SKILL.md"));
    expect(text.startsWith("---\n")).toBe(true);
    const end = text.indexOf("\n---\n", 4);
    const header = text.slice(4, end);
    const keys = header.split("\n").map((l) => l.slice(0, l.indexOf(":")));
    expect(keys.filter((k) => !["name", "description", "license"].includes(k))).toEqual([]);
    expect(header).toMatch(/^name: codeplan$/m);
    expect(header).toMatch(/^license: MIT$/m);
    const description = /^description: (.*)$/m.exec(header)![1]!;
    expect(description.length).toBeLessThanOrEqual(1536);
    expect(description).toMatch(/^Use when /);
    const body = text.slice(end + 5);
    expect(body.split("\n").length).toBeLessThan(500);
    expect(body).toContain("${CLAUDE_SKILL_DIR}/codeplan.mjs");
  });

  test("the committed codeplan.mjs matches a fresh build", () => {
    const out = spawnSync(process.execPath, [join(root, "scripts/build.mjs"), "--check"], { encoding: "utf8", timeout: 60_000 });
    expect(out.status, out.stderr).toBe(0);
  });
});

describe("the text of the docs", () => {
  test("relative links point at files that exist", () => {
    for (const file of DOCS) {
      for (const m of read(file).matchAll(/\]\(([^)]+)\)/g)) {
        const target = m[1]!;
        if (/^[a-z]+:/.test(target) || target.startsWith("#")) continue;
        expect(existsSync(resolve(dirname(file), target.split("#")[0]!)), `${file}: ${target}`).toBe(true);
      }
    }
  });

  test("no section signs, case numbers, or words the docs do not use", () => {
    for (const file of DOCS) {
      const text = read(file);
      expect(text, file).not.toContain("§");
      expect(text, file).not.toMatch(/\bE\d{1,3}\b/);
      expect(prose(text), file).not.toMatch(
        /\b(drift|stale|falls behind|unmapped|unclaimed|footprint|payload|proposer|scanner|authored|appendix|specification)\b/i,
      );
      expect(text, file).not.toMatch(/^#+ (Gotchas|What not to do|Before you start|Scale|Voice|Step \d+)/m);
    }
  });
});
