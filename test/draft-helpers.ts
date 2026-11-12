import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect } from "vitest";
import { check, run } from "../src/cli.js";
import type { Draft, Note } from "../src/draft.js";
import { tempDir } from "./helpers.js";

// A tree written one file per line: "<path> <content>", where content is
// a line count, `M <namespace>` (a three-line mapper XML), `XML` (one line
// that is not a mapper), `SQLMAP` (two lines) or `DIR` (an empty directory,
// path ending with "/"), or `LINK <target>` (a relative symbolic link to a
// directory in the repository). `M "<value>"` writes the namespace as given,
// empty or blank.
export type Entry = string | null | { link: string };

export function tree(text: string): Record<string, Entry> {
  const files: Record<string, Entry> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const [, path, rest] = /^(\S+)\s+(.*)$/.exec(trimmed) as unknown as [string, string, string];
    const [kind, arg] = rest.startsWith('M "')
      ? ["M", rest.slice(3, rest.lastIndexOf('"'))]
      : (rest.split(/\s+/) as [string, string?]);
    if (kind === "DIR") files[path] = null;
    else if (kind === "LINK") files[path] = { link: arg! };
    else if (kind === "M") files[path] = `<mapper namespace="${arg}">\n  <select id="q"/>\n</mapper>\n`;
    else if (kind === "XML") files[path] = "<settings/>\n";
    else if (kind === "SQLMAP") files[path] = '<sqlMap namespace="old.Old">\n</sqlMap>\n';
    else files[path] = "x\n".repeat(Number(kind));
  }
  return files;
}

export function writeRepo(files: Record<string, Entry>, root = tempDir()): string {
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    if (content === null) {
      mkdirSync(full, { recursive: true });
    } else if (typeof content === "object") {
      mkdirSync(dirname(full), { recursive: true });
      symlinkSync(content.link, full);
    } else {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
  }
  return root;
}

export function runDraft(repo: string, args: string[] = []): Draft {
  const out = run(["draft", ...args], repo);
  expect(out.code, out.stderr).toBe(0);
  return JSON.parse(out.stdout) as Draft;
}

// What a note tells, without its wording.
export function noteFacts(notes: Note[]): Record<string, Record<string, number>> {
  const facts: Record<string, Record<string, number>> = {};
  for (const note of notes) {
    const { code, message: _message, ...numbers } = note;
    facts[code] = numbers as Record<string, number>;
  }
  return facts;
}

// The invariants that hold for every draft that exits 0: write the draft
// config over the existing one and the draft plan into home, then measure.
export function expectDraftInvariants(
  repo: string,
  result: Draft,
  existing: Record<string, unknown> | null,
  args: string[] = [],
): void {
  const maxParts = args.includes("--max-parts") ? Number(args[args.indexOf("--max-parts") + 1]) : 16;
  const ids = result.plan.parts.map((p) => p.id);
  expect(new Set(ids).size).toBe(ids.length);
  if (ids.length > maxParts) {
    expect(result.notes.map((n) => n.code)).toContain("over-max-parts");
  }

  const base = { ...(existing ?? {}) };
  delete base.languages;
  delete base.watch;
  delete base.roots;
  const config = { ...base, ...result.config };
  const home = (existing?.home as string | undefined) ?? "docs/codeplan";
  writeFileSync(join(repo, "codeplan.json"), JSON.stringify(config));
  mkdirSync(join(repo, home), { recursive: true });
  writeFileSync(join(repo, home, "plan.json"), JSON.stringify(result.plan));

  expect(run(["update"], repo).code).toBe(0);
  const checked = check(repo);
  if (checked.kind !== "measured") throw new Error(checked.message);
  const m = checked.measurement;
  expect({ orphans: m.orphans, contested: m.contested, unwatched: m.unwatched }).toEqual({
    orphans: [],
    contested: [],
    unwatched: [],
  });
  expect(m.parts).toEqual(result.measure.parts);
  expect(m.watchedFiles).toBe(result.measure.files);
  expect(m.parts.reduce((s, p) => s + p.lines, 0)).toBe(result.measure.lines);
  expect(checked.diagnostics).toEqual([]);
  expect(checked.page.current).toBe(true);
  expect(run(["check"], repo).code).toBe(0);
  expect(checked.excluded).toBe(0);

  // With the draft config in place, a second draft that takes languages and
  // roots from it gives the same output apart from where its inputs came from.
  const again = runDraft(repo, args.includes("--max-parts") ? ["--max-parts", String(maxParts)] : []);
  const { sources: _a, notes: _b, ...first } = result;
  const { sources: _c, notes: _d, ...second } = again;
  expect(second).toEqual(first);
}
