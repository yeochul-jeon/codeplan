// The text forms of a plan: a Markdown summary and a mermaid flowchart.
// Both are made from a plan that has no error finding, so every field has
// its type and every use and step names a part or external that exists.
import { byCodeUnit, type Measurement } from "./measure.js";
import { REFERENCE, type PlanTask } from "./validate.js";

interface Use {
  to: string;
  why?: string;
}
interface Part {
  id: string;
  name: string;
  zone?: string;
  about: string;
  planned?: boolean;
  uses?: Use[];
}
interface Named {
  id: string;
  name: string;
}
interface Plan {
  name: string;
  about: string;
  parts: Part[];
  externals?: (Named & { about: string })[];
  scenarios?: (Named & { steps: { at: string; does: string }[] })[];
}

const oneLine = (text: string) => text.replace(/\r\n|\n|\r/g, " ");
const shown = (item: Named) => (item.name === "" ? item.id : item.name);

// "<n> of <m>" for a task's files; nothing when it makes none.
export const filesCell = (task: { makes: string[]; missing: string[] }) =>
  task.makes.length === 0 ? "" : `${task.makes.length - task.missing.length} of ${task.makes.length}`;

// Text that Markdown must show as written.
export const plain = (text: string) => oneLine(text).replace(/[\\`*_[\]<>|~&#]/g, "\\$&");

// A paragraph's first characters must not start a list or a heading line.
function lineStart(text: string): string {
  if (/^[-+=]/.test(text)) return `\\${text}`;
  return text.replace(/^([0-9]+)([.)])/, "$1\\$2");
}

function nodeLabel(text: string): string {
  return oneLine(text).replace(/["#%&<>`|]/g, (c) => `#${c.charCodeAt(0)};`);
}

// The flowchart's lines, without a line end after the last.
export function mermaidLines(value: unknown): string[] {
  const plan = value as Plan;
  const node = new Map<string, string>();
  plan.parts.forEach((p, i) => node.set(p.id, `p${i}`));
  (plan.externals ?? []).forEach((e, i) => node.set(e.id, `x${i}`));
  const partLine = (p: Part, indent: string) => `${indent}${node.get(p.id)}["${nodeLabel(shown(p))}"]`;
  const zoneOf = (p: Part) => p.zone ?? "";

  const lines = ["flowchart LR"];
  const zones = [...new Set(plan.parts.map(zoneOf).filter((z) => z !== ""))].sort(byCodeUnit);
  zones.forEach((zone, i) => {
    lines.push(`  subgraph z${i}["${nodeLabel(zone)}"]`);
    for (const p of plan.parts) if (zoneOf(p) === zone) lines.push(partLine(p, "    "));
    lines.push("  end");
  });
  for (const p of plan.parts) if (zoneOf(p) === "") lines.push(partLine(p, "  "));
  for (const e of plan.externals ?? []) lines.push(`  ${node.get(e.id)}[("${nodeLabel(shown(e))}")]`);
  for (const p of plan.parts) {
    for (const use of p.uses ?? []) {
      const why = use.why ?? "";
      const arrow = why === "" ? "-->" : `-->|"${nodeLabel(why)}"|`;
      lines.push(`  ${node.get(p.id)} ${arrow} ${node.get(use.to)}`);
    }
  }
  const planned = plan.parts.filter((p) => p.planned === true).map((p) => node.get(p.id)!);
  if (planned.length > 0) {
    lines.push("  classDef planned stroke-dasharray: 5 5", `  class ${planned.join(",")} planned`);
  }
  return lines;
}

export function mermaidText(value: unknown): string {
  return `${mermaidLines(value).join("\n")}\n`;
}

export function summaryText(value: unknown, m: Measurement, tasks: PlanTask[]): string {
  const plan = value as Plan;
  const externals = plan.externals ?? [];
  const scenarios = plan.scenarios ?? [];
  const names = new Map<string, string>();
  for (const item of [...plan.parts, ...externals]) names.set(item.id, shown(item));
  const strong = (id: string) => `**${plain(names.get(id)!)}**`;
  // about, why and does: {id} becomes the target's name; a reference to
  // nothing stays as written.
  const prose = (text: string) => {
    const line = oneLine(text);
    let out = "";
    let from = 0;
    for (const match of line.matchAll(REFERENCE)) {
      if (!names.has(match[1]!)) continue;
      out += plain(line.slice(from, match.index)) + strong(match[1]!);
      from = match.index + match[0].length;
    }
    return out + plain(line.slice(from));
  };
  // An about text as a paragraph block, without spaces and tabs at its
  // ends; nothing when that leaves no text.
  const paragraph = (text: string) => {
    const trimmed = oneLine(text).replace(/^[ \t]+|[ \t]+$/g, "");
    if (trimmed !== "") blocks.push(lineStart(prose(trimmed)));
  };
  const row = (cells: (string | number)[]) => `| ${cells.join(" | ")} |`;

  const blocks: string[] = [`# ${plan.name === "" ? "codeplan" : plain(plan.name)}`];
  paragraph(plan.about);

  blocks.push("## Parts");
  const counts = new Map(m.parts.map((p) => [p.id, p]));
  blocks.push(
    [
      "| Part | Id | Zone | Files | Lines |",
      "|---|---|---|---|---|",
      ...plan.parts.map((p) => {
        const count = counts.get(p.id)!;
        const [files, lines] = p.planned === true ? ["planned", "planned"] : [count.files, count.lines];
        return row([plain(shown(p)), p.id, plain(p.zone ?? ""), files, lines]);
      }),
    ].join("\n"),
  );
  if (m.orphans.length > 0) blocks.push(`${m.orphans.length} watched files belong to no part.`);
  if (m.unwatched.length > 0) blocks.push(`${m.unwatched.length} code files are outside the watch set.`);

  for (const p of plan.parts) {
    blocks.push(`### ${plain(shown(p))}`);
    paragraph(p.about);
    const uses = p.uses ?? [];
    if (uses.length > 0) {
      blocks.push("Uses:");
      blocks.push(
        uses.map((u) => `- ${strong(u.to)}${u.why === undefined || u.why === "" ? "" : `: ${prose(u.why)}`}`).join("\n"),
      );
    }
  }

  if (externals.length > 0) {
    blocks.push("## Externals");
    blocks.push(
      [
        "| External | Id | About |",
        "|---|---|---|",
        ...externals.map((e) => row([plain(shown(e)), e.id, prose(e.about)])),
      ].join("\n"),
    );
  }

  if (scenarios.length > 0) {
    blocks.push("## Scenarios");
    for (const s of scenarios) {
      blocks.push(`### ${plain(shown(s))}`);
      if (s.steps.length > 0) {
        blocks.push(
          s.steps.map((step, k) => `${k + 1}. ${strong(step.at)}${step.does === "" ? "" : `: ${prose(step.does)}`}`).join("\n"),
        );
      }
    }
  }

  if (tasks.length > 0) {
    blocks.push("## Tasks");
    blocks.push(
      [
        "| Task | Id | Status | Files | Parts |",
        "|---|---|---|---|---|",
        ...tasks.map((t) =>
          row([
            plain(shown(t)),
            t.id,
            t.status!,
            filesCell(t),
            t.parts.map((id) => plain(names.get(id)!)).join(", "),
          ]),
        ),
      ].join("\n"),
    );
  }

  blocks.push("## Diagram");
  blocks.push(["```mermaid", ...mermaidLines(plan), "```"].join("\n"));
  return `${blocks.join("\n\n")}\n`;
}
