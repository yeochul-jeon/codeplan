// What the JS and TS files of the parts import. No parser: the text is read
// once with comments, string contents, template text and regular
// expression literals blanked out, and five regular expressions find the
// import paths in that text. The same expressions on the text as written
// find the import paths that only show when comments and strings are read
// too. Import paths are resolved on the disk, with the `paths` and
// `baseUrl` of the nearest tsconfig.json or jsconfig.json.
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";

// The files whose imports are read.
export const JS_READ = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"];
export const isJsRead = (path: string) => JS_READ.some((ext) => path.endsWith(ext));
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const isTs = (path: string) => path.endsWith(".ts") || path.endsWith(".tsx");

// The symbols and words after which a "/" starts a regular expression.
const REGEX_AFTER = new Set([
  ..."(,=:[!&|?{};+-*%<>~^",
  ..."return typeof case do else in of new delete void throw yield await instanceof".split(" "),
]);
const isWordChar = (c: string) => /[A-Za-z0-9_$]/.test(c);
const isLineEnd = (c: string) => c === "\n" || c === "\r";

// A token before the place being read: "" for none yet, a word, a symbol
// (one character), or LITERAL after a string, template or regular
// expression literal.
const LITERAL = "\0";

// The text with every character that is not a line break turned into a
// space inside comments, string contents (except in a module place),
// template text and regular expression literals.
export function erased(text: string): string {
  const out = text.split("");
  const n = text.length;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (!isLineEnd(out[k]!)) out[k] = " ";
  };
  let prev = "";
  let before = "";
  const push = (token: string) => {
    before = prev;
    prev = token;
  };
  // The text of a template from `start`: it ends after the closing
  // backtick, or after "${" with code to read next.
  const template = (start: number): { end: number; closed: boolean } => {
    for (let k = start; k < n; k++) {
      const c = text[k]!;
      if (c === "\\") k++;
      else if (c === "`") {
        blank(start, k);
        return { end: k + 1, closed: true };
      } else if (c === "$" && text[k + 1] === "{") {
        blank(start, k);
        return { end: k + 2, closed: false };
      }
    }
    blank(start, n);
    return { end: n, closed: true };
  };
  // One entry for each open "${": the braces opened inside it.
  const braces: number[] = [];
  const enterTemplate = (start: number): number => {
    const found = template(start);
    if (found.closed) push(LITERAL);
    else {
      braces.push(0);
      push("{");
    }
    return found.end;
  };

  let i = 0;
  while (i < n) {
    const c = text[i]!;
    const next = text[i + 1];
    if (/\s/.test(c)) {
      i++;
    } else if (c === "/" && next === "/") {
      let k = i;
      while (k < n && !isLineEnd(text[k]!)) k++;
      blank(i, k);
      i = k;
    } else if (c === "/" && next === "*") {
      const close = text.indexOf("*/", i + 2);
      const k = close < 0 ? n : close + 2;
      blank(i, k);
      i = k;
    } else if (c === "'" || c === '"') {
      let k = i + 1;
      while (k < n && text[k] !== c && !isLineEnd(text[k]!)) k += text[k] === "\\" ? 2 : 1;
      const end = Math.min(k, n);
      const modulePlace =
        prev === "from" || prev === "import" || (prev === "(" && (before === "import" || before === "require"));
      if (!modulePlace) blank(i + 1, end);
      i = end < n && text[end] === c ? end + 1 : end;
      push(LITERAL);
    } else if (c === "`") {
      i = enterTemplate(i + 1);
    } else if (c === "}" && braces.length > 0 && braces[braces.length - 1] === 0) {
      braces.pop();
      i = enterTemplate(i + 1);
    } else if (
      c === "/" &&
      text[i - 1] !== "<" &&
      next !== ">" &&
      (prev === "" || REGEX_AFTER.has(prev))
    ) {
      // A regular expression literal: to the next "/" on the line outside
      // a class, or to the end of the line when there is none.
      let k = i + 1;
      let inClass = false;
      let closed = false;
      while (k < n && !isLineEnd(text[k]!)) {
        const e = text[k]!;
        if (e === "\\") {
          k += k + 1 < n && !isLineEnd(text[k + 1]!) ? 2 : 1;
          continue;
        }
        if (inClass) {
          if (e === "]") inClass = false;
        } else if (e === "[") inClass = true;
        else if (e === "/") {
          closed = true;
          break;
        }
        k++;
      }
      blank(i + 1, k);
      i = closed ? k + 1 : k;
      push(LITERAL);
    } else if (isWordChar(c)) {
      let k = i;
      while (k < n && isWordChar(text[k]!)) k++;
      push(text.slice(i, k));
      i = k;
    } else {
      if (braces.length > 0) {
        if (c === "{") braces[braces.length - 1]!++;
        else if (c === "}") braces[braces.length - 1]!--;
      }
      push(c);
      i++;
    }
  }
  return out.join("");
}

const STATIC = /(?<![.\w$])(?:import|export)\s+(?:type\s+)?[\w*$\s{},]*?\s*from\s*(['"])([^'"\n]+)\1/g;
const SIDE = /(?<![.\w$])import\s*(['"])([^'"\n]+)\1/g;
const DYN = /(?<![.\w$])import\s*\(\s*(['"])([^'"\n]+)\1\s*[,)]/g;
const REQ = /(?<![.\w$])require\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g;
const REQ_TS = /(?<![.\w$])import\s+[\w$]+\s*=\s*require\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g;

export interface Found {
  path: string;
  // Where the match starts in the text.
  at: number;
}

// The import paths the expressions find in a text, expression by
// expression, each in text order.
export function importPaths(text: string, ts: boolean): Found[] {
  const out: Found[] = [];
  for (const expression of [STATIC, SIDE, DYN, ts ? REQ_TS : REQ]) {
    for (const match of text.matchAll(expression)) out.push({ path: match[2]!, at: match.index });
  }
  return out;
}

// The import paths of a file: in the blanked text, and only in the text as
// written (the written ones less the blanked ones, as many times as they
// are there). Each import path that is only in the written text comes once,
// at its first place in the written text.
export function fileImports(text: string, ts: boolean): { read: Found[]; onlyWritten: Found[] } {
  const read = importPaths(erased(text), ts);
  const left = new Map<string, number>();
  for (const f of read) left.set(f.path, (left.get(f.path) ?? 0) + 1);
  const firstAt = new Map<string, number>();
  const extra = new Set<string>();
  for (const f of importPaths(text, ts)) {
    firstAt.set(f.path, Math.min(firstAt.get(f.path) ?? f.at, f.at));
    const count = left.get(f.path) ?? 0;
    if (count > 0) left.set(f.path, count - 1);
    else extra.add(f.path);
  }
  const onlyWritten = [...extra].map((path) => ({ path, at: firstAt.get(path)! })).sort((a, b) => a.at - b.at);
  return { read, onlyWritten };
}

// JSON with "//" and "/* */" comments and a comma before "}" or "]".
// Undefined when the text is not that. Strings are matched first, so what
// is inside them stays as it is.
const STRING = String.raw`"(?:\\.|[^"\\])*"`;
const COMMENT = new RegExp(String.raw`${STRING}|//[^\n\r]*|/\*[\s\S]*?(?:\*/|$)`, "g");
const LAST_COMMA = new RegExp(String.raw`${STRING}|,(?=\s*[}\]])`, "g");
export function parseConfigJson(text: string): unknown {
  const plain = text.replace(COMMENT, (m) => (m[0] === '"' ? m : " ")).replace(LAST_COMMA, (m) => (m[0] === '"' ? m : ""));
  try {
    return JSON.parse(plain);
  } catch {
    return undefined;
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

// The aliases a config gives: `baseUrl` as a directory from the repository
// root, and `paths` with the directory its values start from.
interface Aliases {
  baseUrl?: string;
  paths?: { entries: [string, string[]][]; dir: string };
}

export interface ConfigFinding {
  code: "tsconfig-not-read" | "tsconfig-references-not-followed";
  path: string;
  message: string;
}

export interface JsFacts {
  // The JS and TS files read.
  files: number;
  // (file, import path) pairs that look relative or match a `paths` key
  // and reach no file.
  notResolved: number;
  // Import pairs: part A, then part B, then the first file of A (by code
  // unit) with an import of a file of B.
  pairs: Map<string, Map<string, string>>;
  // The same for import paths found only in the text as written: part A,
  // then part B, then the first such file of A and its first import path
  // that reaches B.
  onlyWritten: Map<string, Map<string, { file: string; path: string }>>;
  // Config findings, by code, then by path.
  configs: ConfigFinding[];
}

const isOutside = (path: string) => /^(\.\.(\/|$)|\/)/.test(path);

// `owners` has every watched file in code unit order with the one part that
// owns it; `texts` has the JS and TS files among them that have one owner.
export function jsFacts(
  repo: string,
  owners: Map<string, string | null>,
  texts: Map<string, string>,
  isFile: (path: string) => boolean,
): JsFacts {
  const fileCache = new Map<string, boolean>();
  const fileThere = (path: string): boolean => {
    if (isOutside(path)) return false;
    if (!fileCache.has(path)) fileCache.set(path, isFile(path));
    return fileCache.get(path)!;
  };
  const reasons = new Map<string, string>();
  const note = (path: string, reason: string) => {
    if (!reasons.has(path)) reasons.set(path, reason);
  };
  const references = new Set<string>();

  // A config file read with its relative `extends` line. `line` holds the
  // files from the first one to this one, to stop at a loop.
  const parsed = new Map<string, unknown>();
  const read = (path: string): unknown => {
    if (!parsed.has(path)) {
      let value: unknown;
      try {
        value = parseConfigJson(readFileSync(join(repo, path), "utf8"));
      } catch {
        value = undefined;
      }
      parsed.set(path, isObj(value) ? value : undefined);
    }
    return parsed.get(path);
  };
  const load = (path: string, line: string[]): Aliases | null => {
    const value = read(path) as Obj | undefined;
    if (value === undefined) {
      note(path, "it is not JSON");
      return null;
    }
    const dir = posix.dirname(path);
    let aliases: Aliases = {};
    const written = typeof value.extends === "string" ? [value.extends] : Array.isArray(value.extends) ? value.extends : [];
    for (const target of written) {
      if (typeof target !== "string" || !(target.startsWith("./") || target.startsWith("../"))) continue;
      let file = posix.join(dir, target);
      if (!fileThere(file) && !file.endsWith(".json") && fileThere(`${file}.json`)) file = `${file}.json`;
      if (!fileThere(file)) {
        note(path, `extends ${JSON.stringify(target)} is not a file`);
        continue;
      }
      if (line.includes(file)) continue;
      const parent = load(file, [...line, file]);
      if (parent !== null) aliases = { ...aliases, ...parent };
    }
    const options = isObj(value.compilerOptions) ? value.compilerOptions : {};
    if (typeof options.baseUrl === "string") aliases = { ...aliases, baseUrl: posix.join(dir, options.baseUrl) };
    if (isObj(options.paths)) {
      const entries = Object.entries(options.paths).map(([key, values]): [string, string[]] => [
        key,
        Array.isArray(values) ? values.filter((v): v is string => typeof v === "string") : [],
      ]);
      aliases = { ...aliases, paths: { entries, dir } };
    }
    return aliases;
  };

  // The config of the files in a directory: the nearest tsconfig.json, or
  // a jsconfig.json beside no tsconfig.json; null for none.
  const configOf = new Map<string, Aliases | null>();
  const configFor = (dir: string): Aliases | null => {
    if (configOf.has(dir)) return configOf.get(dir)!;
    const place = (name: string) => (dir === "." ? name : `${dir}/${name}`);
    let aliases: Aliases | null;
    const file = [place("tsconfig.json"), place("jsconfig.json")].find(fileThere);
    if (file !== undefined) {
      aliases = load(file, [file]);
      const value = read(file) as Obj | undefined;
      if (
        aliases !== null &&
        Array.isArray(value?.references) &&
        value.references.length > 0 &&
        aliases.baseUrl === undefined &&
        aliases.paths === undefined
      ) {
        references.add(file);
      }
    } else aliases = dir === "." ? null : configFor(posix.dirname(dir));
    configOf.set(dir, aliases);
    return aliases;
  };

  // The first regular file among the candidates of one path.
  const fileFor = (path: string): string | null => {
    const tries: string[] = [];
    if (path.endsWith(".js")) tries.push(...[".ts", ".tsx", ".d.ts"].map((e) => path.slice(0, -3) + e));
    else if (path.endsWith(".jsx")) tries.push(...[".tsx", ".d.ts"].map((e) => path.slice(0, -4) + e));
    const exts = [".ts", ".tsx", ".d.ts", ".js", ".jsx"];
    tries.push(path, ...exts.map((e) => path + e), ...exts.map((e) => posix.join(path, `index${e}`)));
    return tries.map((p) => posix.normalize(p)).find(fileThere) ?? null;
  };
  // A file for an import path; "missing" when it looks relative or matches
  // a `paths` key and reaches no file; null when it is left (a package).
  const resolve = (from: string, path: string): string | "missing" | null => {
    if (/^\.\.?(\/|$)/.test(path)) {
      return fileFor(posix.join(posix.dirname(from), path)) ?? "missing";
    }
    const aliases = configFor(posix.dirname(from));
    if (aliases === null) return null;
    if (aliases.paths !== undefined) {
      let key: [string, string[]] | undefined = aliases.paths.entries.find(([k]) => !k.includes("*") && k === path);
      let star = "";
      if (key === undefined) {
        let longest = -1;
        for (const entry of aliases.paths.entries) {
          const parts = entry[0].split("*");
          if (parts.length !== 2) continue;
          const [head, tail] = parts as [string, string];
          if (path.length < head.length + tail.length || !path.startsWith(head) || !path.endsWith(tail)) continue;
          if (head.length > longest) {
            longest = head.length;
            key = entry;
            star = path.slice(head.length, path.length - tail.length);
          }
        }
      }
      if (key !== undefined) {
        const base = aliases.baseUrl ?? aliases.paths.dir;
        for (const value of key[1]) {
          if (value.startsWith("/")) continue;
          const found = fileFor(posix.join(base, key[0].includes("*") ? value.replace("*", star) : value));
          if (found !== null) return found;
        }
        return "missing";
      }
    }
    if (aliases.baseUrl !== undefined) return fileFor(posix.join(aliases.baseUrl, path));
    return null;
  };

  let notResolved = 0;
  const pairs = new Map<string, Map<string, string>>();
  const onlyWritten = new Map<string, Map<string, { file: string; path: string }>>();
  const ownerOf = (file: string | "missing" | null): string | null =>
    file === null || file === "missing" ? null : (owners.get(file) ?? null);
  // The first value for a pair of different parts is kept.
  const add = <T>(map: Map<string, Map<string, T>>, from: string, to: string | null, value: T) => {
    if (to === null || to === from) return;
    const row = map.get(from) ?? new Map<string, T>();
    map.set(from, row);
    if (!row.has(to)) row.set(to, value);
  };
  for (const [file, text] of texts) {
    const from = owners.get(file)!;
    // The config of every file read is read, for its findings.
    configFor(posix.dirname(file));
    const found = fileImports(text, isTs(file));
    const counted = new Set<string>();
    for (const f of found.read) {
      const target = resolve(file, f.path);
      if (target === "missing" && !counted.has(f.path)) {
        counted.add(f.path);
        notResolved++;
      }
      add(pairs, from, ownerOf(target), file);
    }
    for (const f of found.onlyWritten) add(onlyWritten, from, ownerOf(resolve(file, f.path)), { file, path: f.path });
  }

  // "tsconfig-not-read" sorts before "tsconfig-references-not-followed".
  const configs: ConfigFinding[] = [
    ...[...reasons.keys()].sort(byCodeUnit).map((path): ConfigFinding => ({
      code: "tsconfig-not-read",
      path,
      message: `${path} is not read: ${reasons.get(path)}`,
    })),
    ...[...references].sort(byCodeUnit).map((path): ConfigFinding => ({
      code: "tsconfig-references-not-followed",
      path,
      message: `${path} has references, which are not followed, and no paths or baseUrl, so aliases in the referenced configs are not used`,
    })),
  ];
  return { files: texts.size, notResolved, pairs, onlyWritten, configs };
}
