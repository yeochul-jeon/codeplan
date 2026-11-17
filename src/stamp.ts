// Stamps of evidence lines, from the file's bytes.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isPathForm } from "./config.js";
import { isPlainFile } from "./measure.js";

// One CR at the end, then spaces and tabs at both ends, are taken off.
export function stampOf(line: Uint8Array): string {
  let end = line.length;
  if (end > 0 && line[end - 1] === 0x0d) end--;
  let start = 0;
  const blank = (b: number) => b === 0x20 || b === 0x09;
  while (start < end && blank(line[start]!)) start++;
  while (end > start && blank(line[end - 1]!)) end--;
  return createHash("sha256").update(line.subarray(start, end)).digest("hex").slice(0, 8);
}

export interface FileLines {
  // Index 0 is line 1.
  stamps: string[];
  // For each stamp: its line when one line has it, else 0.
  found: Map<string, number>;
}

// Counted by the tests.
export let built = 0;

export function fileLines(bytes: Uint8Array): FileLines {
  built++;
  const stamps: string[] = [];
  // A line ends at LF or at the end of the file; nothing after a last LF.
  for (let start = 0, end; start < bytes.length; start = end + 1) {
    end = bytes.indexOf(0x0a, start);
    if (end < 0) end = bytes.length;
    stamps.push(stampOf(bytes.subarray(start, end)));
  }
  const found = new Map<string, number>();
  stamps.forEach((stamp, i) => found.set(stamp, found.has(stamp) ? 0 : i + 1));
  return { stamps, found };
}

// The lines of each file, read once for each written path; null when no
// plain file can be read there.
export function cachedLines(repo: string): (path: string) => FileLines | null {
  const read = new Map<string, FileLines | null>();
  return (path) => {
    if (!read.has(path)) {
      try {
        read.set(path, isPlainFile(repo, path) ? fileLines(readFileSync(join(repo, path))) : null);
      } catch {
        read.set(path, null);
      }
    }
    return read.get(path)!;
  };
}

export interface Evidence {
  path: string;
  line: number;
  stamp: string | null;
}

export function readEvidence(text: string): Evidence | null {
  const colon = text.lastIndexOf(":");
  const path = text.slice(0, Math.max(colon, 0));
  const tail = /^([1-9][0-9]*)(?:#([0-9a-f]{8}))?$/.exec(text.slice(colon + 1));
  if (colon < 0 || tail === null || !isPathForm(path)) return null;
  return { path, line: Number(tail[1]), stamp: tail[2] ?? null };
}

export type State = "same" | "no-stamp" | "elsewhere" | "differs" | "no-line" | "no-file";

// Null: no file.
export interface EvidenceFiles {
  count: (path: string) => number | null;
  lines: (path: string) => FileLines | null;
}

// For no-stamp, `stamp` is null.
export function judge(e: Evidence, files: EvidenceFiles): { state: State; line: number | null; stamp: string | null } {
  const none = (state: State) => ({ state, line: null, stamp: null });
  if (e.stamp === null) {
    const count = files.count(e.path);
    if (count === null) return none("no-file");
    if (count < e.line) return none("no-line");
    return { state: "no-stamp", line: e.line, stamp: null };
  }
  const lines = files.lines(e.path);
  if (lines === null) return none("no-file");
  const now = lines.stamps[e.line - 1];
  if (now === e.stamp) return { state: "same", line: e.line, stamp: e.stamp };
  const found = lines.found.get(e.stamp);
  if (found) return { state: "elsewhere", line: found, stamp: e.stamp };
  if (now === undefined) return none("no-line");
  return { state: "differs", line: e.line, stamp: now };
}
