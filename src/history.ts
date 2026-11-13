// history: the records of a directory, in the order of their names, as one
// HTML file. A record is a file holding what snapshot printed, or a marker
// file for a run where snapshot printed nothing. What changed between two
// records is found by the code that report uses.
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { byCodeUnit } from "./measure.js";
import { EARLY, THEME_BUTTON, THEME_STYLE } from "./page.js";
import {
  LIST_LIMIT,
  RULES,
  SNAPSHOT_FORMAT,
  compare,
  configOf,
  rulesDiffer,
  sameValue,
  shapedSnapshot,
  statusLine,
  taskChanges,
  type Comparison,
  type Snapshot,
} from "./report.js";

export const HISTORY_MARK = "<!doctype html><!-- codeplan history -->";

export type HistoryRecord = { name: string } & ({ snapshot: Snapshot } | { snapshot: null; line: string });
export interface Skipped {
  file: string;
  reason: string;
}

const CONTROL = /[\u0000-\u001f\u007f]/g;
const PAGES = ["ok", "outdated", "missing", "foreign", "not-checked"];
const count = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;

// The text of a snapshot candidate as a snapshot, or why it is skipped.
function candidate(text: string): Snapshot | string {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return "not JSON";
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const { snapshot, rules } = value as Record<string, unknown>;
    if (typeof snapshot === "number" && typeof rules === "number" && (snapshot !== SNAPSHOT_FORMAT || rules !== RULES)) {
      return "another version";
    }
  }
  let shaped: Snapshot;
  try {
    shaped = shapedSnapshot(value);
  } catch {
    return "not a snapshot";
  }
  const ids = shaped.parts.map((p) => p.id);
  const proper =
    PAGES.includes(shaped.page) &&
    new Set(ids).size === ids.length &&
    shaped.parts.every((p) => count(p.files) && count(p.lines)) &&
    shaped.diagnostics.every((d) => typeof d.severity === "string");
  return proper ? shaped : "not a snapshot";
}

// The records in a directory and the files that were skipped. Only plain
// files directly in the directory are looked at. Throws when the directory
// cannot be listed.
export function readRecords(dir: string): { records: HistoryRecord[]; skipped: Skipped[] } {
  const records: HistoryRecord[] = [];
  const skipped: Skipped[] = [];
  const markers: { name: string; file: string; path: Buffer }[] = [];
  const candidates = new Set<string>();
  for (const bytes of readdirSync(dir, { encoding: "buffer" })) {
    const file = bytes.toString("utf8");
    const end = [".json", ".failed"].find((e) => file.endsWith(e) && file.length > e.length);
    if (end === undefined) continue;
    const path = Buffer.concat([Buffer.from(`${dir}/`), bytes]);
    if (!lstatSync(path, { throwIfNoEntry: false })?.isFile()) continue;
    const name = file.slice(0, -end.length);
    if (end === ".json") candidates.add(name);
    if (!Buffer.from(file, "utf8").equals(bytes) || file.search(CONTROL) >= 0) {
      skipped.push({ file: file.replace(CONTROL, "�"), reason: "unsupported name" });
      continue;
    }
    if (end === ".failed") {
      markers.push({ name, file, path });
      continue;
    }
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      skipped.push({ file, reason: "cannot read" });
      continue;
    }
    const read = candidate(text);
    if (typeof read === "string") skipped.push({ file, reason: read });
    else records.push({ name, snapshot: read });
  }
  for (const { name, file, path } of markers) {
    if (candidates.has(name)) {
      skipped.push({ file, reason: "a snapshot has the same name" });
      continue;
    }
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      skipped.push({ file, reason: "cannot read" });
      continue;
    }
    // The first line: its first 200 code points.
    const first = text.split("\n", 1)[0]!.replace(/\r$/, "");
    records.push({ name, snapshot: null, line: [...first].slice(0, 200).join("").replace(CONTROL, "�") });
  }
  records.sort((a, b) => byCodeUnit(a.name, b.name));
  skipped.sort((a, b) => byCodeUnit(a.file, b.file));
  return { records, skipped };
}

// The fields of a snapshot that say whether the plan is out of date.
const planFields = (s: Snapshot) => ({
  plan: s.plan,
  complete: s.complete,
  orphans: s.orphans,
  contested: s.contested.map((c) => ({ path: c.path, parts: c.parts })),
  unwatched: s.unwatched,
  diagnostics: s.diagnostics.map((d) => ({ at: d.at, code: d.code, severity: d.severity, message: d.message, fix: d.fix })),
});
// Every field but owned, with the keys a snapshot has and no others.
const fields = (s: Snapshot) => ({
  ...planFields(s),
  config: configOf(s),
  page: s.page,
  parts: s.parts.map((p) => ({ id: p.id, paths: p.paths, planned: p.planned, files: p.files, lines: p.lines })),
  tasks: s.tasks.map((t) => ({ id: t.id, status: t.status, makes: t.makes, missing: t.missing })),
});

const outOfDate = (s: Snapshot) =>
  s.plan !== "ok" ||
  s.orphans.length > 0 ||
  s.contested.length > 0 ||
  s.unwatched.length > 0 ||
  s.diagnostics.some((d) => d.severity === "warning" || d.severity === "error");

interface Column {
  record: HistoryRecord;
  marks: string[];
  // The records after this one that are the same as it.
  same: string[];
  // The measured record before, and what changed since.
  before: string | null;
  found: Comparison | null;
  // Part id to the text of its cell.
  cells: Map<string, string>;
}

function columnsOf(records: HistoryRecord[]): Column[] {
  const columns: Column[] = [];
  let before: (HistoryRecord & { snapshot: Snapshot }) | null = null;
  // Whether the record just before in name order was measured.
  let follows = false;
  for (const record of records) {
    const s = record.snapshot;
    if (s === null) {
      columns.push({ record, marks: ["not measured"], same: [], before: null, found: null, cells: new Map() });
      follows = false;
      continue;
    }
    const base = before?.snapshot ?? null;
    if (base !== null && follows && sameValue(fields(base), fields(s))) {
      columns[columns.length - 1]!.same.push(record.name);
    } else {
      const found = base === null ? null : compare(s, base);
      const marks: string[] = [];
      if (base === null ? outOfDate(s) : !sameValue(planFields(base), planFields(s))) marks.push("plan");
      if (base === null ? s.page !== "ok" : base.page !== s.page) marks.push("page");
      if (base !== null && rulesDiffer(s, base)) marks.push("config");
      if (base !== null && taskChanges(s, base).length > 0) marks.push("tasks");
      if (found !== null && !found.compared) marks.push("not compared");
      const cells = new Map<string, string>();
      if (found?.compared) {
        for (const p of found.parts) cells.set(p.id, p.by === null ? p.change : `${p.by < 0 ? "" : "+"}${p.by}`);
      }
      columns.push({ record, marks, same: [], before: before?.name ?? null, found, cells });
    }
    before = { name: record.name, snapshot: s };
    follows = true;
  }
  return columns;
}

// The longest runs of measured records that have the same key; a record
// with a null key is in no run.
function runs(items: { name: string; key: string | null }[]): { key: string; span: string }[] {
  const found: { key: string; first: string; last: string }[] = [];
  let open = false;
  for (const { name, key } of items) {
    const last = found[found.length - 1];
    if (key !== null && open && last!.key === key) last!.last = name;
    else if (key !== null) found.push({ key, first: name, last: name });
    open = key !== null;
  }
  return found.map((r) => ({ key: r.key, span: r.first === r.last ? `in ${r.first}` : `from ${r.first} to ${r.last}` }));
}

// The items after a colon: at most LIST_LIMIT of them, then how many more.
function listed(items: string[]): string {
  const shown = items.slice(0, LIST_LIMIT).join(", ");
  return items.length > LIST_LIMIT ? `${shown}, and ${items.length - LIST_LIMIT} more.` : `${shown}.`;
}

const PAGE_WAS: Record<string, string> = {
  outdated: "outdated",
  missing: "missing",
  foreign: "not a codeplan page",
  "not-checked": "not compared",
};

function statusSentences(records: HistoryRecord[], skipped: Skipped[]): string[] {
  const measured = records.flatMap((r) => (r.snapshot === null ? [] : [{ name: r.name, snapshot: r.snapshot }]));
  const plan = runs(measured.map((r) => ({ name: r.name, key: outOfDate(r.snapshot) ? "" : null })));
  const page = runs(measured.map((r) => ({ name: r.name, key: r.snapshot.page === "ok" ? null : r.snapshot.page })));
  const sentences =
    plan.length === 0
      ? ["The plan was not out of date in any record."]
      : plan.map((r) => `The plan was out of date ${r.span}.`);
  if (page.length === 0) sentences.push("The page was up to date in every record.");
  for (const r of page) sentences.push(`The page was ${PAGE_WAS[r.key]} ${r.span}.`);
  const failed = records.filter((r) => r.snapshot === null).map((r) => r.name);
  if (failed.length > 0) sentences.push(`Not measured: ${listed(failed)}`);
  if (skipped.length > 0) sentences.push(`Files not read: ${listed(skipped.map((s) => `${s.file} (${s.reason})`))}`);
  return sentences;
}

// The part ids of the measured records: those of the last one in its
// order, then the others in the order they first come.
function partIds(records: HistoryRecord[]): string[] {
  const measured = records.flatMap((r) => (r.snapshot === null ? [] : [r.snapshot]));
  const ids = new Set(measured[measured.length - 1]!.parts.map((p) => p.id));
  for (const s of measured) for (const p of s.parts) ids.add(p.id);
  return [...ids];
}

// Text from the input is always written as text.
const esc = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const p = (text: string) => `<p>${esc(text)}</p>`;
const tableOf = (head: string[], rows: string[][]) =>
  `<table>\n<tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr>\n` +
  rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>\n`).join("") +
  `</table>`;

// What the page shows for a chosen record.
function recordBlocks(column: Column): string[] {
  const { record, found } = column;
  const blocks = [`<h2>${esc(record.name)}</h2>`];
  if (record.snapshot === null) {
    blocks.push(p(record.line === "" ? "Not measured." : `Not measured: ${record.line}`));
    return blocks;
  }
  blocks.push(p(statusLine(record.snapshot)));
  if (column.same.length > 0) blocks.push(p(`The next ${column.same.length} records are the same: ${listed(column.same)}`));
  if (found === null) {
    blocks.push(p("This is the first record, so there is nothing to compare."));
    return blocks;
  }
  blocks.push(p(`Compared with ${column.before}.`));
  if (!found.compared) {
    blocks.push(
      p(
        found.why === "no-plan"
          ? "No plan in the record before, so there is nothing to compare."
          : `Measurement is incomplete in ${found.why === "base" ? "the record before" : "this record"}, so changes are not shown.`,
      ),
    );
    return blocks;
  }
  blocks.push(
    found.parts.length === 0
      ? p("No part changed.")
      : tableOf(
          ["Part", "Files", "Lines", "Change"],
          found.parts.map((part) => [part.id, part.files, part.lines, part.change]),
        ),
  );
  if (found.rulesDiffer) {
    blocks.push(p("The config or part patterns changed, so some changes come from new rules, not new code."));
  }
  if (found.tasks === "invalid") {
    blocks.push(p("The plan has errors, so task changes are not shown."));
  } else if (found.tasks !== null && found.tasks.length === 0) {
    blocks.push(p("No task changed."));
  } else if (found.tasks !== null) {
    blocks.push(tableOf(["Task", "Status", "Files", "Change"], found.tasks.slice(0, LIST_LIMIT)));
    if (found.tasks.length > LIST_LIMIT) blocks.push(p(`And ${found.tasks.length - LIST_LIMIT} more rows.`));
  }
  return blocks;
}

// A cell with text is told from an empty one by its fill and its line; more and
// fewer lines differ in the sign only. The chosen column has the active
// colour and a heavier weight.
const STYLE = `
${THEME_STYLE}
html, body { margin: 0; background: var(--cp-bg); color: var(--cp-text); font: 13px/1.4 system-ui, sans-serif; }
main { padding: 16px; }
p { margin: 0 0 4px; }
h2 { margin: 0 0 4px; font-size: 15px; font-weight: 600; }
.records { overflow-x: auto; margin: 12px 0; }
table { border-collapse: separate; border-spacing: 0; border-top: 1px solid var(--cp-control-line); }
th, td { border-right: 1px solid var(--cp-control-line); border-bottom: 1px solid var(--cp-control-line); padding: 4px 8px; text-align: left; vertical-align: top; white-space: nowrap; font-weight: 400; }
tr > :first-child { border-left: 1px solid var(--cp-control-line); }
.records tr > :first-child { position: sticky; left: 0; background: var(--cp-bg); }
.records th span { display: block; color: var(--cp-text-dim); }
th[data-same] { color: var(--cp-text-dim); white-space: normal; width: 4.5em; max-width: 4.5em; }
th[data-marks~="config"], td.config { border-left: 4px solid var(--cp-control-line); }
.records td:not(:empty) { background: var(--cp-part-fill); box-shadow: inset 0 0 0 1px var(--cp-part-line); }
.records [data-active] { box-shadow: inset 3px 0 0 var(--cp-active), inset -3px 0 0 var(--cp-active); font-weight: 700; }
.records td[data-active]:not(:empty) { box-shadow: inset 0 0 0 3px var(--cp-active); }
button { background: var(--cp-control-fill); color: var(--cp-control-text); border: 1px solid var(--cp-control-line); border-radius: 4px; font: inherit; padding: 2px 8px; }
section { margin: 12px 0; }
#tools { margin: 12px 0 0; }
`;

// Choosing a record shows its section and marks its column; the same
// button again, or Esc, ends it. Nothing moves on its own.
const SCRIPT = `
(function () {
  function html(name, parent) {
    var el = document.createElement(name);
    parent.appendChild(el);
    return el;
  }
  var heads = document.querySelectorAll("th[data-record]");
  var rows = document.querySelectorAll("tr[data-part]");
  var sections = document.querySelectorAll('section[data-role="record"]');
  var chosen = null;
  function mark(el, on) {
    if (on) el.setAttribute("data-active", "");
    else el.removeAttribute("data-active");
  }
  function choose(index) {
    chosen = index;
    for (var i = 0; i < heads.length; i++) {
      var on = i === index;
      heads[i].children[0].setAttribute("aria-pressed", on ? "true" : "false");
      mark(heads[i], on);
      for (var r = 0; r < rows.length; r++) mark(rows[r].children[heads[i].cellIndex], on);
      if (on) sections[i].removeAttribute("hidden");
      else sections[i].setAttribute("hidden", "");
    }
  }
  function listen(index) {
    heads[index].children[0].addEventListener("click", function () { choose(chosen === index ? null : index); });
  }
  for (var h = 0; h < heads.length; h++) listen(h);
  document.addEventListener("keydown", function (event) {
    if (chosen !== null && event.key === "Escape" && !event.altKey && !event.ctrlKey && !event.metaKey) choose(null);
  });

${THEME_BUTTON}
})();
`;

export function historyHtml(records: HistoryRecord[], skipped: Skipped[]): string {
  const columns = columnsOf(records);
  const ids = partIds(records);
  const inTable = ids.filter((id) => columns.some((c) => c.cells.has(id)));
  const notInTable = ids.filter((id) => !inTable.includes(id));

  const head = columns.map((c) => {
    const marks = c.marks.length === 0 ? "" : ` data-marks="${c.marks.map((m) => m.replace(" ", "-")).join(" ")}"`;
    const words = c.marks.length === 0 ? "" : `<span>${c.marks.join(" ")}</span>`;
    const same = c.same.length === 0 ? "" : `<th data-same="${c.same.length}">${c.same.length} same records</th>`;
    return `<th data-record="${esc(c.record.name)}"${marks}><button type="button" aria-pressed="false">${esc(c.record.name)}</button>${words}</th>${same}`;
  });
  const row = (id: string) =>
    `<tr data-part="${esc(id)}"><th>${esc(id)}</th>` +
    columns
      .map((c) => `<td${c.marks.includes("config") ? ' class="config"' : ""}>${esc(c.cells.get(id) ?? "")}</td>${c.same.length === 0 ? "" : "<td></td>"}`)
      .join("") +
    `</tr>\n`;

  return (
    `${HISTORY_MARK}\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>codeplan history</title>\n<style>${STYLE}</style>\n<script>${EARLY}</script>\n</head>\n<body>\n<main>\n` +
    statusSentences(records, skipped).map((s) => `${p(s)}\n`).join("") +
    `<div class="records">\n<table data-role="records">\n<tr><th>Part</th>${head.join("")}</tr>\n` +
    inTable.map(row).join("") +
    `</table>\n</div>\n` +
    (notInTable.length === 0 ? "" : `${p(`Parts not in the table: ${notInTable.join(", ")}.`)}\n`) +
    columns
      .map((c) => `<section data-role="record" data-record="${esc(c.record.name)}" hidden>\n${recordBlocks(c).join("\n")}\n</section>\n`)
      .join("") +
    `<div id="tools"></div>\n</main>\n<script>${SCRIPT}</script>\n</body>\n</html>\n`
  );
}
