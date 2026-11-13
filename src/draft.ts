// Draft: read the repository and propose plan.json and codeplan.json as a
// starting point for a person to edit. The order of the steps below decides
// the result, so it is part of the behaviour, not an implementation detail.
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_FILE, LANGUAGES, isUnder, readConfig, type Config, type Language } from "./config.js";
import { GlobSet, compileGlob, strength } from "./glob.js";
import { lineTotal } from "./lines.js";
import { Rules, byCodeUnit, extensionOf, hasDotSegment, listFiles } from "./measure.js";

export class DraftError extends Error {}

export interface DraftOptions {
  maxParts: number;
  // From the command line; null when not given.
  languages: string[] | null;
  roots: string[] | null;
  // Make a part from file names when this many files start with one word;
  // null when not asked for.
  partsByName: number | null;
}

type Source = "command line" | "codeplan.json" | "detected" | "default";

export type Note =
  | { code: "no-zones"; message: string }
  | { code: "over-max-parts"; parts: number; maxParts: number; message: string }
  | { code: "modules"; modules: number; notRemaining: number; message: string }
  | { code: "layers"; layerFiles: number; files: number; message: string }
  | { code: "parts-by-name"; parts: number; files: number; message: string }
  | { code: "no-parts-by-name"; message: string }
  | { code: "exact-paths"; files: number; message: string }
  | { code: "build-output"; files: number; message: string };

export interface DraftPart {
  id: string;
  name: string;
  zone?: string;
  about: string;
  paths: string[];
}

export interface MapperCounts {
  namespace: number;
  fileName: number;
  package: number;
  rest: number;
  restFiles: string[];
  outsidePattern: number;
}

export interface Draft {
  plan: {
    format: 1;
    name: string;
    about: string;
    parts: DraftPart[];
    externals: never[];
    scenarios: never[];
  };
  config: { languages: Language[]; watch?: string[]; roots?: string[] };
  measure: { parts: { id: string; files: number; lines: number }[]; files: number; lines: number };
  sources: { languages: Source; roots?: Source };
  notes: Note[];
  modules?: string[];
  mappers?: MapperCounts;
}

const BUILD_MARKERS = new Set(["pom.xml", "build.gradle", "build.gradle.kts"]);
const MAIN_ROOTS = ["src/main/java", "src/main/kotlin"];
const TEST_ROOTS = ["src/test/java", "src/test/kotlin"];
const ROOT_FORM = /^(?:(.*)\/)?src\/(?:main|test)\/(?:java|kotlin)$/;
// The two mapper patterns, relative to a module's resources directory.
const MAPPER_RELATIVE = new GlobSet(["**/mapper/**/*.xml", "**/*Mapper.xml"]);
const MAPPER_NS_ATTR = /<mapper\b[^>]*?\bnamespace\s*=\s*(?:"([^"]*)"|'([^']*)')/;
const LAYER_NAMES = new Set([
  "controller", "dao", "domain", "dto", "entity", "mapper", "model", "repository", "service", "vo",
]);
// The first word of a file name: one capital, then small letters and digits.
const FIRST_WORD = /^[A-Z][a-z0-9]+/;

// ---- paths ----------------------------------------------------------------

const segs = (p: string): string[] => (p === "" ? [] : p.split("/"));
const dirOf = (p: string): string => {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
};
const baseOf = (p: string): string => p.slice(p.lastIndexOf("/") + 1);
const stem = (name: string): string => {
  const i = name.lastIndexOf(".");
  return i <= 0 ? name : name.slice(0, i);
};
const joinPath = (a: string, b: string): string => (a === "" ? b : b === "" ? a : `${a}/${b}`);
// `dir` is a proper ancestor directory of `path` ("" is the ancestor of all).
const isAncestor = (dir: string, path: string): boolean =>
  dir === "" ? path !== "" : isUnder(path, dir);
const strip = (path: string, dir: string): string => (dir === "" ? path : path.slice(dir.length + 1));
const sorted = (items: Iterable<string>): string[] => [...new Set(items)].sort(byCodeUnit);

// A path written into a glob: `*`, `?`, `[` and `{` become one-character sets.
export function asGlobLiteral(path: string): string {
  return path.replace(/[*?[{]/g, (c) => `[${c}]`);
}

function normalizeId(text: string): string {
  const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return id === "" ? "top" : id;
}

function isRealDir(repo: string, path: string): boolean {
  try {
    return lstatSync(join(repo, path), { throwIfNoEntry: false })?.isDirectory() ?? false;
  } catch {
    // A file on the way (ENOTDIR) or a name too long: not a directory.
    return false;
  }
}

// ---- model ----------------------------------------------------------------

interface Module {
  path: string; // "" for the root module
  roots: string[];
  resources: string | null;
  code: FileRec[];
  mappers: FileRec[];
  commonPackage: string;
  // The part the module starts from: its common package part (made at the
  // start or during folding), or its module part when modules are many.
  start: Part | null;
}

interface FileRec {
  path: string;
  lines: number;
  module: Module | null;
  root: string | null; // a module code file's source root
  rel: string; // under the source root (code) or the resources directory (mapper)
  namespace: string | null;
  outsidePattern: boolean;
}

interface Part {
  // 0: the whole-repository part, 1: a part inside a module (or a module part),
  // 2: any other directory part, 3: a part made from file names.
  kind: 0 | 1 | 2 | 3;
  module: Module | null;
  common: boolean;
  modulePart: boolean;
  // Common-package-relative path inside a module, the directory otherwise;
  // "" for the whole-repository, common package and module parts. The word
  // for a part made from file names.
  path: string;
  files: FileRec[];
  received: boolean;
  moduleContent: boolean;
  dirPattern: boolean;
  // A resources-directory part: exact paths until it receives something.
  exactPaths: boolean;
  topDirs: Set<string>;
  alive: boolean;
  forward: Part | null;
  id: string;
  mapperFiles: FileRec[];
  extra: string[];
}

function newPart(kind: Part["kind"], fields: Partial<Part> = {}): Part {
  return {
    kind,
    module: null,
    common: false,
    modulePart: false,
    path: "",
    files: [],
    received: false,
    moduleContent: false,
    dirPattern: false,
    exactPaths: false,
    topDirs: new Set(),
    alive: true,
    forward: null,
    id: "",
    mapperFiles: [],
    extra: [],
    ...fields,
  };
}

const linesOf = (files: FileRec[]): number => files.reduce((sum, f) => sum + f.lines, 0);
const moduleName = (m: Module): string => (m.path === "" ? "." : m.path);
// For a Java or Kotlin file of a module: the first directory below the
// common package that is named like a layer, if there is one.
const layerOf = (f: FileRec): string | undefined =>
  f.module !== null && f.root !== null && ["java", "kt"].includes(extensionOf(f.path))
    ? segs(dirOf(strip(f.rel, f.module.commonPackage))).find((s) => LAYER_NAMES.has(s))
    : undefined;

function compareParts(a: Part, b: Part): number {
  if (a.kind !== b.kind) return a.kind - b.kind;
  if (a.kind === 1) {
    const byModule = byCodeUnit(moduleName(a.module!), moduleName(b.module!));
    if (byModule !== 0) return byModule;
  }
  return byCodeUnit(a.path, b.path);
}

// ---- inputs ---------------------------------------------------------------

function readRawConfig(repo: string): Record<string, unknown> {
  const file = join(repo, CONFIG_FILE);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : {};
}

function checkRoot(repo: string, root: string, where: string): string {
  const parts = root.split("/").filter((s) => s !== "" && s !== ".");
  if (root.startsWith("/") || parts.length === 0 || parts.includes("..")) {
    throw new DraftError(`${where} "${root}" is not a directory inside the repository`);
  }
  const path = parts.join("/");
  if (!isRealDir(repo, path)) {
    throw new DraftError(`${where} "${root}" is not a directory inside the repository`);
  }
  return path;
}

// A `roots` value from codeplan.json read as a path: a one-character set is
// that character; any other glob is refused.
function literalRoot(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    if (c === "[" && value[i + 2] === "]") {
      out += value[i + 1];
      i += 2;
    } else if ("*?[{".includes(c)) {
      throw new DraftError(
        `roots in ${CONFIG_FILE} "${value}" is a glob; draft reads each root as one directory ` +
          "and does not expand globs, because it does not look at build files for given roots",
      );
    } else {
      out += c;
    }
  }
  return out;
}

function checkRoots(repo: string, values: string[], where: string, read: (v: string) => string): string[] {
  const roots = values.map((v) => checkRoot(repo, read(v), where));
  const repeated = roots.find((r, i) => roots.indexOf(r) !== i);
  if (repeated !== undefined) throw new DraftError(`${where} names "${repeated}" more than once`);
  return sorted(roots);
}

function chooseLanguages(
  repo: string,
  options: DraftOptions,
  config: Config,
  raw: Record<string, unknown>,
): { languages: Language[]; source: Source } {
  if (options.languages !== null) {
    const known = Object.keys(LANGUAGES);
    for (const name of options.languages) {
      if (!known.includes(name)) {
        throw new DraftError(`unknown language "${name}"; known: ${known.sort().join(", ")}`);
      }
    }
    if (new Set(options.languages).size !== options.languages.length) {
      throw new DraftError("--language names a language more than once");
    }
    return { languages: sorted(options.languages) as Language[], source: "command line" };
  }
  if (raw.languages !== undefined) return { languages: config.languages, source: "codeplan.json" };
  const detected = (Object.keys(LANGUAGES) as Language[])
    .filter((l) => LANGUAGES[l].detect.some((f) => existsSync(join(repo, f))))
    .sort(byCodeUnit);
  if (detected.length > 0) return { languages: detected, source: "detected" };
  return { languages: ["js"], source: "default" };
}

// ---- modules --------------------------------------------------------------

function findModules(
  repo: string,
  files: string[],
  given: string[] | null,
  tests: boolean,
  rules: Rules,
): Module[] {
  const make = (path: string, roots: string[], resources: string | null): Module => ({
    path,
    roots: sorted(roots),
    resources,
    code: [],
    mappers: [],
    commonPackage: "",
    start: null,
  });

  if (given !== null) {
    const perDir = new Map<string, { roots: string[]; dForm: boolean }>();
    for (const root of given) {
      const match = ROOT_FORM.exec(root);
      const dir = match ? (match[1] ?? "") : root;
      const entry = perDir.get(dir) ?? { roots: [], dForm: false };
      entry.roots.push(root);
      entry.dForm ||= match !== null;
      perDir.set(dir, entry);
    }
    return sorted(perDir.keys()).map((dir) => {
      const { roots, dForm } = perDir.get(dir)!;
      const resources = joinPath(dir, "src/main/resources");
      return make(dir, roots, dForm && isRealDir(repo, resources) ? resources : null);
    });
  }

  const candidates = sorted(files.filter((f) => BUILD_MARKERS.has(baseOf(f))).map(dirOf));
  const modules: Module[] = [];
  for (const dir of candidates) {
    if (hasDotSegment(dir)) continue;
    if (dir !== "" && rules.inBuildOutput(`${dir}/x`)) continue;
    const rootNames = tests ? [...MAIN_ROOTS, ...TEST_ROOTS] : MAIN_ROOTS;
    const roots = rootNames.map((r) => joinPath(dir, r)).filter((r) => isRealDir(repo, r));
    const resourcesPath = joinPath(dir, "src/main/resources");
    const resources = isRealDir(repo, resourcesPath) ? resourcesPath : null;
    const hasMapper =
      resources !== null &&
      files.some((f) => isUnder(f, resources) && isMapperXml(repo, f, strip(f, resources)) !== null);
    if (roots.length === 0 && !hasMapper) continue;
    modules.push(make(dir, roots, resources));
  }
  return modules;
}

const namespaces = new Map<string, string | null>();

function readNamespace(repo: string, path: string): string | null {
  const key = join(repo, path);
  if (!namespaces.has(key)) {
    const match = MAPPER_NS_ATTR.exec(readFileSync(key, "utf8"));
    const value = match ? (match[1] ?? match[2] ?? "") : "";
    namespaces.set(key, value.trim() === "" ? null : value.trim());
  }
  return namespaces.get(key)!;
}

// For an XML file under a resources directory: null when it is not a mapper,
// otherwise whether the two mapper patterns miss it, and its namespace.
function isMapperXml(
  repo: string,
  path: string,
  rel: string,
): { outsidePattern: boolean; namespace: string | null } | null {
  if (extensionOf(path) !== "xml" || hasDotSegment(rel)) return null;
  const namespace = readNamespace(repo, path);
  if (MAPPER_RELATIVE.matches(rel)) return { outsidePattern: false, namespace };
  return namespace === null ? null : { outsidePattern: true, namespace };
}

function commonPackage(rels: string[]): string {
  let cp = "";
  for (;;) {
    let hasFile = false;
    const subdirs = new Set<string>();
    for (const rel of rels) {
      const rest = segs(strip(rel, cp));
      if (rest.length === 1) hasFile = true;
      else subdirs.add(rest[0]!);
    }
    if (hasFile || subdirs.size !== 1) return cp;
    cp = joinPath(cp, [...subdirs][0]!);
  }
}

const keysAtDepth = (dirs: string[]) => (d: number) =>
  new Set(dirs.map((dir) => segs(dir).slice(0, d).join("/")));

// The start depth of one group, from the part keys its files have at each
// depth ("" for the bottom part).
function startDepth(at: (depth: number) => Set<string>, maxParts: number): number {
  let depth = 1;
  for (;;) {
    const current = at(depth);
    const next = at(depth + 1);
    const same = next.size === current.size && [...next].every((k) => current.has(k));
    if (next.size > maxParts || same) return depth;
    depth++;
  }
}

function groupAtDepth<T>(items: T[], dirOfItem: (item: T) => string, depth: number): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = segs(dirOfItem(item)).slice(0, depth).join("/");
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

// ---- the draft ------------------------------------------------------------

export function draft(repo: string, options: DraftOptions): Draft {
  namespaces.clear();
  const config = readConfig(repo);
  const raw = readRawConfig(repo);
  const { maxParts } = options;
  const { languages, source: languageSource } = chooseLanguages(repo, options, config, raw);

  let given: string[] | null = null;
  let rootSource: Source | undefined;
  if (options.roots !== null) {
    given = checkRoots(repo, options.roots, "--root", (r) => r);
    rootSource = "command line";
  } else if (raw.roots !== undefined) {
    given = checkRoots(repo, config.roots, `roots in ${CONFIG_FILE}`, literalRoot);
    rootSource = "codeplan.json";
  }

  const java = languages.includes("java");
  const codeExts = sorted(languages.flatMap((l) => LANGUAGES[l].codeExts));
  const codeExtSet = new Set(codeExts);
  const languageRoots = languages.flatMap((l) => [
    ...LANGUAGES[l].mainRootGlobs,
    ...(config.tests ? LANGUAGES[l].testRootGlobs : []),
  ]);
  const rules = new Rules({
    ...config,
    languages,
    watch: null,
    roots: given !== null ? given.map(asGlobLiteral) : languageRoots,
  });
  const all = listFiles(repo, rules.prunedDirs);
  const modules = java ? findModules(repo, all, given, config.tests, rules) : [];
  const moduleCount = modules.length;
  const many = moduleCount > maxParts;

  // ---- collect files ----
  const rootIndex = modules
    .flatMap((m) => m.roots.map((root) => ({ root, module: m })))
    .sort((a, b) => b.root.length - a.root.length);
  const resourcesIndex = modules
    .filter((m) => m.resources !== null)
    .sort((a, b) => b.resources!.length - a.resources!.length);
  const languageRootWatch =
    many && given === null
      ? languageRoots.flatMap((r) => codeExts.map((e) => `${r}/**/*.${e}`))
      : [];
  const languageRootSet = new GlobSet(languageRootWatch);
  const lineCount = (path: string) => lineTotal(readFileSync(join(repo, path)));

  const collected: FileRec[] = [];
  const outside: FileRec[] = [];
  for (const path of all) {
    const ext = extensionOf(path);
    const inRoot = codeExtSet.has(ext) ? rootIndex.find((r) => isUnder(path, r.root)) : undefined;
    if (inRoot) {
      const rel = strip(path, inRoot.root);
      if (hasDotSegment(rel) || rules.excluded(path)) continue;
      const rec: FileRec = {
        path, lines: lineCount(path), module: inRoot.module, root: inRoot.root, rel,
        namespace: null, outsidePattern: false,
      };
      inRoot.module.code.push(rec);
      collected.push(rec);
      continue;
    }
    const inResources = resourcesIndex.find((m) => isUnder(path, m.resources!));
    if (inResources) {
      const rel = strip(path, inResources.resources!);
      const mapper = isMapperXml(repo, path, rel);
      if (mapper !== null) {
        if (rules.excluded(path)) continue;
        const rec: FileRec = {
          path, lines: lineCount(path), module: inResources, root: null, rel, ...mapper,
        };
        inResources.mappers.push(rec);
        collected.push(rec);
        continue;
      }
    }
    const byDefault = rules.isWatched(path) || rules.isUnwatched(path);
    if (byDefault || (languageRootSet.matches(path) && !rules.excluded(path))) {
      const rec: FileRec = {
        path, lines: lineCount(path), module: null, root: null, rel: path,
        namespace: null, outsidePattern: false,
      };
      outside.push(rec);
      collected.push(rec);
    }
  }
  const underGiven = (path: string) => given !== null && given.some((r) => isUnder(path, r));
  const fromBuildOutput = collected.filter(
    (f) => rules.inBuildOutput(f.path) && !underGiven(f.path),
  ).length;

  for (const m of modules) m.commonPackage = commonPackage(m.code.map((f) => f.rel));

  // ---- parts from file names ----
  // A word that starts enough files in layer directories, under two or more
  // of these names, gives one part. The part holds `<directory>/<word>*`
  // for each directory of those files, and the patterns decide its files:
  // every file a pattern matches, the longer word first.
  const nameParts: Part[] = [];
  const byName = new Map<FileRec, Part>();
  if (options.partsByName !== null) {
    const perWord = new Map<string, { files: FileRec[]; layers: Set<string> }>();
    for (const f of modules.flatMap((m) => m.code)) {
      const layer = layerOf(f);
      const word = FIRST_WORD.exec(baseOf(f.path))?.[0];
      if (layer === undefined || word === undefined) continue;
      const entry = perWord.get(word) ?? { files: [], layers: new Set() };
      entry.files.push(f);
      entry.layers.add(layer);
      perWord.set(word, entry);
    }
    const patterns: { part: Part; regex: RegExp; strength: number }[] = [];
    for (const word of sorted(perWord.keys())) {
      const { files, layers } = perWord.get(word)!;
      if (files.length < options.partsByName || layers.size < 2) continue;
      const part = newPart(3, {
        path: word,
        extra: sorted(files.map((f) => `${asGlobLiteral(dirOf(f.path))}/${word}*`)),
      });
      nameParts.push(part);
      for (const p of part.extra) patterns.push({ part, regex: compileGlob(p), strength: strength(p) });
    }
    patterns.sort((a, b) => b.strength - a.strength);
    for (const f of [...modules.flatMap((m) => m.code), ...outside]) {
      const part = patterns.find((p) => p.regex.test(f.path))?.part;
      if (part === undefined) continue;
      part.files.push(f);
      byName.set(f, part);
    }
  }
  // The other files give the other parts, within what the count leaves.
  const remaining = (files: FileRec[]): FileRec[] => files.filter((f) => !byName.has(f));
  const foldLimit = Math.max(1, maxParts - nameParts.length);

  // ---- first parts ----
  const parts: Part[] = [];
  const outsideGroup: FileRec[] = [];
  if (many) {
    const nonRoot = modules.filter((m) => m.path !== "").sort((a, b) => b.path.length - a.path.length);
    const extraFiles = new Map<Module, FileRec[]>();
    for (const f of remaining(outside)) {
      const home = f.path.includes("/") ? nonRoot.find((m) => isUnder(f.path, m.path)) : undefined;
      if (home) extraFiles.set(home, [...(extraFiles.get(home) ?? []), f]);
      else outsideGroup.push(f);
    }
    for (const m of modules) {
      const extra = extraFiles.get(m) ?? [];
      const code = remaining(m.code);
      // A module whose code all went to parts made from file names has no part.
      const onlyMappers = m.code.length === 0 && m.mappers.length > 0;
      if (code.length + extra.length === 0 && !onlyMappers) continue;
      const part = newPart(1, {
        module: m,
        modulePart: true,
        files: [...code, ...extra],
        dirPattern: extra.length > 0,
      });
      m.start = part;
      parts.push(part);
    }
  } else {
    outsideGroup.push(...remaining(outside));
    for (const m of modules) {
      if (m.code.length === 0) {
        if (m.mappers.length > 0) {
          const part = newPart(1, { module: m, common: true });
          m.start = part;
          parts.push(part);
        }
        continue;
      }
      const code = remaining(m.code);
      const dirFor = (f: FileRec) => dirOf(strip(f.rel, m.commonPackage));
      const depth = startDepth(keysAtDepth(code.map(dirFor)), foldLimit);
      for (const [key, files] of groupAtDepth(code, dirFor, depth)) {
        const part = newPart(1, { module: m, common: key === "", path: key, files });
        if (part.common) m.start = part;
        parts.push(part);
      }
    }
  }
  if (outsideGroup.length > 0) {
    // A file outside modules under a module's resources directory belongs to
    // one part for that whole directory, at every depth.
    const resourcesDirOf = (f: FileRec) =>
      resourcesIndex.find((m) => isUnder(f.path, m.resources!))?.resources ?? null;
    const keyAt = (f: FileRec, d: number) =>
      resourcesDirOf(f) ?? segs(dirOf(f.path)).slice(0, d).join("/");
    const depth = startDepth((d) => new Set(outsideGroup.map((f) => keyAt(f, d))), foldLimit);
    const groups = new Map<string, FileRec[]>();
    for (const f of outsideGroup) {
      const key = keyAt(f, depth);
      groups.set(key, [...(groups.get(key) ?? []), f]);
    }
    for (const [key, files] of groups) {
      if (key === "") parts.push(newPart(0, { files }));
      else parts.push(newPart(2, { path: key, files, exactPaths: resourcesDirOf(files[0]!) === key }));
    }
  }

  // ---- fold ----
  const alive = () => parts.filter((p) => p.alive);
  // Where a part sits for covering and "up": the module directory for a
  // module part, its path otherwise.
  const place = (p: Part) => (p.modulePart ? p.module!.path : p.path);
  const levelOf = (p: Part) => (p.modulePart ? 0 : segs(p.path).length);
  const topHasAll = (top: Part) => top.moduleContent || (moduleCount === 0 && top.received);
  const sameSpace = (a: Part, x: Part): boolean => {
    if (many) return !(a.modulePart && a.module!.path === "");
    return x.kind === 1 ? a.kind === 1 && a.module === x.module : a.kind !== 1;
  };
  const covers = (a: Part, x: Part): boolean => {
    if (a.kind === 2) return true;
    if (a.kind === 0) return topHasAll(a) || a.topDirs.has(segs(place(x))[0] ?? "");
    if (a.modulePart) return true;
    return !a.common || a.received;
  };
  const add = (part: Part): Part => {
    parts.push(part);
    return part;
  };
  const topOrNew = () => alive().find((p) => p.kind === 0) ?? add(newPart(0));
  const upperPartOf = (x: Part): Part => {
    const up = dirOf(place(x));
    if (!many && x.kind === 1) {
      const m = x.module!;
      const found = alive().find((p) => p.kind === 1 && p.module === m && p.path === up);
      if (found) return found;
      const created = add(newPart(1, { module: m, common: up === "", path: up }));
      if (created.common) m.start = created;
      return created;
    }
    if (up === "") return topOrNew();
    return (
      alive().find((p) => p.kind !== 0 && sameSpace(p, x) && place(p) === up) ??
      add(newPart(2, { path: up }))
    );
  };
  const target = (x: Part): Part => {
    if (x.common) return topOrNew();
    let best: Part | null = null;
    for (const a of alive()) {
      if (a === x || !sameSpace(a, x) || !isAncestor(place(a), place(x)) || !covers(a, x)) continue;
      if (best === null || place(a).length > place(best).length) best = a;
    }
    return best ?? upperPartOf(x);
  };
  const merge = (x: Part, into: Part) => {
    into.files.push(...x.files);
    into.received = true;
    if (x.kind === 1 || x.moduleContent) into.moduleContent = true;
    if (into.kind === 0 && x.kind === 2) into.topDirs.add(segs(x.path)[0]!);
    if (into.modulePart) into.dirPattern = true;
    x.alive = false;
    x.forward = into;
  };
  const eligible = (): Part[] => {
    const now = alive();
    if (many) {
      const moduleParts = now.filter((p) => p.modulePart && p.module!.path !== "");
      const dirs = now.filter((p) => p.kind === 2 && (!p.received || moduleParts.length === 0));
      return [...moduleParts, ...dirs];
    }
    const early = now.filter((p) => p.kind === 2 || (p.kind === 1 && !p.common));
    if (early.length > 0 || moduleCount !== 1) return early;
    return now.filter((p) => p.common);
  };
  const foldOrder = (a: Part, b: Part): number =>
    linesOf(a.files) - linesOf(b.files) || levelOf(b) - levelOf(a) || compareParts(a, b);
  while (alive().length > foldLimit) {
    const candidates = eligible();
    if (candidates.length === 0) break;
    const x = candidates.sort(foldOrder)[0]!;
    merge(x, target(x));
  }

  const final = [...alive().sort(compareParts), ...nameParts];
  const notes: Note[] = [];

  // ---- ids and zones ----
  const used = new Set<string>();
  for (const p of final) {
    let base: string;
    if (p.kind === 0) base = "top";
    else if (p.kind !== 1) base = normalizeId(p.path);
    else {
      const m = p.module!;
      const name = m.path === "" ? "top" : normalizeId(m.path);
      if (p.modulePart) base = name;
      else if (moduleCount >= 2) base = p.common ? name : normalizeId(`${name}-${p.path}`);
      else if (p.common) base = m.commonPackage === "" ? name : normalizeId(segs(m.commonPackage).at(-1)!);
      else base = normalizeId(p.path);
    }
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    p.id = id;
  }
  const zoneOf = (p: Part): string | undefined => {
    if (moduleCount === 0) return p.kind === 0 ? undefined : segs(p.path)[0];
    if (moduleCount === 1) return undefined;
    if (!many) return p.kind === 1 ? (p.module!.path === "" ? "top" : p.module!.path) : undefined;
    if (p.modulePart) return p.module!.path === "" ? "top" : segs(p.module!.path)[0];
    return p.kind === 2 ? segs(p.path)[0] : undefined;
  };

  // ---- mapper XML ----
  const resolve = (p: Part): Part => (p.forward ? resolve(p.forward) : p);
  const ownerOf = new Map<string, Part>();
  for (const p of final) for (const f of p.files) ownerOf.set(f.path, p);
  const codeLines = (p: Part) => linesOf(p.files);
  const mappers: MapperCounts = {
    namespace: 0, fileName: 0, package: 0, rest: 0, restFiles: [], outsidePattern: 0,
  };
  // Exact XML paths in a directory whose `*.xml` a part made from file names
  // holds: the owner writes them even inside its own `<dir>/**`, because the
  // `*.xml` is stronger than that.
  const underNamePattern = new Set<string>();
  for (const m of modules) {
    if (m.mappers.length === 0) continue;
    const packageParts = final
      .filter((p) => p.kind === 1 && !p.modulePart && p.module === m)
      .map((p) => ({ part: p, pkg: joinPath(m.commonPackage, p.path) }))
      .filter((x) => x.pkg !== "");
    const found = new Map<FileRec, Part>();
    for (const xml of m.mappers) {
      if (xml.outsidePattern) mappers.outsidePattern++;
      if (xml.namespace !== null) {
        const cls = xml.namespace.split(".").join("/");
        const file = m.code.find((f) => f.rel === `${cls}.java` || f.rel === `${cls}.kt`);
        if (file) {
          found.set(xml, ownerOf.get(file.path)!);
          mappers.namespace++;
          continue;
        }
      }
      const sameName = m.code.filter(
        (f) => ["java", "kt"].includes(extensionOf(f.path)) && stem(baseOf(f.path)) === stem(baseOf(xml.path)),
      );
      if (sameName.length === 1) {
        found.set(xml, ownerOf.get(sameName[0]!.path)!);
        mappers.fileName++;
        continue;
      }
      const dir = dirOf(xml.rel);
      let byPackage: { part: Part; pkg: string } | null = null;
      for (const x of packageParts) {
        if ((dir === x.pkg || isUnder(dir, x.pkg)) && (!byPackage || x.pkg.length > byPackage.pkg.length)) {
          byPackage = x;
        }
      }
      if (byPackage) {
        found.set(xml, byPackage.part);
        mappers.package++;
      }
    }
    // Most XML taken by namespace, file name or package; then more code lines; then id.
    const best = (candidates: Part[], counted: FileRec[]): Part | null => {
      const count = (p: Part) => counted.filter((x) => found.get(x) === p).length;
      const ranked = [...new Set(candidates)].sort(
        (a, b) => count(b) - count(a) || codeLines(b) - codeLines(a) || byCodeUnit(a.id, b.id),
      );
      return ranked[0] ?? null;
    };
    // When no other part holds files of the module, a part made from file
    // names stands for it: most XML taken, then more lines in this module,
    // then the word.
    const fromNames = (): Part => {
      const count = (p: Part) => m.mappers.filter((x) => found.get(x) === p).length;
      const lines = (p: Part) => linesOf(m.code.filter((f) => byName.get(f) === p));
      return [...new Set(m.code.map((f) => byName.get(f)!))].sort(
        (a, b) => count(b) - count(a) || lines(b) - lines(a) || byCodeUnit(a.path, b.path),
      )[0]!;
    };
    const representative =
      m.start !== null
        ? resolve(m.start)
        : (best(remaining(m.code).map((f) => ownerOf.get(f.path)!), m.mappers) ?? fromNames());
    const perDir = new Map<string, FileRec[]>();
    for (const xml of m.mappers) {
      const dir = dirOf(xml.rel);
      perDir.set(dir, [...(perDir.get(dir) ?? []), xml]);
    }
    const take = (part: Part, xml: FileRec) => {
      part.mapperFiles.push(xml);
      if (!found.has(xml)) {
        mappers.rest++;
        mappers.restFiles.push(xml.path);
      }
    };
    for (const dir of sorted(perDir.keys())) {
      const xmls = perDir.get(dir)!;
      if (dir === "") {
        for (const xml of xmls) {
          const owner = found.get(xml) ?? representative;
          owner.extra.push(asGlobLiteral(xml.path));
          take(owner, xml);
        }
        continue;
      }
      const taken = xmls.filter((x) => found.has(x));
      const holder = best(taken.map((x) => found.get(x)!), taken) ?? representative;
      holder.extra.push(`${asGlobLiteral(joinPath(m.resources!, dir))}/*.xml`);
      for (const xml of xmls) {
        const owner = found.get(xml) ?? holder;
        if (owner !== holder) owner.extra.push(asGlobLiteral(xml.path));
        if (owner !== holder && holder.kind === 3) underNamePattern.add(asGlobLiteral(xml.path));
        take(owner, xml);
      }
    }
    const prefix = m.path === "" ? "" : `${asGlobLiteral(m.path)}/`;
    representative.extra.push(
      `${prefix}src/main/resources/**/mapper/**/*.xml`,
      `${prefix}src/main/resources/**/*Mapper.xml`,
    );
  }
  mappers.restFiles.sort(byCodeUnit);

  // ---- part paths ----
  const pathsOf = (p: Part): string[] => {
    const globsUnderRoots = (files: FileRec[], pkg: string) =>
      sorted(files.filter((f) => f.root !== null).map((f) => f.root!)).map(
        (root) => `${asGlobLiteral(joinPath(root, pkg))}/**`,
      );
    let own: string[];
    if (p.kind === 0) {
      own = topHasAll(p)
        ? ["**"]
        : [
            ...[...p.topDirs].map((d) => `${asGlobLiteral(d)}/**`),
            ...p.files.filter((f) => !f.path.includes("/")).map((f) => asGlobLiteral(f.path)),
          ];
    } else if (p.kind === 2) {
      own =
        p.exactPaths && !p.received
          ? p.files.map((f) => asGlobLiteral(f.path))
          : [`${asGlobLiteral(p.path)}/**`];
    } else if (p.modulePart) {
      own = p.dirPattern ? [`${asGlobLiteral(p.module!.path)}/**`] : globsUnderRoots(p.files, "");
    } else if (p.kind === 3) {
      own = [];
    } else if (p.common && !p.received) {
      own = p.files.map((f) => asGlobLiteral(f.path));
    } else {
      own = globsUnderRoots(p.files, joinPath(p.module!.commonPackage, p.path));
    }
    const all = sorted([...own, ...p.extra]);
    // Drop what a `<dir>/**` (or `**`) of the same part already holds.
    const wide = all.filter((q) => q === "**" || q.endsWith("/**")).map((q) => q.slice(0, -2));
    return all.filter(
      (q) => underNamePattern.has(q) || !wide.some((w) => q !== `${w}**` && q.startsWith(w)),
    );
  };

  // ---- config ----
  const draftConfig: Draft["config"] = { languages };
  if (java && collected.length > 0) {
    const watch: string[] = [];
    const forRoot = (root: string) => codeExts.map((e) => `${root}/**/*.${e}`);
    if (moduleCount > 0) {
      if (!many) {
        for (const m of modules) {
          for (const root of sorted(m.code.map((f) => f.root!))) watch.push(...forRoot(asGlobLiteral(root)));
        }
      } else if (given !== null) {
        for (const root of given) watch.push(...forRoot(asGlobLiteral(root)));
      } else {
        watch.push(...languageRootWatch);
      }
      for (const m of modules) {
        if (m.mappers.length === 0) continue;
        const prefix = m.path === "" ? "" : `${asGlobLiteral(m.path)}/`;
        watch.push(
          `${prefix}src/main/resources/**/mapper/**/*.xml`,
          `${prefix}src/main/resources/**/*Mapper.xml`,
        );
        const outsidePattern = m.mappers.filter((x) => x.outsidePattern);
        for (const dir of sorted(outsidePattern.map((x) => dirOf(x.path)))) {
          const others = all.some((f) => {
            if (dirOf(f) !== dir || extensionOf(f) !== "xml" || baseOf(f).startsWith(".")) return false;
            return isMapperXml(repo, f, strip(f, m.resources!)) === null;
          });
          if (others) {
            for (const x of outsidePattern) if (dirOf(x.path) === dir) watch.push(asGlobLiteral(x.path));
          } else {
            watch.push(`${asGlobLiteral(dir)}/*.xml`);
          }
        }
      }
    }
    for (const f of outside) watch.push(asGlobLiteral(f.path));
    draftConfig.watch = sorted(watch);
    if (outside.length > 0) {
      notes.push({
        code: "exact-paths",
        files: outside.length,
        message:
          `${outside.length} files outside modules are listed in config.watch by exact path; ` +
          "a directory pattern can replace them",
      });
    }
  }
  if (given !== null) draftConfig.roots = sorted(given.map(asGlobLiteral));

  // ---- notes ----
  if (java && moduleCount === 1) {
    notes.push({ code: "no-zones", message: "one module, so no zone is proposed" });
  }
  if (final.length > maxParts) {
    const noFold = many ? "the root module part cannot fold" : "parts do not fold across modules";
    notes.push({
      code: "over-max-parts",
      parts: final.length,
      maxParts,
      message:
        `${final.length} parts, more than the maximum ${maxParts}: ` +
        (nameParts.length === 0
          ? noFold
          : `--parts-by-name made ${nameParts.length} of them` +
            (final.length - nameParts.length > foldLimit ? `, and ${noFold}` : "")),
    });
  }
  if (many) {
    const remaining = final.filter((p) => p.modulePart).length;
    notes.push({
      code: "modules",
      modules: moduleCount,
      notRemaining: moduleCount - remaining,
      message: `${moduleCount} modules; ${moduleCount - remaining} of them do not remain as module parts`,
    });
  }
  const javaCode = modules.flatMap((m) =>
    m.code
      .filter((f) => ["java", "kt"].includes(extensionOf(f.path)))
      .map((f) => ({ f, m })),
  );
  const layerFiles = javaCode.filter(({ f }) => layerOf(f) !== undefined).length;
  if (javaCode.length > 0 && layerFiles * 2 >= javaCode.length) {
    notes.push({
      code: "layers",
      layerFiles,
      files: javaCode.length,
      message:
        `${layerFiles} of ${javaCode.length} Java/Kotlin files sit in layer directories ` +
        "(controller, service, ...); parts here follow packages, not layers",
    });
  }
  if (options.partsByName !== null && nameParts.length > 0) {
    const files = nameParts.reduce((sum, p) => sum + p.files.length + p.mapperFiles.length, 0);
    notes.push({
      code: "parts-by-name",
      parts: nameParts.length,
      files,
      message:
        `${nameParts.length} parts come from the first word of file names in layer directories; ` +
        `they hold ${files} files`,
    });
  } else if (options.partsByName !== null) {
    notes.push({
      code: "no-parts-by-name",
      message:
        `no part comes from file names: no first word of a file name has ${options.partsByName} ` +
        `or more files under two or more of these names: ${[...LAYER_NAMES].join(", ")}`,
    });
  }
  if (fromBuildOutput > 0) {
    notes.push({
      code: "build-output",
      files: fromBuildOutput,
      message: `${fromBuildOutput} files under build-output directory names are measured because config.watch reaches them`,
    });
  }

  // ---- output ----
  const draftParts: DraftPart[] = final.map((p) => {
    const zone = zoneOf(p);
    return {
      id: p.id,
      name: p.kind === 3 ? p.path : p.id,
      ...(zone === undefined ? {} : { zone }),
      about: "",
      paths: pathsOf(p),
    };
  });
  const measured = final.map((p) => ({
    id: p.id,
    files: p.files.length + p.mapperFiles.length,
    lines: linesOf(p.files) + linesOf(p.mapperFiles),
  }));
  const result: Draft = {
    plan: { format: 1, name: "", about: "", parts: draftParts, externals: [], scenarios: [] },
    config: draftConfig,
    measure: {
      parts: measured,
      files: measured.reduce((s, p) => s + p.files, 0),
      lines: measured.reduce((s, p) => s + p.lines, 0),
    },
    sources: { languages: languageSource, ...(rootSource ? { roots: rootSource } : {}) },
    notes,
  };
  if (java) {
    result.modules = sorted(modules.map(moduleName));
    result.mappers = mappers;
  }
  return result;
}
