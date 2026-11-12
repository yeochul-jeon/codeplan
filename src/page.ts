// The viewer page: the whole file is made here. The frame (HTML, CSS and
// viewer code) is part of codeplan.mjs, so a new frame makes old pages
// outdated.
import type { Layout } from "./layout.js";

export const PAGE_MARK = "<!doctype html><!-- codeplan page -->";
const BLOCK_OPEN = '<script type="application/json" id="codeplan-data">';

export interface PageData {
  format: 2;
  plan: unknown;
  measure: { parts: { id: string; files: number; lines: number }[]; files: number; lines: number };
  orphans: string[];
  unwatched: number;
  tasks: { id: string; marks: string[]; missing: string[] }[];
  layout: Layout;
}

// JSON for the data block: `<`, `>`, `&`, U+2028 and U+2029 written as
// \u escapes with lowercase hex, so no closing tag can appear inside.
export function blockJson(data: PageData): string {
  return JSON.stringify(data).replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

// The colour themes. Every colour on the page is one of these tokens; the
// values here are written into the CSS only as token definitions.
export const THEMES = {
  light: {
    "--cp-bg": "#fbfaf7",
    "--cp-text": "#1d2433",
    "--cp-text-dim": "#4f5869",
    "--cp-part-fill": "#ffffff",
    "--cp-part-line": "#5d6b82",
    "--cp-ext-fill": "#eef3f8",
    "--cp-ext-line": "#5f6f86",
    "--cp-zone-fill": "#efece4",
    "--cp-zone-line": "#857c66",
    "--cp-zone-title": "#4a4436",
    "--cp-edge": "#5b6170",
    "--cp-connector": "#8a6a1f",
    "--cp-active": "#b5400f",
    "--cp-control-fill": "#ffffff",
    "--cp-control-line": "#6b7486",
    "--cp-control-text": "#1d2433",
  },
  dark: {
    "--cp-bg": "#14171d",
    "--cp-text": "#e7e9ee",
    "--cp-text-dim": "#a9b0bd",
    "--cp-part-fill": "#1e232c",
    "--cp-part-line": "#8d9ab0",
    "--cp-ext-fill": "#1b2530",
    "--cp-ext-line": "#8fa3ba",
    "--cp-zone-fill": "#22211d",
    "--cp-zone-line": "#9a9079",
    "--cp-zone-title": "#d8cfb8",
    "--cp-edge": "#9aa1ae",
    "--cp-connector": "#d0a650",
    "--cp-active": "#f08a4b",
    "--cp-control-fill": "#1e232c",
    "--cp-control-line": "#8d96a6",
    "--cp-control-text": "#e7e9ee",
  },
};

const tokens = (theme: Record<string, string>) =>
  Object.entries(theme)
    .map(([k, v]) => `${k}: ${v};`)
    .join(" ");

// Auto follows prefers-color-scheme; data-theme on <html> picks one.
const STYLE = `
:root { color-scheme: light dark; ${tokens(THEMES.light)} }
@media (prefers-color-scheme: dark) { :root:not([data-theme]) { ${tokens(THEMES.dark)} } }
:root[data-theme="light"] { color-scheme: light; ${tokens(THEMES.light)} }
:root[data-theme="dark"] { color-scheme: dark; ${tokens(THEMES.dark)} }
html, body { margin: 0; background: var(--cp-bg); color: var(--cp-text); font: 13px/1.4 system-ui, sans-serif; }
main { padding: 16px; }
#tools { display: flex; justify-content: flex-end; margin: 0 0 8px; }
#plane { display: block; width: 100%; height: auto; max-height: 80vh; background: transparent; }
.zone { fill: var(--cp-zone-fill); stroke: var(--cp-zone-line); stroke-width: 1; }
.zone-title { fill: var(--cp-zone-title); font-size: 12px; font-weight: 600; }
.part { fill: var(--cp-part-fill); stroke: var(--cp-part-line); stroke-width: 1; }
.part[data-planned] { stroke-dasharray: 6 3; }
.external { fill: var(--cp-ext-fill); stroke: var(--cp-ext-line); stroke-width: 1; stroke-dasharray: 4 2; }
.label { fill: var(--cp-text); font-size: 12px; }
.label .name { font-weight: 600; }
.edge { fill: none; stroke: var(--cp-edge); stroke-width: 1.25; }
.connector { fill: none; stroke: var(--cp-connector); stroke-width: 1.25; stroke-dasharray: 5 4; }
.arrow { fill: var(--cp-edge); stroke: none; }
rect[data-active] { stroke: var(--cp-active); stroke-width: 3; }
polyline[data-active] { stroke: var(--cp-active); stroke-width: 3; }
button, select { background: var(--cp-control-fill); color: var(--cp-control-text); border: 1px solid var(--cp-control-line); border-radius: 4px; font: inherit; padding: 2px 8px; }
button:disabled { opacity: 0.5; }
#tasks { margin: 8px 0 0; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
#tasks:empty { display: none; }
#tasks button { display: flex; align-items: center; gap: 8px; text-align: left; }
#tasks details button { margin: 4px 0 0; }
#tasks button[aria-pressed="true"] { border-color: var(--cp-active); box-shadow: inset 0 0 0 1px var(--cp-active); }
#tasks p { margin: 0; color: var(--cp-text-dim); }
.bar-line { fill: none; stroke: var(--cp-control-line); stroke-width: 1; }
.bar-fill { fill: var(--cp-text-dim); stroke: none; }
#walk { margin: 8px 0 0; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; color: var(--cp-text); }
#walk:empty { display: none; }
#legend { margin: 8px 0 0; color: var(--cp-text-dim); }
#legend p { margin: 0; }
`;

// Applies a stored theme before the body is drawn.
const EARLY = `try { var t = localStorage.getItem("codeplan-theme"); if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t); } catch (e) {}`;

// The viewer: reads the data block and draws the layout as SVG, then the
// task pane when the plan has tasks and the scenario walk-through when it
// has scenarios. Plan text is always
// set with textContent; label and title text is clipped to its box by a
// nested svg element. Nothing moves on its own.
const VIEWER = `
(function () {
  var NS = "http://www.w3.org/2000/svg";
  var data = JSON.parse(document.getElementById("codeplan-data").textContent);
  var plan = data.plan;
  var layout = data.layout;
  var plane = document.getElementById("plane");
  plane.setAttribute("viewBox", "0 0 " + layout.width + " " + layout.height);
  function make(name, attrs, parent) {
    var el = document.createElementNS(NS, name);
    for (var k in attrs) el.setAttribute(k, String(attrs[k]));
    parent.appendChild(el);
    return el;
  }
  function html(name, parent) {
    var el = document.createElement(name);
    parent.appendChild(el);
    return el;
  }
  function textBox(box, lines, cls, parent) {
    var clip = make("svg", { x: box.x, y: box.y, width: box.w, height: box.h, overflow: "hidden" }, parent);
    for (var i = 0; i < lines.length; i++) {
      var t = make("text", { x: 6, y: 16 * (i + 1), "class": i === 0 ? cls + " name" : cls }, clip);
      t.textContent = lines[i];
    }
  }
  function str(v) { return typeof v === "string" ? v : ""; }
  function points(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) out.push(list[i][0] + "," + list[i][1]);
    return out.join(" ");
  }

  var names = Object.create(null);
  var planParts = plan.parts || [];
  var planExternals = plan.externals || [];
  var planned = Object.create(null);
  for (var i = 0; i < planParts.length; i++) {
    names[planParts[i].id] = str(planParts[i].name) || planParts[i].id;
    if (planParts[i].planned === true) planned[planParts[i].id] = true;
  }
  for (var e = 0; e < planExternals.length; e++) names[planExternals[e].id] = str(planExternals[e].name) || planExternals[e].id;
  var measured = Object.create(null);
  for (var j = 0; j < data.measure.parts.length; j++) measured[data.measure.parts[j].id] = data.measure.parts[j];

  var defs = make("defs", {}, plane);
  // The arrowhead is 6 drawing units whatever the line width or highlight,
  // so it stays in the gap of 8 before the rectangle and inside the canvas.
  var marker = make("marker", { id: "arrow", viewBox: "0 0 10 10", refX: 10, refY: 5, markerWidth: 6, markerHeight: 6, markerUnits: "userSpaceOnUse", orient: "auto" }, defs);
  make("path", { d: "M0,0 L10,5 L0,10 z", "class": "arrow" }, marker);

  for (var z = 0; z < layout.zones.length; z++) {
    var zone = layout.zones[z];
    make("rect", { x: zone.x, y: zone.y, width: zone.w, height: zone.h, "class": "zone" }, plane);
    textBox(zone.title, [zone.name], "zone-title", plane);
  }
  var rects = Object.create(null);
  for (var p = 0; p < layout.parts.length; p++) {
    var part = layout.parts[p];
    var m = measured[part.id] || { lines: 0, files: 0 };
    rects[part.id] = make("rect", { x: part.x, y: part.y, width: part.w, height: part.h, "class": "part", "data-id": part.id }, plane);
    if (planned[part.id]) rects[part.id].setAttribute("data-planned", "true");
    textBox(part.label, [names[part.id] || part.id, m.lines + " lines", planned[part.id] ? "planned" : m.files + " files"], "label", plane);
  }
  for (var x = 0; x < layout.externals.length; x++) {
    var ext = layout.externals[x];
    rects[ext.id] = make("rect", { x: ext.x, y: ext.y, width: ext.w, height: ext.h, "class": "external", "data-id": ext.id }, plane);
    textBox(ext.label, [names[ext.id] || ext.id, "external"], "label", plane);
  }
  var edges = [];
  for (var d = 0; d < layout.edges.length; d++) {
    var edge = layout.edges[d];
    edges.push({ from: edge.from, to: edge.to, el: make("polyline", { points: points(edge.points), "class": "edge", "marker-end": "url(#arrow)", "data-from": edge.from, "data-to": edge.to }, plane) });
  }
  var connectors = [];
  for (var c = 0; c < layout.connectors.length; c++) {
    var con = layout.connectors[c];
    connectors.push({ scenario: con.scenario, step: con.step, el: make("polyline", { points: points(con.points), "class": "connector", "data-scenario": con.scenario, "data-step": con.step }, plane) });
  }

  var legend = document.getElementById("legend");
  function line(text) { html("p", legend).textContent = text; }
  var title = str(plan.name);
  line(data.measure.files + " files, " + data.measure.lines + " lines" + (title ? " \\u00b7 " + title : ""));
  if (data.orphans.length > 0) line(data.orphans.length + " orphan files: no part owns them");
  if (data.unwatched > 0) line(data.unwatched + " unwatched files: code outside the watch set");
  if (title) document.title = title;

  // The theme button: auto, then light, then dark, then auto again.
  var root = document.documentElement;
  var themeButton = html("button", document.getElementById("tools"));
  themeButton.type = "button";
  themeButton.setAttribute("data-role", "theme");
  themeButton.title = "Colour theme: auto follows the system setting";
  function themeNow() {
    var t = root.getAttribute("data-theme");
    return t === "light" || t === "dark" ? t : "auto";
  }
  themeButton.textContent = themeNow();
  themeButton.addEventListener("click", function () {
    var next = { auto: "light", light: "dark", dark: "auto" }[themeNow()];
    if (next === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", next);
    themeButton.textContent = next;
    try {
      if (next === "auto") localStorage.removeItem("codeplan-theme");
      else localStorage.setItem("codeplan-theme", next);
    } catch (e) {}
  });

  var scenarios = plan.scenarios || [];
  var tasks = data.tasks || [];
  function setHash(text) {
    history.replaceState(null, "", text ? "#" + text : location.pathname + location.search);
  }
  function clearActive() {
    for (var id in rects) rects[id].removeAttribute("data-active");
    for (var i = 0; i < edges.length; i++) edges[i].el.removeAttribute("data-active");
    for (var k = 0; k < connectors.length; k++) connectors[k].el.removeAttribute("data-active");
  }

  // The task pane: one button for each task, the done tasks in a closed
  // details element after the others. Choosing a task marks its parts; a scenario
  // walk-through and a chosen task end each other.
  var pane = document.getElementById("tasks");
  var written = Object.create(null);
  var planTasks = plan.tasks || [];
  for (var w = 0; w < planTasks.length; w++) written[planTasks[w].id] = planTasks[w];
  var taskRows = Object.create(null);
  var chosen = null;
  var current = null;
  function addTask(task, parent, fold) {
    var from = written[task.id];
    var button = html("button", parent);
    button.type = "button";
    button.setAttribute("data-task", task.id);
    html("span", button).textContent = str(from.name) || task.id;
    html("span", button).textContent = from.status;
    var makes = from.makes || [];
    var counted = Object.create(null);
    var m = 0;
    for (var i = 0; i < makes.length; i++) {
      if (!counted[makes[i]]) m++;
      counted[makes[i]] = true;
    }
    if (m > 0) {
      var n = m - task.missing.length;
      html("span", button).textContent = n + " of " + m + " files";
      var bar = make("svg", { width: 66, height: 10, viewBox: "0 0 66 10", "class": "bar", "aria-hidden": "true" }, button);
      make("rect", { x: 0.5, y: 0.5, width: 65, height: 9, "class": "bar-line" }, bar);
      make("rect", { x: 1, y: 1, width: Math.round(64 * n / m), height: 8, "class": "bar-fill" }, bar);
    }
    taskRows[task.id] = { button: button, fold: fold, marks: task.marks, missing: null };
    button.addEventListener("click", function () {
      if (chosen === task.id) endTask();
      else chooseTask(task.id);
    });
  }
  if (tasks.length > 0) {
    var doneCount = 0;
    for (var a = 0; a < tasks.length; a++) {
      if (written[tasks[a].id].status === "done") doneCount++;
      else addTask(tasks[a], pane, null);
    }
    if (doneCount > 0) {
      var doneFold = html("details", pane);
      html("summary", doneFold).textContent = "Done (" + doneCount + ")";
      for (var b = 0; b < tasks.length; b++) {
        if (written[tasks[b].id].status === "done") addTask(tasks[b], doneFold, doneFold);
      }
    }
    for (var g = 0; g < tasks.length; g++) {
      if (tasks[g].missing.length === 0) continue;
      var box = html("div", pane);
      box.setAttribute("hidden", "");
      html("p", box).textContent = "Files this task makes that are not in the repository:";
      for (var h = 0; h < tasks[g].missing.length; h++) html("p", box).textContent = tasks[g].missing[h];
      taskRows[tasks[g].id].missing = box;
    }
  }
  // keep: the fragment is left as it is.
  function endTask(keep) {
    if (chosen === null) return;
    var row = taskRows[chosen];
    row.button.removeAttribute("aria-pressed");
    if (row.missing) row.missing.setAttribute("hidden", "");
    chosen = null;
    clearActive();
    if (!keep) setHash("");
  }
  function chooseTask(id, keep) {
    if (current !== null) close(true);
    endTask(true);
    var row = taskRows[id];
    chosen = id;
    row.button.setAttribute("aria-pressed", "true");
    if (row.fold) row.fold.setAttribute("open", "");
    for (var i = 0; i < row.marks.length; i++) {
      if (rects[row.marks[i]]) rects[row.marks[i]].setAttribute("data-active", "");
    }
    if (row.missing) row.missing.removeAttribute("hidden");
    if (!keep) setHash("task=" + id);
  }

  var select, prev, next, stepText;
  if (scenarios.length > 0) {
    var walk = document.getElementById("walk");
    select = html("select", walk);
    select.setAttribute("aria-label", "Scenario");
    var none = html("option", select);
    none.value = "";
    none.textContent = "(none)";
    for (var s = 0; s < scenarios.length; s++) {
      var option = html("option", select);
      option.value = String(s);
      option.textContent = str(scenarios[s].name) || scenarios[s].id;
    }
    prev = html("button", walk);
    prev.type = "button";
    prev.textContent = "Previous";
    prev.title = "Previous step (Left arrow key)";
    next = html("button", walk);
    next.type = "button";
    next.textContent = "Next";
    next.title = "Next step (Right arrow key). Esc ends the walk-through.";
    stepText = html("span", walk);
    stepText.setAttribute("data-role", "step");
    prev.disabled = true;
    next.disabled = true;
    select.addEventListener("change", function () {
      if (select.value === "") close();
      else open(Number(select.value), 0);
    });
    prev.addEventListener("click", function () { move(-1); });
    next.addEventListener("click", function () { move(1); });
  }

  var REF = /\\{([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\\}/g;
  function fill(text) {
    return str(text).replace(REF, function (whole, id) { return id in names ? names[id] : whole; });
  }
  // keep: opened from the fragment, which is then left as it is.
  function show(keep) {
    clearActive();
    var scenario = scenarios[current.index];
    var steps = scenario.steps || [];
    if (steps.length === 0) {
      stepText.textContent = "This scenario has no steps";
      prev.disabled = true;
      next.disabled = true;
      if (!keep) setHash("scenario=" + scenario.id);
      return;
    }
    var k = current.step;
    var at = steps[k].at;
    if (rects[at]) rects[at].setAttribute("data-active", "");
    if (k > 0 && steps[k - 1].at !== at) {
      var before = steps[k - 1].at;
      var lit = false;
      for (var i = 0; i < edges.length; i++) {
        if ((edges[i].from === before && edges[i].to === at) || (edges[i].from === at && edges[i].to === before)) {
          edges[i].el.setAttribute("data-active", "");
          lit = true;
        }
      }
      if (!lit) {
        for (var c = 0; c < connectors.length; c++) {
          if (connectors[c].scenario === scenario.id && connectors[c].step === k) connectors[c].el.setAttribute("data-active", "");
        }
      }
    }
    stepText.textContent = (k + 1) + "/" + steps.length + " " + (names[at] || at) + ": " + fill(steps[k].does);
    prev.disabled = k === 0;
    next.disabled = k === steps.length - 1;
    if (!keep) setHash("scenario=" + scenario.id + "&step=" + (k + 1));
  }
  function open(index, step, fromHash) {
    endTask(true);
    current = { index: index, step: step };
    select.value = String(index);
    show(fromHash);
    if (!next.disabled) next.focus();
  }
  // keep: the fragment is left as it is.
  function close(keep) {
    current = null;
    clearActive();
    select.value = "";
    stepText.textContent = "";
    prev.disabled = true;
    next.disabled = true;
    if (!keep) setHash("");
  }
  function move(by) {
    if (current === null) return;
    var steps = scenarios[current.index].steps || [];
    var k = current.step + by;
    if (k < 0 || k >= steps.length) return;
    current.step = k;
    show();
  }
  document.addEventListener("keydown", function (event) {
    if (current === null) {
      if (chosen !== null && event.key === "Escape" && !event.altKey && !event.ctrlKey && !event.metaKey) endTask();
      return;
    }
    if (document.activeElement === select) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowLeft") { event.preventDefault(); move(-1); }
    else if (event.key === "ArrowRight") { event.preventDefault(); move(1); }
    else if (event.key === "Escape") close();
  });

  // Opens what the fragment names: on load, and when the fragment changes
  // later (replaceState above does not fire hashchange). A scenario key is
  // read first and the task key is then not looked at. An unknown id is
  // ignored; no fragment at all ends the walk-through and the chosen task.
  function fromHash(onLoad) {
    var text = location.hash.replace(/^#/, "");
    if (text === "") {
      if (!onLoad) {
        if (current !== null) close();
        endTask();
      }
      return;
    }
    var wanted = Object.create(null);
    var pieces = text.split("&");
    for (var q = 0; q < pieces.length; q++) {
      var eq = pieces[q].indexOf("=");
      if (eq > 0) {
        try { wanted[decodeURIComponent(pieces[q].slice(0, eq))] = decodeURIComponent(pieces[q].slice(eq + 1)); } catch (err) {}
      }
    }
    if ("scenario" in wanted) {
      for (var w = 0; w < scenarios.length; w++) {
        if (scenarios[w].id !== wanted.scenario) continue;
        var n = (scenarios[w].steps || []).length;
        var k = /^[0-9]+$/.test(wanted.step || "") ? parseInt(wanted.step, 10) : 0;
        open(w, k >= 1 && k <= n ? k - 1 : 0, true);
        return;
      }
      return;
    }
    if ("task" in wanted && taskRows[wanted.task]) chooseTask(wanted.task, true);
  }
  window.addEventListener("hashchange", function () { fromHash(false); });
  fromHash(true);
})();
`;

export const FRAME = {
  head:
    `${PAGE_MARK}\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>codeplan</title>\n<style>${STYLE}</style>\n<script>${EARLY}</script>\n</head>\n<body>\n<main>\n` +
    `<div id="tools"></div>\n` +
    `<svg id="plane" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="parts of the repository"></svg>\n` +
    `<div id="tasks"></div>\n<div id="walk"></div>\n<div id="legend"></div>\n</main>\n`,
  tail: `\n<script>${VIEWER}</script>\n</body>\n</html>\n`,
};

export function pageHtml(data: PageData, frame: { head: string; tail: string } = FRAME): string {
  return frame.head + BLOCK_OPEN + blockJson(data) + "</script>" + frame.tail;
}
