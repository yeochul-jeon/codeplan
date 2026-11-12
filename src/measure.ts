// Which files are watched, and which part owns each of them.
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LANGUAGES, isUnder, type Config } from "./config.js";
import { GlobSet, compileGlob, strength } from "./glob.js";
import { lineTotal } from "./lines.js";
import type { PlanPart } from "./plan.js";

export interface PartMeasure {
  id: string;
  files: number;
  lines: number;
}

export interface ContestedFile {
  path: string;
  parts: string[];
}

export interface Measurement {
  parts: PartMeasure[];
  orphans: string[];
  contested: ContestedFile[];
  unwatched: string[];
  watchedFiles: number;
  // Every watched file and the part it is measured in (null: an orphan).
  owners: Map<string, string | null>;
  // For a file measured in a part: that part's pattern that won it (the
  // first in its paths among equally strong ones).
  wonBy: Map<string, string>;
}

export const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// Every regular file under `repo`, as "/"-joined relative paths, sorted.
// `.git` and dependency directories are not entered at any depth. Symbolic
// links are not followed.
export function listFiles(repo: string, prunedDirs: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const visit = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = prefix + entry.name;
      if (entry.isDirectory()) {
        if (!prunedDirs.has(entry.name)) visit(join(dir, entry.name), path + "/");
      } else if (entry.isFile()) {
        out.push(path);
      }
    }
  };
  visit(repo, "");
  return out.sort(byCodeUnit);
}

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1);
}

export function hasDotSegment(path: string): boolean {
  return path.split("/").some((s) => s.startsWith("."));
}

export class Rules {
  readonly prunedDirs: Set<string>;
  private readonly buildOutputDirs: Set<string>;
  private readonly codeExtSet: Set<string>;
  private readonly roots: GlobSet;
  private readonly mappers: GlobSet;
  private readonly userWatch: GlobSet | null;
  private readonly skip: GlobSet;
  private readonly testRules: { codeExts: Set<string>; patterns: GlobSet }[];
  private readonly javaTests: GlobSet | null;

  constructor(private readonly config: Config) {
    const rules = config.languages.map((l) => LANGUAGES[l]);
    this.prunedDirs = new Set([".git", ...rules.flatMap((r) => r.dependencyDirs)]);
    this.buildOutputDirs = new Set(rules.flatMap((r) => r.buildOutputDirs));
    this.codeExtSet = new Set(rules.flatMap((r) => r.codeExts));
    this.roots = new GlobSet(config.roots);
    this.mappers = new GlobSet(rules.flatMap((r) => r.mapperPatterns));
    this.userWatch = config.watch === null ? null : new GlobSet(config.watch);
    this.skip = new GlobSet(config.skip);
    this.testRules = rules.map((r) => ({
      codeExts: new Set(r.codeExts),
      patterns: new GlobSet(r.testPatterns),
    }));
    this.javaTests = config.languages.includes("java")
      ? new GlobSet(LANGUAGES.java.testPatterns)
      : null;
  }

  // A directory prefix of `path` (its first `n` segments) is a source root.
  private rootEndsBefore(segments: string[], n: number): boolean {
    for (let j = 1; j <= n; j++) {
      if (this.roots.matches(segments.slice(0, j).join("/"))) return true;
    }
    return false;
  }

  private underRoot(path: string): boolean {
    const segments = path.split("/");
    return this.rootEndsBefore(segments, segments.length - 1);
  }

  // A build-output directory name comes before any source-root prefix.
  inBuildOutput(path: string): boolean {
    const segments = path.split("/");
    for (let i = 0; i < segments.length - 1; i++) {
      if (this.buildOutputDirs.has(segments[i]!) && !this.rootEndsBefore(segments, i)) {
        return true;
      }
    }
    return false;
  }

  private matchesMapperGlob(path: string): boolean {
    return this.mappers.matches(path);
  }

  // Test patterns apply to each language's own code extensions; mapper XML
  // takes only the java test patterns.
  private isTest(path: string): boolean {
    const ext = extensionOf(path);
    if (this.testRules.some((t) => t.codeExts.has(ext) && t.patterns.matches(path))) {
      return true;
    }
    return this.javaTests !== null && this.matchesMapperGlob(path) && this.javaTests.matches(path);
  }

  private inDefaultWatch(path: string): boolean {
    if (hasDotSegment(path) || this.inBuildOutput(path)) return false;
    const ext = extensionOf(path);
    const { languages } = this.config;
    if (languages.includes("js") && LANGUAGES.js.codeExts.includes(ext)) return true;
    if (languages.includes("java")) {
      if (LANGUAGES.java.codeExts.includes(ext) && this.underRoot(path)) return true;
      if (this.matchesMapperGlob(path)) return true;
    }
    return false;
  }

  // Not watched for a reason the config states: skip, home, or a test file.
  excluded(path: string): boolean {
    return (
      this.skip.matches(path) ||
      isUnder(path, this.config.home) ||
      (!this.config.tests && this.isTest(path))
    );
  }

  isWatched(path: string): boolean {
    const inWatch = this.userWatch ? this.userWatch.matches(path) : this.inDefaultWatch(path);
    return inWatch && !this.excluded(path);
  }

  // Code the language rules recognise but the watch set does not hold.
  isUnwatched(path: string): boolean {
    if (hasDotSegment(path) || this.inBuildOutput(path)) return false;
    if (!this.codeExtSet.has(extensionOf(path)) && !this.matchesMapperGlob(path)) return false;
    return !this.isWatched(path) && !this.excluded(path);
  }
}

// A regular file at `path` with no symbolic link on the way from the
// repository root. Anything else (nothing there, a directory, a link, a
// place that cannot be read) is not a file.
export function isPlainFile(repo: string, path: string): boolean {
  const segments = path.split("/");
  try {
    for (let i = 1; i <= segments.length; i++) {
      const stat = lstatSync(join(repo, ...segments.slice(0, i)), { throwIfNoEntry: false });
      if (stat === undefined || stat.isSymbolicLink()) return false;
      if (i === segments.length) return stat.isFile();
      if (!stat.isDirectory()) return false;
    }
  } catch {
    return false;
  }
  return false;
}

// Whether a file at `path`, if it were made, would be watched and matched
// by no pattern of any part. Only the written path is looked at.
export function unownedTest(config: Config, plan: PlanPart[]): (path: string) => boolean {
  const rules = new Rules(config);
  const patterns = plan.flatMap((part) => part.paths.map((p) => compileGlob(p)));
  return (path) => {
    const dirs = path.split("/").slice(0, -1);
    if (dirs.some((d) => rules.prunedDirs.has(d))) return false;
    return rules.isWatched(path) && !patterns.some((regex) => regex.test(path));
  };
}

export function measure(repo: string, config: Config, plan: PlanPart[]): Measurement {
  const rules = new Rules(config);
  const files = listFiles(repo, rules.prunedDirs);
  const patterns = plan.flatMap((part) =>
    part.paths.map((p) => ({ id: part.id, pattern: p, regex: compileGlob(p), strength: strength(p) })),
  );
  const totals = new Map(plan.map((p) => [p.id, { files: 0, lines: 0 }]));
  const orphans: string[] = [];
  const contested: ContestedFile[] = [];
  const unwatched: string[] = [];
  const owners = new Map<string, string | null>();
  const wonBy = new Map<string, string>();
  let watchedFiles = 0;

  for (const path of files) {
    if (!rules.isWatched(path)) {
      if (rules.isUnwatched(path)) unwatched.push(path);
      continue;
    }
    watchedFiles++;
    let best = -1;
    let matched = new Map<string, string>();
    for (const p of patterns) {
      if (!p.regex.test(path)) continue;
      if (p.strength > best) {
        best = p.strength;
        matched = new Map([[p.id, p.pattern]]);
      } else if (p.strength === best && !matched.has(p.id)) {
        matched.set(p.id, p.pattern);
      }
    }
    if (matched.size === 0) {
      orphans.push(path);
      owners.set(path, null);
      continue;
    }
    const ids = [...matched.keys()].sort(byCodeUnit);
    if (ids.length > 1) contested.push({ path, parts: ids });
    owners.set(path, ids[0]!);
    wonBy.set(path, matched.get(ids[0]!)!);
    const total = totals.get(ids[0]!)!;
    total.files++;
    total.lines += lineTotal(readFileSync(join(repo, path)));
  }

  return {
    parts: plan.map((p) => ({ id: p.id, ...totals.get(p.id)! })),
    orphans,
    contested,
    unwatched,
    watchedFiles,
    owners,
    wonBy,
  };
}
