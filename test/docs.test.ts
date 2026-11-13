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
  join(root, "README.ko.md"),
  join(skill, "SKILL.md"),
  ...readdirSync(docsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => join(docsDir, f)),
];
const read = (path: string) => readFileSync(path, "utf8");
const doc = (name: string) => read(join(docsDir, name));

// Text outside code blocks and inline code. Blocks with a fence of four
// backticks (they hold a three-backtick block) go first.
const outsideBlocks = (text: string) => text.replace(/````[\s\S]*?````/g, "").replace(/```[\s\S]*?```/g, "");
const prose = (text: string) => outsideBlocks(text).replace(/`[^`]*`/g, "");

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
          const errors = diagnosePlan(preparePlan(value), { repo: root, files: new Map(), owners: new Map(), lineCount: () => 1, imports: null, isFile: () => false, unowned: () => false }).filter(
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
    expect(out.stdout).toBe("## codeplan\n\ncheck: ok\n\n### Tasks\n\n| Task | Status | Files |\n|---|---|---|\n| refunds | doing | 1 of 1 |\n| basket-total | done | 1 of 1 |\n");
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

describe("the examples for use without CI", () => {
  const text = doc("without-ci.md");
  const section = (heading: string) => text.slice(text.indexOf(heading));
  const firstBlock = (heading: string) => /```sh\n([\s\S]*?)```/.exec(section(heading))![1]!;
  const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}` };
  const sh = (cwd: string, ...args: string[]) => spawnSync("sh", args, { cwd, encoding: "utf8", env, timeout: 60_000 });
  // A repository whose plan and page match its code.
  const planned = () => {
    const repo = makeRepo({
      "package.json": lines(1),
      "src/cart/index.ts": lines(4),
      "src/cart/checkout.ts": lines(14),
      "src/pay/charge.ts": lines(9),
      "docs/codeplan/plan.json": /```json\n([\s\S]*?)```/.exec(doc("plan-file.md"))![1]!,
      "docs/codeplan/codeplan.mjs": read(join(skill, "codeplan.mjs")),
    });
    expect(run(["update"], repo).code).toBe(0);
    return repo;
  };

  test("the pre-push hook exits with 0 for a plan that matches and with 1 after a new file", () => {
    const repo = planned();
    expect(spawnSync("git", ["init", "-q"], { cwd: repo }).status).toBe(0);
    const install = sh(repo, "-e", "-c", firstBlock("## Checking before your own push"));
    expect(install.status, install.stderr).toBe(0);
    // The hook file is run as git runs it: as a program, from the repository root.
    const hook = () => spawnSync(join(repo, ".git/hooks/pre-push"), [], { cwd: repo, encoding: "utf8", env, timeout: 60_000 });
    const before = hook();
    expect(before.status, `${before.error}\n${before.stderr}`).toBe(0);
    expect(before.stdout).toContain("check: ok");
    writeFileSync(join(repo, "src/pay/refund.ts"), lines(6));
    expect(hook().status).toBe(1);
  });

  test("the exclude line hides the four files from git", () => {
    const repo = planned();
    writeFileSync(join(repo, "codeplan.json"), "{}\n");
    expect(spawnSync("git", ["init", "-q"], { cwd: repo }).status).toBe(0);
    const status = () => spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repo, encoding: "utf8" }).stdout;
    expect(status()).toContain("docs/codeplan/plan.json");
    expect(sh(repo, "-e", "-c", firstBlock("## When the plan cannot be committed")).status).toBe(0);
    expect(status()).not.toMatch(/codeplan/);
    expect(status()).toContain("src/pay/charge.ts");
    expect(run(["check"], repo).code).toBe(0);
  });

  test("the schedule script leaves one record for each run, and history reads them", () => {
    const pull = "git pull --quiet --ff-only";
    const shown = firstBlock("## Checking on a schedule");
    expect(shown.startsWith("#!/bin/sh\n")).toBe(true);
    expect(shown).toContain(`if ! ${pull} 2> "$err"; then`);
    expect(shown).not.toMatch(/pipefail|\[\[|\bfunction\b|\blocal\b/);
    const repo = makeRepo({
      "package.json": lines(1),
      "src/shop/cart.ts": lines(3),
      "src/shop/pay.ts": lines(2),
      "src/auth/login.ts": lines(4),
      "docs/codeplan/plan.json": JSON.stringify({
        format: 1,
        name: "",
        about: "",
        parts: [
          { id: "shop", name: "", about: "", paths: ["src/shop/**"] },
          { id: "auth", name: "", about: "", paths: ["src/auth/**"] },
        ],
      }),
      "docs/codeplan/codeplan.mjs": read(join(skill, "codeplan.mjs")),
    });
    expect(run(["update"], repo).code).toBe(0);
    const records = join(makeRepo({}), "records");
    // The test has no remote: the pull is a command that does nothing, or
    // one that fails. The test gives each run its name.
    const scripts = makeRepo({
      "record.sh": shown.replace(pull, "true"),
      "no-pull.sh": shown.replace(pull, "{ echo 'pull failed here' >&2; false; }"),
    });
    const record = (name: string, script = "record.sh") => sh(repo, join(scripts, script), repo, records, name).status;
    const names = () => readdirSync(records).sort();

    expect(record("t1")).toBe(0);
    writeFileSync(join(repo, "src/misc.ts"), lines(1));
    expect(record("t2")).toBe(0);
    writeFileSync(join(repo, "codeplan.json"), "{");
    expect(record("t3")).toBe(1);
    expect(names()).toEqual(["t1.json", "t2.json", "t3.failed"]);
    expect(read(join(records, "t3.failed")).split("\n")[0]).toBe(run(["snapshot"], repo).stderr.split("\n")[0]);

    // A name that is taken: nothing is written over.
    const first = read(join(records, "t1.json"));
    expect(record("t1")).toBe(2);
    expect(read(join(records, "t1.json"))).toBe(first);
    expect(record("t3")).toBe(2);
    expect(names()).toEqual(["t1.json", "t2.json", "t3.failed"]);

    const columns = (html: string) => [...html.matchAll(/<th data-record="([^"]*)"(?: data-marks="([^"]*)")?>/g)].map((m) => [m[1], m[2]]);
    const out = run(["history", records], repo);
    expect(out).toMatchObject({ code: 0, stderr: "" });
    expect(columns(out.stdout)).toEqual([["t1", undefined], ["t2", "plan page"], ["t3", "not-measured"]]);
    for (const sentence of ["The plan was out of date in t2.", "The page was outdated in t2.", "Not measured: t3."]) {
      expect(out.stdout).toContain(`<p>${sentence}</p>`);
    }

    // A pull that fails leaves a marker file too.
    expect(record("t4", "no-pull.sh")).toBe(2);
    expect(names()).toEqual(["t1.json", "t2.json", "t3.failed", "t4.failed"]);
    expect(read(join(records, "t4.failed")).split("\n")[0]).toBe("pull failed here");
    const after = run(["history", records], repo);
    expect(columns(after.stdout).map((c) => c[0])).toEqual(["t1", "t2", "t3", "t4"]);
    expect(columns(after.stdout).slice(2).map((c) => c[1])).toEqual(["not-measured", "not-measured"]);
    expect(after.stdout).toContain("<p>Not measured: t3, t4.</p>");

    // The history command line the doc shows, with its paths.
    const line = [...text.matchAll(/```sh\n([\s\S]*?)```/g)].map((m) => m[1]!).find((script) => script.includes(" history "))!;
    expect(sh(repo, "-e", "-c", line.replaceAll("/path/to/records", records)).status).toBe(0);
    expect(read(join(records, "history.html"))).toBe(after.stdout);
    expect(run(["history", records], repo).stdout).toBe(after.stdout);
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

describe("the Korean README", () => {
  const english = read(join(root, "README.md"));
  const korean = read(join(root, "README.ko.md"));
  // Sorted, with every repeat kept.
  const bag = (items: Iterable<string>) => [...items].sort();

  test("both files start with the title and the language line", () => {
    expect(english.startsWith("# codeplan\n\nEnglish · [한국어](README.ko.md)\n")).toBe(true);
    expect(korean.startsWith("# codeplan\n\n[English](README.md) · 한국어\n")).toBe(true);
  });

  test("the code blocks are the same, in the same order", () => {
    // A four-backtick block first, as in outsideBlocks.
    const blocks = (text: string) => [...text.matchAll(/````[\s\S]*?````|```[\s\S]*?```/g)].map((m) => m[0]);
    expect(blocks(english).length).toBeGreaterThan(0);
    expect(blocks(korean)).toEqual(blocks(english));
  });

  test("the inline code outside the blocks is the same, with the same counts", () => {
    const inline = (text: string) => bag([...outsideBlocks(text).matchAll(/`[^`]*`/g)].map((m) => m[0]));
    expect(inline(korean)).toEqual(inline(english));
  });

  test("the headings have the same levels in the same order", () => {
    const levels = (text: string) => [...outsideBlocks(text).matchAll(/^#+/gm)].map((m) => m[0].length);
    expect(levels(korean)).toEqual(levels(english));
  });

  test("the link targets are the same, apart from the two in the language lines", () => {
    const targets = (text: string, languageLine: string) =>
      bag([...text.replace(languageLine, "").matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]!));
    expect(targets(korean, "[English](README.md) · 한국어")).toEqual(targets(english, "English · [한국어](README.ko.md)"));
  });
});
