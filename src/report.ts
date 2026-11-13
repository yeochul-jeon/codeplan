// snapshot: what check found, as JSON. report: the same as Markdown for a
// pull request, with the changes since a base snapshot when one is given.
import type { Config } from "./config.js";
import { fixedHead } from "./glob.js";
import { byCodeUnit, type Measurement } from "./measure.js";
import type { PlanPart } from "./plan.js";
import { filesCell, plain } from "./summary.js";
import { STATUSES, type Diagnostic, type PlanTask, type Status } from "./validate.js";

export const SNAPSHOT_FORMAT = 1;
// Raised when a change makes the same tree measure differently.
export const RULES = 1;
export const LIST_LIMIT = 30;

export type PageState = "ok" | "outdated" | "missing" | "foreign" | "not-checked";

interface SnapshotPart {
  id: string;
  paths: string[];
  planned: boolean;
  files: number;
  lines: number;
}

export interface Snapshot {
  snapshot: number;
  rules: number;
  config: Pick<Config, "languages" | "watch" | "skip" | "roots" | "tests">;
  plan: "ok" | "missing" | "invalid";
  complete: boolean;
  page: PageState;
  parts: SnapshotPart[];
  owned: { path: string; part: string; pattern: string }[];
  orphans: string[];
  contested: { path: string; parts: string[] }[];
  unwatched: string[];
  tasks: SnapshotTask[];
  diagnostics: (Diagnostic & { fix: string })[];
}

export interface SnapshotTask {
  id: string;
  status: Status | null;
  makes: string[];
  missing: string[];
}

export function takeSnapshot(found: {
  config: Config;
  hasPlan: boolean;
  measured: PlanPart[];
  measurement: Measurement;
  diagnostics: Diagnostic[];
  tasks: PlanTask[];
  excluded: number;
  pageState: PageState;
  fix: (code: string) => string;
}): Snapshot {
  const { config, measurement: m } = found;
  const counts = new Map(m.parts.map((p) => [p.id, p]));
  const contested = new Set(m.contested.map((c) => c.path));
  const complete = found.excluded === 0;
  return {
    snapshot: SNAPSHOT_FORMAT,
    rules: RULES,
    config: {
      languages: config.languages,
      watch: config.watch,
      skip: config.skip,
      roots: config.roots,
      tests: config.tests,
    },
    plan: !found.hasPlan ? "missing" : found.diagnostics.some((d) => d.severity === "error") ? "invalid" : "ok",
    complete,
    page: found.pageState,
    parts: found.measured.map((p) => ({
      id: p.id,
      paths: p.paths,
      planned: p.planned === true,
      files: counts.get(p.id)!.files,
      lines: counts.get(p.id)!.lines,
    })),
    owned: [...m.owners]
      .filter(([path, part]) => part !== null && !contested.has(path))
      .map(([path, part]) => ({ path, part: part!, pattern: m.wonBy.get(path)! }))
      .sort((a, b) => byCodeUnit(a.path, b.path)),
    orphans: complete ? [...m.orphans].sort(byCodeUnit) : [],
    contested: m.contested
      .map((c) => ({ path: c.path, parts: [...c.parts].sort(byCodeUnit) }))
      .sort((a, b) => byCodeUnit(a.path, b.path)),
    unwatched: [...m.unwatched].sort(byCodeUnit),
    tasks: found.tasks.map((t) => ({ id: t.id, status: t.status, makes: t.makes, missing: t.missing })),
    diagnostics: found.diagnostics.map((d) => ({
      at: d.at,
      code: d.code,
      severity: d.severity,
      message: d.message,
      fix: found.fix(d.code),
    })),
  };
}

export function snapshotText(snapshot: Snapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");
const each = (v: unknown, ok: (item: Record<string, unknown>) => boolean) =>
  Array.isArray(v) && v.every((item) => isObj(item) && ok(item));

// A snapshot read back from a file. Throws an Error that says what is wrong.
export function readSnapshot(text: string): Snapshot {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("it is not JSON");
  }
  return shapedSnapshot(value);
}

// A parsed JSON value as a snapshot. Throws an Error that says what is wrong.
export function shapedSnapshot(value: unknown): Snapshot {
  if (!isObj(value)) throw new Error("it is not a snapshot");
  if (value.snapshot !== SNAPSHOT_FORMAT) {
    throw new Error(`its snapshot format is ${JSON.stringify(value.snapshot)}, and this codeplan reads ${SNAPSHOT_FORMAT}`);
  }
  if (value.rules !== RULES) {
    throw new Error(`its counting rules are ${JSON.stringify(value.rules)}, and this codeplan counts with ${RULES}`);
  }
  const shaped =
    isObj(value.config) &&
    (value.plan === "ok" || value.plan === "missing" || value.plan === "invalid") &&
    typeof value.complete === "boolean" &&
    typeof value.page === "string" &&
    each(
      value.parts,
      (p) =>
        typeof p.id === "string" &&
        strings(p.paths) &&
        typeof p.planned === "boolean" &&
        typeof p.files === "number" &&
        typeof p.lines === "number",
    ) &&
    each(value.owned, (o) => typeof o.path === "string" && typeof o.part === "string" && typeof o.pattern === "string") &&
    strings(value.orphans) &&
    each(value.contested, (c) => typeof c.path === "string" && strings(c.parts)) &&
    strings(value.unwatched) &&
    each(value.diagnostics, (d) => typeof d.at === "string" && typeof d.code === "string");
  if (!shaped) throw new Error("it does not have the fields of a snapshot");
  // A snapshot from before tasks has no `tasks` key.
  if (!("tasks" in value)) value.tasks = [];
  const tasksShaped = each(
    value.tasks,
    (t) =>
      typeof t.id === "string" &&
      (t.status === null || STATUSES.includes(t.status as Status)) &&
      strings(t.makes) &&
      strings(t.missing),
  );
  if (!tasksShaped) throw new Error("its tasks do not have the fields of a snapshot");
  const ids = (value.tasks as SnapshotTask[]).map((t) => t.id);
  if (new Set(ids).size !== ids.length) throw new Error("two of its tasks have the same id");
  return value as unknown as Snapshot;
}

// A Markdown list of at most LIST_LIMIT items.
function list(items: string[]): string {
  const shown = items.slice(0, LIST_LIMIT).map((item) => `- ${item}`);
  if (items.length > LIST_LIMIT) shown.push(`- and ${items.length - LIST_LIMIT} more`);
  return shown.join("\n");
}

export function statusLine(head: Snapshot): string {
  const errors = head.diagnostics.filter((d) => d.severity === "error").length;
  const counted: [number, string][] = [
    [errors, "errors"],
    [head.diagnostics.filter((d) => d.severity === "warning").length, "warnings"],
    [head.orphans.length, "orphan files"],
    [head.contested.length, "contested files"],
    [head.unwatched.length, "unwatched files"],
  ];
  const reasons = counted.filter(([n]) => n > 0).map(([n, what]) => `${n} ${what}`);
  if (head.page === "outdated") reasons.push("page outdated");
  if (head.page === "missing") reasons.push("page missing");
  if (head.page === "foreign") reasons.push("foreign page");
  if (!head.complete) reasons.push("measurement incomplete");
  return reasons.length === 0 ? "check: ok" : `check: fails (${reasons.join(", ")})`;
}

// Equal by value: objects key by key in any order, arrays item by item in
// order.
export function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  if (isObj(a) && isObj(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => k in b && sameValue(a[k], b[k]));
  }
  return a === b;
}

// The config keys a snapshot has; any other key in a file is not compared.
export const configOf = ({ config }: Snapshot) => ({
  languages: config.languages,
  watch: config.watch,
  skip: config.skip,
  roots: config.roots,
  tests: config.tests,
});

// A table of at most LIST_LIMIT data rows, then how many rows were left out.
function table(head: string, rows: string[]): string[] {
  const columns = head.split("|").length - 2;
  const blocks = [[head, `|${"---|".repeat(columns)}`, ...rows.slice(0, LIST_LIMIT)].join("\n")];
  if (rows.length > LIST_LIMIT) blocks.push(`And ${rows.length - LIST_LIMIT} more rows.`);
  return blocks;
}

const taskRow = (t: SnapshotTask) => `| ${plain(t.id)} | ${t.status ?? ""} | ${filesCell(t)} |`;

// The tasks that are new, changed or removed between base and head: for
// each, the cells Task, Status, Files and Change as they are, not yet
// written for Markdown.
export function taskChanges(head: Snapshot, base: Snapshot): string[][] {
  const before = new Map(base.tasks.map((t) => [t.id, t]));
  const after = new Set(head.tasks.map((t) => t.id));
  const paths = (list: string[]) => [...new Set(list)].sort(byCodeUnit);
  const counts = (t: SnapshotTask) => `${t.makes.length - t.missing.length} of ${t.makes.length}`;
  const rows: string[][] = [];
  for (const t of head.tasks) {
    const b = before.get(t.id);
    if (b === undefined) {
      rows.push([t.id, t.status ?? "", filesCell(t), "new"]);
    } else if (b.status !== t.status || !sameValue(paths(b.makes), paths(t.makes)) || !sameValue(paths(b.missing), paths(t.missing))) {
      rows.push([t.id, `${b.status ?? ""} → ${t.status ?? ""}`, `${counts(b)} → ${counts(t)}`, "changed"]);
    }
  }
  for (const b of base.tasks) if (!after.has(b.id)) rows.push([b.id, b.status ?? "", filesCell(b), "removed"]);
  return rows;
}

// Whether the rules differ between base and head: the config, or the paths
// of a part both have.
export function rulesDiffer(head: Snapshot, base: Snapshot): boolean {
  const before = new Map(base.parts.map((p) => [p.id, p]));
  return (
    !sameValue(configOf(base), configOf(head)) ||
    head.parts.some((p) => before.has(p.id) && !sameValue(before.get(p.id)!.paths, p.paths))
  );
}

export interface PartChange {
  id: string;
  files: string;
  lines: string;
  change: "new" | "changed" | "planned, has code" | "removed";
  // Lines in head less lines in base, for a part both have.
  by: number | null;
}

// What changed between base and head. `why` says which side stops the
// comparison. `tasks` is null when neither side has a task.
export type Comparison =
  | { compared: false; why: "no-plan" | "base" | "head" }
  | { compared: true; parts: PartChange[]; rulesDiffer: boolean; tasks: "invalid" | string[][] | null };

export function compare(head: Snapshot, base: Snapshot): Comparison {
  if (base.plan === "missing") return { compared: false, why: "no-plan" };
  if (!base.complete || !head.complete) return { compared: false, why: base.complete ? "head" : "base" };
  const before = new Map(base.parts.map((p) => [p.id, p]));
  const after = new Set(head.parts.map((p) => p.id));
  const parts: PartChange[] = [];
  for (const p of head.parts) {
    const b = before.get(p.id);
    if (b === undefined) {
      parts.push({ id: p.id, files: `${p.files}`, lines: `${p.lines}`, change: "new", by: null });
    } else if ((b.planned && !p.planned) || b.files !== p.files || b.lines !== p.lines) {
      const change = b.planned && p.files >= 1 ? "planned, has code" : "changed";
      parts.push({ id: p.id, files: `${b.files} → ${p.files}`, lines: `${b.lines} → ${p.lines}`, change, by: p.lines - b.lines });
    }
  }
  for (const b of base.parts) {
    if (!after.has(b.id)) parts.push({ id: b.id, files: `${b.files}`, lines: `${b.lines}`, change: "removed", by: null });
  }
  const tasks =
    base.plan === "invalid" || head.plan === "invalid"
      ? "invalid"
      : base.tasks.length === 0 && head.tasks.length === 0
        ? null
        : taskChanges(head, base);
  return { compared: true, parts, rulesDiffer: rulesDiffer(head, base), tasks };
}

// The blocks under "### Changes", and whether the rules differ between
// base and head (a config or pattern change).
function changes(head: Snapshot, base: Snapshot): { blocks: string[]; rulesDiffer: boolean } {
  const found = compare(head, base);
  if (!found.compared) {
    const block =
      found.why === "no-plan"
        ? "No plan in the base, so there is nothing to compare."
        : `Measurement is incomplete in the ${found.why}, so changes are not shown.`;
    return { blocks: [block], rulesDiffer: false };
  }
  const rows = found.parts.map((p) => `| ${p.id} | ${p.files} | ${p.lines} | ${p.change} |`);
  const blocks =
    rows.length === 0
      ? ["No part changed."]
      : [["| Part | Files | Lines | Change |", "|---|---|---|---|", ...rows].join("\n")];
  if (found.rulesDiffer) {
    blocks.push("The config or part patterns changed, so some changes come from new rules, not new code.");
  }
  if (found.tasks === "invalid") {
    blocks.push("The plan has errors, so task changes are not shown.");
  } else if (found.tasks !== null) {
    const taskRows = found.tasks.map(([id, ...cells]) => `| ${plain(id!)} | ${cells.join(" | ")} |`);
    blocks.push(...(taskRows.length === 0 ? ["No task changed."] : table("| Task | Status | Files | Change |", taskRows)));
  }
  return { blocks, rulesDiffer: found.rulesDiffer };
}

// Files that a wide pattern took into a part from a directory the base had
// no watched file in.
function newDirectories(head: Snapshot, base: Snapshot): string[] {
  const dirOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
  const baseDirs = new Set(
    [...base.owned.map((o) => o.path), ...base.orphans, ...base.contested.map((c) => c.path)].map(dirOf),
  );
  const baseParts = new Set(base.parts.map((p) => p.id));
  const groups = new Map<string, { dir: string; part: string; pattern: string; files: number }>();
  for (const file of head.owned) {
    if (!file.path.includes("/")) continue;
    const dir = dirOf(file.path);
    const fixed = fixedHead(file.pattern);
    if (baseDirs.has(dir) || !baseParts.has(file.part)) continue;
    if (!`${dir}/`.startsWith(fixed) || dir.length + 1 <= fixed.length) continue;
    const key = JSON.stringify([dir, file.part, file.pattern]);
    const group = groups.get(key) ?? { dir, part: file.part, pattern: file.pattern, files: 0 };
    group.files++;
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort((a, b) => byCodeUnit(a.dir, b.dir) || byCodeUnit(a.part, b.part) || byCodeUnit(a.pattern, b.pattern))
    .map((g) => `${plain(g.dir)}/: ${g.files} files went to part ${g.part} through ${plain(g.pattern)}`);
}

export function reportText(head: Snapshot, base: Snapshot | null): string {
  const blocks = ["## codeplan", statusLine(head)];
  if (head.diagnostics.length > 0) {
    blocks.push("### Findings");
    blocks.push(list(head.diagnostics.map((d) => `${plain(d.at)}: ${d.code} [${d.severity}] ${plain(d.message)}`)));
  }
  if (!head.complete) {
    blocks.push("Measurement is incomplete, so files in no part are not listed.");
  } else if (head.orphans.length > 0) {
    blocks.push("### Files in no part", list(head.orphans.map(plain)));
  }
  if (head.contested.length > 0) {
    blocks.push("### Contested files", list(head.contested.map((c) => `${plain(c.path)}: ${c.parts.join(", ")}`)));
  }
  if (head.unwatched.length > 0) {
    blocks.push("### Unwatched files", list(head.unwatched.map(plain)));
  }
  if (head.tasks.length > 0) {
    blocks.push("### Tasks", ...table("| Task | Status | Files |", head.tasks.map((t) => taskRow(t))));
  }
  if (base !== null) {
    const changed = changes(head, base);
    blocks.push("### Changes", ...changed.blocks);
    if (!changed.rulesDiffer && base.complete && head.complete) {
      const dirs = newDirectories(head, base);
      if (dirs.length > 0) blocks.push("### New directories", list(dirs));
    }
  }
  return `${blocks.join("\n\n")}\n`;
}
