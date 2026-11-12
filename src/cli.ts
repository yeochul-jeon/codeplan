// Command line: `check`, `update`, `draft` and `help`.
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { SettingsError, readConfig, type Config } from "./config.js";
import { DraftError, draft } from "./draft.js";
import { measure, type Measurement } from "./measure.js";
import { planPath, readPlanFile } from "./plan.js";
import { layOut } from "./layout.js";
import { PAGE_MARK, pageHtml } from "./page.js";
import { mermaidText, summaryText } from "./summary.js";
import { diagnosePlan, diagnostic, preparePlan, type Diagnostic } from "./validate.js";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type CheckResult =
  | { kind: "error"; message: string }
  | {
      kind: "measured";
      config: Config;
      // The plan file's JSON value, or null when there is no plan file.
      plan: unknown;
      measurement: Measurement;
      diagnostics: Diagnostic[];
      // Parts left out of measurement; when any, orphans are not listed.
      excluded: number;
      // The page as update would write it now, or null when update would
      // not write (no plan, an error diagnostic, a contested file).
      page: { path: string; bytes: Buffer | null; current: boolean };
    };

const USAGE = `Usage: node codeplan.mjs <command> [--repo <dir>] [options]

Commands:
  check   Measure the repository against its plan and report files no part
          owns, files two parts own equally, code outside the watch set,
          problems in the plan, and a viewer page that update would change.
          Writes nothing.
  update  Write the viewer page (codeplan.html under home by default) from
          the plan and the code.
  draft   Read the repository and print a first plan.json and codeplan.json
          as one JSON document on standard output. Writes nothing.
  summary Print the plan as Markdown on standard output: the parts with
          their counts, uses, externals, scenarios and a mermaid diagram.
          Writes nothing and does not read the viewer page.
  help    Show this text.

Options:
  --repo <dir>        Repository to read (default: the current directory).

Summary options:
  --mermaid           Print only the mermaid diagram.

Draft options:
  --max-parts <n>     Most parts to propose (default 16).
  --language <name>   Language rules to use: js or java. Repeat for both.
  --root <dir>        Source root to use instead of the language rules.
                      Repeat for more than one.

Exit codes for check: 0 no problems, 1 problems or warnings,
2 an error in the plan, the config or plan file cannot be read, or the page
place holds something that is not a codeplan page.
Exit codes for update: 0 written, already current, or no plan file;
1 contested files (nothing written); 2 as for check.
Exit codes for draft: 0 printed, 2 an option, the config or the repository
cannot be used.
Exit codes for summary: 0 printed (warnings, orphans, contested and
unwatched files do not change it); 2 an error in the plan, no plan file, or
the config or plan file cannot be read.
`;

const LIST_LIMIT = 30;

// The commands and options the command line takes.
export const COMMANDS = ["check", "update", "draft", "summary", "help"];
export const OPTIONS = ["--repo", "--max-parts", "--language", "--root", "--mermaid"];

// What is at the page place: nothing, a codeplan page, or something else.
function pagePlace(repo: string, page: string): { kind: "absent" } | { kind: "page"; bytes: Buffer } | { kind: "other"; what: string } {
  // The directories on the way must be real directories (or not exist yet):
  // the page is never written through a symbolic link.
  const segments = page.split("/");
  for (let i = 1; i < segments.length; i++) {
    const dir = lstatSync(join(repo, ...segments.slice(0, i)), { throwIfNoEntry: false });
    if (dir === undefined) break;
    if (dir.isSymbolicLink()) return { kind: "other", what: "a path through a symbolic link" };
    if (!dir.isDirectory()) return { kind: "other", what: "a path that passes through a file" };
  }
  const stat = lstatSync(join(repo, page), { throwIfNoEntry: false });
  if (stat === undefined) return { kind: "absent" };
  if (stat.isSymbolicLink()) return { kind: "other", what: "a symbolic link" };
  if (!stat.isFile()) return { kind: "other", what: stat.isDirectory() ? "a directory" : "not a regular file" };
  const bytes = readFileSync(join(repo, page));
  if (!bytes.subarray(0, PAGE_MARK.length).equals(Buffer.from(PAGE_MARK))) {
    return { kind: "other", what: "a file that does not start with the codeplan page mark" };
  }
  return { kind: "page", bytes };
}

// `withPage: false` leaves the page place unread (summary).
export function check(repo: string, withPage = true): CheckResult {
  let config: Config;
  try {
    config = readConfig(repo);
  } catch (e) {
    if (e instanceof SettingsError) return { kind: "error", message: e.message };
    throw e;
  }
  const file = readPlanFile(repo, config.home);
  if (file.kind === "not-json") return { kind: "error", message: file.message };
  const place = withPage ? pagePlace(repo, config.page) : { kind: "absent" as const };
  if (place.kind === "other") {
    return {
      kind: "error",
      message:
        `${config.page} is ${place.what}, not a codeplan page; it was left as it is. ` +
        "Move it away, or set page in codeplan.json to another file under home",
    };
  }
  const notCompared = { path: config.page, bytes: null, current: false };
  if (file.kind === "missing") {
    const plan = planPath(config.home);
    const measurement = measure(repo, config, []);
    const diagnostics = [diagnostic("no-plan", "plan", `${plan} not found, so every watched file is an orphan`)];
    return { kind: "measured", config, plan: null, measurement, diagnostics, excluded: 0, page: notCompared };
  }
  const prepared = preparePlan(file.value);
  const measurement = measure(repo, config, prepared.parts);
  const diagnostics = diagnosePlan(prepared, {
    repo,
    files: new Map(measurement.parts.map((p) => [p.id, p.files])),
    owners: measurement.owners,
  });
  const result = {
    kind: "measured" as const,
    config,
    plan: file.value,
    measurement,
    diagnostics,
    excluded: prepared.excluded,
  };
  if (!withPage || diagnostics.some((d) => d.severity === "error") || measurement.contested.length > 0) {
    return { ...result, page: notCompared };
  }
  const bytes = Buffer.from(pageFor(file.value, measurement), "utf8");
  const current = place.kind === "page" && place.bytes.equals(bytes);
  return { ...result, page: { path: config.page, bytes, current } };
}

// The page for a plan with no error diagnostic: every part is an object
// with a proper id, name and paths, and was measured, in plan order.
function pageFor(plan: unknown, m: Measurement): string {
  type Raw = {
    parts: { id: string; name: string; zone?: string; planned?: boolean; uses?: { to: string }[] }[];
    externals?: { id: string; name: string }[];
    scenarios?: { id: string; steps: { at: string }[] }[];
  };
  const raw = plan as Raw;
  const parts = m.parts.map((p) => ({ id: p.id, files: p.files, lines: p.lines }));
  const externals = raw.externals ?? [];
  // Edges: each part's uses in order, without itself and without repeats.
  const edges: { from: string; to: string }[] = [];
  const seen = new Set<string>();
  for (const part of raw.parts) {
    for (const use of part.uses ?? []) {
      const key = JSON.stringify([part.id, use.to]);
      if (use.to === part.id || seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: part.id, to: use.to });
    }
  }
  // Connectors: neighbouring steps at different places with no edge between.
  const connectors: { scenario: string; step: number; from: string; to: string }[] = [];
  for (const scenario of raw.scenarios ?? []) {
    scenario.steps.forEach((step, k) => {
      if (k === 0) return;
      const a = scenario.steps[k - 1]!.at;
      const b = step.at;
      if (a === b || seen.has(JSON.stringify([a, b])) || seen.has(JSON.stringify([b, a]))) return;
      connectors.push({ scenario: scenario.id, step: k, from: a, to: b });
    });
  }
  const layout = layOut(
    raw.parts.map((part, i) => ({
      id: part.id,
      name: part.name,
      zone: part.zone,
      lines: parts[i]!.lines,
      files: parts[i]!.files,
      planned: part.planned === true,
    })),
    externals.map((e) => ({ id: e.id, name: e.name })),
    { edges, connectors },
  );
  return pageHtml({
    format: 2,
    plan,
    measure: {
      parts,
      files: parts.reduce((s, p) => s + p.files, 0),
      lines: parts.reduce((s, p) => s + p.lines, 0),
    },
    orphans: m.orphans,
    unwatched: m.unwatched.length,
    layout,
  });
}

function update(repo: string): RunResult {
  const result = check(repo);
  if (result.kind === "error") return { code: 2, stdout: "", stderr: `codeplan: ${result.message}\n` };
  const { config, diagnostics, measurement: m, page } = result;
  const plan = planPath(config.home);
  if (diagnostics.some((d) => d.code === "no-plan")) {
    return { code: 0, stdout: `update: ${plan} not found, so no page was written\n`, stderr: "" };
  }
  const errors = diagnostics.filter((d) => d.severity === "error");
  if (errors.length > 0) {
    let stderr = "";
    for (const d of errors) stderr += `${d.at}: ${d.code} [${d.severity}] ${d.message}\n`;
    stderr += `update: the plan has errors, so ${page.path} was not written\n  fix: correct ${plan}, then run update again\n`;
    return { code: 2, stdout: "", stderr };
  }
  if (m.contested.length > 0) {
    const stderr =
      listSection(
        "contested files: two or more parts own them with equally strong patterns",
        "give one part a pattern with a longer fixed prefix, or remove the overlap",
        m.contested.map((c) => `${c.path} (${c.parts.join(", ")})`),
      ) + `update: contested files, so ${page.path} was not written\n`;
    return { code: 1, stdout: "", stderr };
  }
  if (page.current) return { code: 0, stdout: `update: ${page.path} is up to date\n`, stderr: "" };
  // A new file beside the page, renamed over it: a link that appears at the
  // page place, or a hard link to a file elsewhere, is replaced, not written
  // through.
  const target = join(repo, page.path);
  let temp: string | null = null;
  try {
    mkdirSync(dirname(target), { recursive: true });
    // A name no file has: created exclusively, so an existing file or link
    // under that name is never opened.
    for (let n = 0; temp === null; n++) {
      const name = join(dirname(target), `.${basename(target)}.${process.pid}.${n}.tmp`);
      try {
        const fd = openSync(name, "wx");
        temp = name;
        try {
          writeSync(fd, page.bytes!);
        } finally {
          closeSync(fd);
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST" || temp !== null) throw e;
      }
    }
    renameSync(temp, target);
  } catch (e) {
    if (temp !== null) rmSync(temp, { force: true });
    return { code: 2, stdout: "", stderr: `codeplan: cannot write ${page.path}: ${(e as Error).message}\n` };
  }
  return { code: 0, stdout: `update: wrote ${page.path}\n`, stderr: "" };
}

const FIXES: Record<string, string> = {
  "bad-shape": "give the field at that place the type and form of the plan format, or remove an unknown key",
  "repeated-id": "give each part, external and scenario an id of its own",
  "no-paths": "give the part at least one pattern in paths",
  "unknown-target": "name an existing part or external, or add it",
  "empty-part": "correct the part's paths so they match files, or remove the part",
  "planned-has-files":
    "remove planned from the part now that it has code; if the files are not its code, correct the part's paths",
  "start-missing": "point start at a file in the repository",
  "start-elsewhere": "point start at a file this part measures",
  "self-use": "remove the use of the part itself",
  "repeated-use": "keep one use for each target",
  "unused-external": "name the external in a use or a step, or remove it",
  "short-scenario": "give the scenario two steps or more",
  "gap-in-scenario": "add a use between the two steps' parts, or a step between them",
  "unknown-reference": "write the id of an existing part or external in the braces",
};

// The findings in the plan file, then one fix line for each code.
function findingLines(diagnostics: Diagnostic[], plan: string): string {
  let text = "";
  for (const d of diagnostics) text += `${d.at}: ${d.code} [${d.severity}] ${d.message}\n`;
  for (const code of new Set(diagnostics.map((d) => d.code))) {
    const fix = code === "no-plan" ? `create ${plan} and give each part the paths it owns` : FIXES[code];
    text += `  fix: ${code}: ${fix}\n`;
  }
  return text;
}

function summary(repo: string, mermaid: boolean): RunResult {
  const result = check(repo, false);
  if (result.kind === "error") return { code: 2, stdout: "", stderr: `codeplan: ${result.message}\n` };
  const stderr = findingLines(result.diagnostics, planPath(result.config.home));
  if (result.plan === null || result.diagnostics.some((d) => d.severity === "error")) {
    return { code: 2, stdout: "", stderr };
  }
  const stdout = mermaid ? mermaidText(result.plan) : summaryText(result.plan, result.measurement);
  return { code: 0, stdout, stderr };
}

function listSection(title: string, fix: string, items: string[]): string {
  if (items.length === 0) return "";
  const shown = items.slice(0, LIST_LIMIT).map((i) => `  ${i}\n`);
  const rest = items.length - LIST_LIMIT;
  const more = rest > 0 ? `  ... and ${rest} more\n` : "";
  return `${title} (${items.length})\n  fix: ${fix}\n${shown.join("")}${more}`;
}

function report(result: CheckResult & { kind: "measured" }): RunResult {
  const { config, measurement: m, diagnostics, excluded } = result;
  const plan = planPath(config.home);
  let stdout = `languages: ${config.languages.join(", ")}\n`;
  stdout += `watched files: ${m.watchedFiles}\n`;
  for (const p of m.parts) stdout += `part ${p.id}: ${p.files} files, ${p.lines} lines\n`;

  let stderr = "";
  const orphans = excluded > 0 ? [] : m.orphans;
  if (excluded > 0) {
    stderr +=
      `measurement incomplete: ${excluded} parts are not measured, so orphan files are not listed\n` +
      `  fix: correct the errors in ${plan} below\n`;
  }
  stderr += listSection(
    "orphan files: no part owns them",
    `add a pattern to a part's paths in ${plan}, or list them under skip in codeplan.json`,
    orphans,
  );
  stderr += listSection(
    "contested files: two or more parts own them with equally strong patterns",
    "give one part a pattern with a longer fixed prefix, or remove the overlap",
    m.contested.map((c) => `${c.path} (${c.parts.join(", ")})`),
  );
  stderr += listSection(
    "unwatched files: code outside the watch set",
    "add a pattern for them under watch, or under skip, in codeplan.json",
    m.unwatched,
  );
  const outdated = result.page.bytes !== null && !result.page.current;
  if (outdated) {
    stderr +=
      `page outdated: ${result.page.path} differs from the page update would write now\n` +
      `  fix: run update\n`;
  }
  stderr += findingLines(diagnostics, plan);

  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.length - errors;
  const problems = orphans.length + m.contested.length + m.unwatched.length;
  if (problems === 0 && diagnostics.length === 0 && excluded === 0 && !outdated) {
    stdout += "check: ok\n";
    return { code: 0, stdout, stderr };
  }
  stdout +=
    `check: ${excluded > 0 ? "measurement incomplete" : `${orphans.length} orphan`}, ` +
    `${m.contested.length} contested, ${m.unwatched.length} unwatched, ` +
    `${errors} errors, ${warnings} warnings${outdated ? ", page outdated" : ""}\n`;
  return { code: errors > 0 ? 2 : 1, stdout, stderr };
}

export function run(argv: readonly string[], cwd: string): RunResult {
  const usageError = (message: string): RunResult => ({
    code: 2,
    stdout: "",
    stderr: `codeplan: ${message}\n\n${USAGE}`,
  });
  let command: string | undefined;
  let repo = cwd;
  let maxParts: string | undefined;
  const languages: string[] = [];
  const roots: string[] = [];
  const draftFlags: string[] = [];
  let mermaid = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--repo") {
      const value = argv[++i];
      if (value === undefined) return usageError("--repo needs a directory");
      repo = resolve(cwd, value);
    } else if (arg === "--mermaid") {
      mermaid = true;
    } else if (OPTIONS.includes(arg)) {
      const value = argv[++i];
      if (value === undefined) return usageError(`${arg} needs a value`);
      draftFlags.push(arg);
      if (arg === "--max-parts") maxParts = value;
      else if (arg === "--language") languages.push(value);
      else roots.push(value);
    } else if (arg.startsWith("-")) {
      return usageError(`unknown option ${arg}`);
    } else if (command === undefined) {
      command = arg;
    } else {
      return usageError(`unexpected argument ${arg}`);
    }
  }
  if (command === "help") return { code: 0, stdout: USAGE, stderr: "" };
  if (command === undefined || !COMMANDS.includes(command)) {
    return usageError(command === undefined ? "no command given" : `unknown command ${command}`);
  }
  if (command !== "draft" && draftFlags.length > 0) {
    return usageError(`${draftFlags[0]} is an option of draft only`);
  }
  if (command !== "summary" && mermaid) return usageError("--mermaid is an option of summary only");
  if (maxParts !== undefined && !/^[0-9]+$/.test(maxParts)) {
    return usageError(`--max-parts needs a whole number of 1 or more, not "${maxParts}"`);
  }
  const parts = maxParts === undefined ? 16 : Number(maxParts);
  if (parts < 1) return usageError(`--max-parts needs a whole number of 1 or more, not "${maxParts}"`);
  if (!statSync(repo, { throwIfNoEntry: false })?.isDirectory()) {
    return { code: 2, stdout: "", stderr: `codeplan: repository not found: ${repo}\n` };
  }
  if (command === "draft") {
    try {
      const out = draft(repo, {
        maxParts: parts,
        languages: languages.length > 0 ? languages : null,
        roots: roots.length > 0 ? roots : null,
      });
      return { code: 0, stdout: `${JSON.stringify(out, null, 2)}\n`, stderr: "" };
    } catch (e) {
      if (e instanceof SettingsError || e instanceof DraftError) {
        return { code: 2, stdout: "", stderr: `codeplan: ${e.message}\n` };
      }
      throw e;
    }
  }
  if (command === "update") return update(repo);
  if (command === "summary") return summary(repo, mermaid);
  const result = check(repo);
  if (result.kind === "error") {
    return { code: 2, stdout: "", stderr: `codeplan: ${result.message}\n` };
  }
  return report(result);
}
