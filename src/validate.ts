// Checking plan.json. Diagnostics come out in document order: the field
// order of the plan format (not the key order in the file), array index
// order, `note` after the known fields, unknown keys last by name.
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { isPathForm } from "./config.js";
import { byCodeUnit } from "./measure.js";
import type { PlanPart } from "./plan.js";

export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  code: string;
  severity: Severity;
  at: string;
  message: string;
}

export const SEVERITY: Record<string, Severity> = {
  "bad-shape": "error",
  "repeated-id": "error",
  "no-paths": "error",
  "unknown-target": "error",
  "empty-part": "warning",
  "planned-has-files": "warning",
  "start-missing": "warning",
  "start-elsewhere": "warning",
  "self-use": "warning",
  "repeated-use": "warning",
  "unused-external": "warning",
  "short-scenario": "warning",
  "gap-in-scenario": "warning",
  "unknown-reference": "warning",
  "no-plan": "warning",
  "task-done-missing": "info",
  "task-todo-has-files": "info",
  "task-path-unowned": "info",
};

export function diagnostic(code: string, at: string, message: string): Diagnostic {
  return { code, severity: SEVERITY[code]!, at, message };
}

const ID_FORM = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
export const REFERENCE = /\{([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\}/g;

export const KNOWN = {
  plan: ["format", "name", "about", "parts", "externals", "scenarios", "tasks", "note"],
  part: ["id", "name", "zone", "about", "start", "paths", "planned", "uses", "note"],
  use: ["to", "why", "evidence", "note"],
  external: ["id", "name", "about", "note"],
  scenario: ["id", "name", "steps", "note"],
  step: ["at", "does", "note"],
  task: ["id", "name", "status", "parts", "makes", "note"],
};

export const STATUSES = ["todo", "doing", "done"] as const;
export type Status = (typeof STATUSES)[number];
const isStatus = (v: unknown): v is Status => STATUSES.includes(v as Status);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const validId = (v: unknown): v is string => typeof v === "string" && ID_FORM.test(v);
const arrayOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// What the walk needs to know about the whole plan before it starts, and
// the parts that measurement can use.
export interface PreparedPlan {
  raw: unknown;
  parts: PlanPart[];
  // Parts left out of measurement (broken or missing paths, no proper id,
  // a repeated id, not an object).
  excluded: number;
  repeatedItems: Set<Obj>;
  targets: Set<string>;
  // The parts a task can name: a proper id that is not a repeated one.
  partIds: Set<string>;
  usesOf: Map<string, Set<string>>;
  skipInGaps: Set<string>;
  used: Set<string>;
  brokenRelation: boolean;
}

function goodPaths(paths: unknown): paths is string[] {
  return (
    Array.isArray(paths) &&
    paths.length > 0 &&
    paths.every((p) => typeof p === "string" && p !== "")
  );
}

export function preparePlan(raw: unknown): PreparedPlan {
  const prepared: PreparedPlan = {
    raw,
    parts: [],
    excluded: 0,
    repeatedItems: new Set(),
    targets: new Set(),
    partIds: new Set(),
    usesOf: new Map(),
    skipInGaps: new Set(),
    used: new Set(),
    brokenRelation: false,
  };
  if (!isObj(raw)) return prepared;
  const parts = arrayOf(raw.parts);
  const externals = arrayOf(raw.externals);
  const scenarios = arrayOf(raw.scenarios);

  const seen = new Set<string>();
  for (const item of [...parts, ...externals, ...scenarios, ...arrayOf(raw.tasks)]) {
    if (!isObj(item) || !validId(item.id)) continue;
    if (seen.has(item.id)) prepared.repeatedItems.add(item);
    else seen.add(item.id);
  }
  const kept = (item: unknown): item is Obj & { id: string } =>
    isObj(item) && validId(item.id) && !prepared.repeatedItems.has(item);
  for (const item of [...parts, ...externals]) if (kept(item)) prepared.targets.add(item.id);
  for (const part of parts) if (kept(part)) prepared.partIds.add(part.id);

  for (const part of parts) {
    if (kept(part) && goodPaths(part.paths)) prepared.parts.push({ id: part.id, paths: part.paths, planned: part.planned === true });
    else prepared.excluded++;
    if (!isObj(part)) continue;
    if (prepared.repeatedItems.has(part)) prepared.skipInGaps.add(part.id as string);
    if (part.uses === undefined) continue;
    if (!Array.isArray(part.uses)) {
      prepared.brokenRelation = true;
      if (validId(part.id)) prepared.skipInGaps.add(part.id);
      continue;
    }
    for (const use of part.uses) {
      if (!isObj(use) || !validId(use.to) || !prepared.targets.has(use.to)) {
        prepared.brokenRelation = true;
        continue;
      }
      prepared.used.add(use.to);
      if (kept(part)) {
        const set = prepared.usesOf.get(part.id) ?? new Set<string>();
        set.add(use.to);
        prepared.usesOf.set(part.id, set);
      }
    }
  }
  for (const scenario of scenarios) {
    if (!isObj(scenario)) continue;
    if (!Array.isArray(scenario.steps)) {
      prepared.brokenRelation = true;
      continue;
    }
    for (const step of scenario.steps) {
      if (!isObj(step) || !validId(step.at) || !prepared.targets.has(step.at)) {
        prepared.brokenRelation = true;
        continue;
      }
      prepared.used.add(step.at);
    }
  }
  return prepared;
}

// The paths of a task's `makes` that have the path form, each once, in code
// unit order. Null when `makes` is there and is not an array.
function taskPaths(task: Obj): string[] | null {
  if (!("makes" in task)) return [];
  if (!Array.isArray(task.makes)) return null;
  return [...new Set(task.makes.filter((p): p is string => typeof p === "string" && isPathForm(p)))].sort(byCodeUnit);
}

// A task as the page, the summary and the snapshot list it.
export interface PlanTask {
  id: string;
  name: string;
  // Null when the plan file's status is not one of the three.
  status: Status | null;
  // The parts its `parts` names, in the written order, each once.
  parts: string[];
  makes: string[];
  // The paths of `makes` that are not a file in the repository.
  missing: string[];
}

// The tasks with a proper id that is not a repeated one, in plan order.
export function planTasks(prepared: PreparedPlan, isFile: (path: string) => boolean): PlanTask[] {
  if (!isObj(prepared.raw)) return [];
  const out: PlanTask[] = [];
  for (const task of arrayOf(prepared.raw.tasks)) {
    if (!isObj(task) || !validId(task.id) || prepared.repeatedItems.has(task)) continue;
    const makes = taskPaths(task) ?? [];
    out.push({
      id: task.id,
      name: typeof task.name === "string" ? task.name : "",
      status: isStatus(task.status) ? task.status : null,
      parts: [...new Set(arrayOf(task.parts).filter((p): p is string => validId(p) && prepared.partIds.has(p)))],
      makes,
      missing: makes.filter((p) => !isFile(p)),
    });
  }
  return out;
}

export interface MeasuredFacts {
  repo: string;
  // Whether a path is a file in the repository (see isPlainFile).
  isFile: (path: string) => boolean;
  // Whether a file made at a path would be watched and in no part.
  unowned: (path: string) => boolean;
  // Measured file count of each measured part.
  files: Map<string, number>;
  // Every watched file and the part it is measured in (null: an orphan).
  owners: Map<string, string | null>;
}

export function diagnosePlan(prepared: PreparedPlan, facts: MeasuredFacts): Diagnostic[] {
  const out: Diagnostic[] = [];
  const emit = (code: string, at: string, message: string) => out.push(diagnostic(code, at, message));
  const raw = prepared.raw;
  if (!isObj(raw)) {
    emit("bad-shape", "plan", "the plan must be a JSON object");
    return out;
  }
  const measured = new Set(prepared.parts.map((p) => p.id));

  // Field helpers. `who` names the enclosing item in messages.
  const missing = (at: string, who: string, key: string) =>
    emit("bad-shape", at, `${who}\`${key}\` is required`);
  const string = (obj: Obj, key: string, at: string, who: string, required: boolean): boolean => {
    if (!(key in obj)) {
      if (required) missing(at, who, key);
      return false;
    }
    if (typeof obj[key] !== "string") {
      emit("bad-shape", at, `${who}\`${key}\` must be a string`);
      return false;
    }
    return true;
  };
  const text = (obj: Obj, key: string, at: string, who: string, required: boolean, refs: boolean) => {
    if (!string(obj, key, at, who, required) || !refs) return;
    const named = new Set<string>();
    for (const match of (obj[key] as string).matchAll(REFERENCE)) {
      const id = match[1]!;
      if (prepared.targets.has(id) || named.has(id)) continue;
      named.add(id);
      emit("unknown-reference", at, `${who}{${id}} names no part or external`);
    }
  };
  const rest = (obj: Obj, at: string, who: string, known: string[]) => {
    const place = (key: string) => (at === "" ? key : `${at}.${key}`);
    if ("note" in obj && typeof obj.note !== "string") {
      emit("bad-shape", place("note"), `${who}\`note\` must be a string`);
    }
    for (const key of Object.keys(obj).filter((k) => !known.includes(k)).sort(byCodeUnit)) {
      emit("bad-shape", place(key), `${who}unknown key \`${key}\``);
    }
  };
  const id = (obj: Obj, at: string, kind: string, repeated: boolean): string => {
    if (!("id" in obj)) missing(`${at}.id`, "", "id");
    else if (!validId(obj.id)) {
      emit("bad-shape", `${at}.id`, `${kind} id must be lowercase letters, digits and inner hyphens`);
    } else if (repeated) {
      emit("repeated-id", `${at}.id`, `${kind} "${obj.id}": the id is used by an earlier item`);
    }
    return validId(obj.id) ? `${kind} "${obj.id}": ` : "";
  };

  // ---- top level ----
  if (raw.format !== 1) emit("bad-shape", "format", "`format` must be 1");
  string(raw, "name", "name", "", true);
  text(raw, "about", "about", "", true, true);
  if (!("parts" in raw)) missing("parts", "", "parts");
  else if (!Array.isArray(raw.parts)) emit("bad-shape", "parts", "`parts` must be an array");
  else raw.parts.forEach((part, i) => checkPart(part, `parts[${i}]`));
  if ("externals" in raw && !Array.isArray(raw.externals)) {
    emit("bad-shape", "externals", "`externals` must be an array");
  } else {
    arrayOf(raw.externals).forEach((external, i) => checkExternal(external, `externals[${i}]`));
  }
  if ("scenarios" in raw && !Array.isArray(raw.scenarios)) {
    emit("bad-shape", "scenarios", "`scenarios` must be an array");
  } else {
    arrayOf(raw.scenarios).forEach((scenario, i) => checkScenario(scenario, `scenarios[${i}]`));
  }
  if ("tasks" in raw && !Array.isArray(raw.tasks)) {
    emit("bad-shape", "tasks", "`tasks` must be an array");
  } else {
    arrayOf(raw.tasks).forEach((task, i) => checkTask(task, `tasks[${i}]`));
  }
  rest(raw, "", "", KNOWN.plan);

  function checkTask(task: unknown, at: string): void {
    if (!isObj(task)) {
      emit("bad-shape", at, "a task must be an object");
      return;
    }
    const repeated = prepared.repeatedItems.has(task);
    const who = id(task, at, "task", repeated);
    string(task, "name", `${at}.name`, who, true);
    const paths = taskPaths(task);
    const there = (paths ?? []).filter((p) => facts.isFile(p)).length;

    if (!("status" in task)) missing(`${at}.status`, who, "status");
    else if (!isStatus(task.status)) {
      emit("bad-shape", `${at}.status`, `${who}\`status\` must be todo, doing or done`);
    } else if (!repeated && paths !== null) {
      if (task.status === "done" && there < paths.length) {
        emit(
          "task-done-missing",
          `${at}.status`,
          `${who}the status is done and ${there} of ${paths.length} files in \`makes\` are in the repository`,
        );
      }
      if (task.status === "todo" && there >= 1) {
        emit(
          "task-todo-has-files",
          `${at}.status`,
          `${who}the status is todo and ${there} of ${paths.length} files in \`makes\` are already in the repository`,
        );
      }
    }

    if ("parts" in task) {
      if (!Array.isArray(task.parts)) {
        emit("bad-shape", `${at}.parts`, `${who}\`parts\` must be an array of part ids`);
      } else {
        const seenPart = new Set<string>();
        task.parts.forEach((part, j) => {
          if (!validId(part)) emit("bad-shape", `${at}.parts[${j}]`, `${who}a part of a task must be an id`);
          else if (!repeated && !seenPart.has(part)) {
            seenPart.add(part);
            if (!prepared.partIds.has(part)) emit("unknown-target", `${at}.parts[${j}]`, `${who}"${part}" is not a part`);
          }
        });
      }
    }

    if (paths === null) {
      emit("bad-shape", `${at}.makes`, `${who}\`makes\` must be an array of paths`);
    } else {
      const seenPath = new Set<string>();
      arrayOf(task.makes).forEach((path, j) => {
        if (typeof path !== "string" || !isPathForm(path)) {
          emit("bad-shape", `${at}.makes[${j}]`, `${who}a path in \`makes\` must be a path inside the repository`);
          return;
        }
        if (seenPath.has(path)) return;
        seenPath.add(path);
        // Without every part measured, a path cannot be said to be in no part.
        if (!repeated && prepared.excluded === 0 && !facts.isFile(path) && facts.unowned(path)) {
          emit("task-path-unowned", `${at}.makes[${j}]`, `${who}${path} would be a watched file that no part owns`);
        }
      });
    }
    rest(task, at, who, KNOWN.task);
  }

  function checkPart(part: unknown, at: string): void {
    if (!isObj(part)) {
      emit("bad-shape", at, "a part must be an object");
      return;
    }
    const repeated = prepared.repeatedItems.has(part);
    const who = id(part, at, "part", repeated);
    const partId = validId(part.id) ? part.id : null;
    const isMeasured = partId !== null && !repeated && measured.has(partId);
    // A planned part has no code yet. Any value but true leaves it a part
    // like the others.
    const planned = part.planned === true;
    string(part, "name", `${at}.name`, who, true);
    string(part, "zone", `${at}.zone`, who, false);
    text(part, "about", `${at}.about`, who, true, !repeated);

    if ("start" in part) {
      const start = part.start;
      // One way to write a file (see isPathForm): no leading or trailing "/",
      // no "//", ".", ".." or backslash.
      if (typeof start !== "string" || !isPathForm(start)) {
        emit("bad-shape", `${at}.start`, `${who}\`start\` must be a path inside the repository`);
      } else if (!repeated) {
        let isFile = false;
        try {
          isFile = lstatSync(join(facts.repo, start), { throwIfNoEntry: false })?.isFile() ?? false;
        } catch {
          isFile = false;
        }
        if (!isFile) {
          if (!planned) emit("start-missing", `${at}.start`, `${who}${start} is not a file in the repository`);
        } else if (isMeasured && facts.owners.has(start) && facts.owners.get(start) !== partId) {
          emit("start-elsewhere", `${at}.start`, `${who}${start} is not measured in this part`);
        }
      }
    }

    const paths = part.paths;
    if (Array.isArray(paths) && paths.length > 0) {
      paths.forEach((p, j) => {
        if (typeof p !== "string" || p === "") {
          emit("bad-shape", `${at}.paths[${j}]`, `${who}a pattern must be a non-empty string`);
        }
      });
      if (isMeasured && !planned && facts.files.get(partId) === 0) {
        emit("empty-part", `${at}.paths`, `${who}its paths match no watched file`);
      }
    } else if (paths !== undefined && !Array.isArray(paths)) {
      emit("bad-shape", `${at}.paths`, `${who}\`paths\` must be an array of patterns`);
    } else if (!repeated) {
      emit("no-paths", `${at}.paths`, `${who}a part needs at least one pattern in \`paths\``);
    }

    if ("planned" in part && typeof part.planned !== "boolean") {
      emit("bad-shape", `${at}.planned`, `${who}\`planned\` must be true or false`);
    } else if (planned && isMeasured && facts.files.get(partId)! > 0) {
      emit(
        "planned-has-files",
        `${at}.planned`,
        `${who}the part is planned, but ${facts.files.get(partId)} watched files are measured in it`,
      );
    }

    if ("uses" in part) {
      if (!Array.isArray(part.uses)) {
        emit("bad-shape", `${at}.uses`, `${who}\`uses\` must be an array`);
      } else {
        const seenTo = new Set<string>();
        part.uses.forEach((use, k) => {
          const uat = `${at}.uses[${k}]`;
          if (!isObj(use)) {
            emit("bad-shape", uat, `${who}a use must be an object`);
            return;
          }
          if (!("to" in use)) missing(`${uat}.to`, who, "to");
          else if (!validId(use.to)) {
            emit("bad-shape", `${uat}.to`, `${who}\`to\` must be an id`);
          } else if (!repeated) {
            const to = use.to;
            if (to === partId) emit("self-use", `${uat}.to`, `${who}the part uses itself`);
            if (seenTo.has(to)) emit("repeated-use", `${uat}.to`, `${who}uses "${to}" more than once`);
            seenTo.add(to);
            if (!prepared.targets.has(to)) {
              emit("unknown-target", `${uat}.to`, `${who}"${to}" is not a part or external`);
            }
          }
          text(use, "why", `${uat}.why`, who, false, !repeated);
          if ("evidence" in use) {
            if (!Array.isArray(use.evidence)) {
              emit("bad-shape", `${uat}.evidence`, `${who}\`evidence\` must be an array of strings`);
            } else {
              use.evidence.forEach((e, j) => {
                if (typeof e !== "string") {
                  emit("bad-shape", `${uat}.evidence[${j}]`, `${who}evidence must be a string`);
                }
              });
            }
          }
          rest(use, uat, who, KNOWN.use);
        });
      }
    }
    rest(part, at, who, KNOWN.part);
  }

  function checkExternal(external: unknown, at: string): void {
    if (!isObj(external)) {
      emit("bad-shape", at, "an external must be an object");
      return;
    }
    const repeated = prepared.repeatedItems.has(external);
    if (
      validId(external.id) &&
      !repeated &&
      prepared.repeatedItems.size === 0 &&
      !prepared.brokenRelation &&
      !prepared.used.has(external.id)
    ) {
      emit("unused-external", at, `external "${external.id}": no use or step names it`);
    }
    const who = id(external, at, "external", repeated);
    string(external, "name", `${at}.name`, who, true);
    text(external, "about", `${at}.about`, who, true, !repeated);
    rest(external, at, who, KNOWN.external);
  }

  function checkScenario(scenario: unknown, at: string): void {
    if (!isObj(scenario)) {
      emit("bad-shape", at, "a scenario must be an object");
      return;
    }
    const repeated = prepared.repeatedItems.has(scenario);
    const who = id(scenario, at, "scenario", repeated);
    string(scenario, "name", `${at}.name`, who, true);
    if (!("steps" in scenario)) missing(`${at}.steps`, who, "steps");
    else if (!Array.isArray(scenario.steps)) {
      emit("bad-shape", `${at}.steps`, `${who}\`steps\` must be an array`);
    } else {
      const steps = scenario.steps;
      if (!repeated && steps.length < 2) {
        emit("short-scenario", `${at}.steps`, `${who}a scenario needs two steps or more`);
      }
      const known = (step: unknown): string | null =>
        isObj(step) && validId(step.at) && prepared.targets.has(step.at) && !prepared.skipInGaps.has(step.at)
          ? step.at
          : null;
      const linked = (a: string, b: string) =>
        (prepared.usesOf.get(a)?.has(b) ?? false) || (prepared.usesOf.get(b)?.has(a) ?? false);
      steps.forEach((step, k) => {
        const sat = `${at}.steps[${k}]`;
        if (!isObj(step)) {
          emit("bad-shape", sat, `${who}a step must be an object`);
          return;
        }
        if (!("at" in step)) missing(`${sat}.at`, who, "at");
        else if (!validId(step.at)) emit("bad-shape", `${sat}.at`, `${who}\`at\` must be an id`);
        else if (!repeated) {
          if (!prepared.targets.has(step.at)) {
            emit("unknown-target", `${sat}.at`, `${who}"${step.at}" is not a part or external`);
          }
          if (k > 0) {
            const a = known(steps[k - 1]);
            const b = known(step);
            if (a !== null && b !== null && a !== b && !linked(a, b)) {
              emit("gap-in-scenario", `${sat}.at`, `${who}no use links "${a}" and "${b}" in either direction`);
            }
          }
        }
        text(step, "does", `${sat}.does`, who, true, !repeated);
        rest(step, sat, who, KNOWN.step);
      });
    }
    rest(scenario, at, who, KNOWN.scenario);
  }

  // Same place: code order. Places keep the order of their first diagnostic.
  const first = new Map<string, number>();
  out.forEach((d, i) => {
    if (!first.has(d.at)) first.set(d.at, i);
  });
  return out
    .map((d, i) => ({ d, i }))
    .sort((x, y) => first.get(x.d.at)! - first.get(y.d.at)! || byCodeUnit(x.d.code, y.d.code) || x.i - y.i)
    .map((x) => x.d);
}
