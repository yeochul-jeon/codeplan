// src/cli.ts
import { closeSync, lstatSync as lstatSync5, mkdirSync, openSync, readFileSync as readFileSync8, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { basename, dirname, join as join8, resolve } from "node:path";

// src/config.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// src/glob.ts
var REGEX_SPECIAL = /[\\^$.|+()[\]{}*?]/g;
function escapeRegex(text) {
  return text.replace(REGEX_SPECIAL, "\\$&");
}
function closeOfSet(pattern, start) {
  return pattern.indexOf("]", start + 2);
}
function closeOfBrace(pattern, start) {
  let depth = 0;
  for (let i = start; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "[") {
      const end = closeOfSet(pattern, i);
      if (end !== -1) i = end;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
function splitAlternatives(body) {
  const parts = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "[") {
      const end = closeOfSet(body, i);
      if (end !== -1) i = end;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
    } else if (c === "," && depth === 0) {
      parts.push(body.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(body.slice(from));
  return parts;
}
function setToRegex(content) {
  if (content.length === 1) return escapeRegex(content);
  let negate = false;
  let body = content;
  if (body[0] === "!" || body[0] === "^") {
    negate = true;
    body = body.slice(1);
  }
  const inner = body.replace(/[\\\]\[^]/g, "\\$&");
  return negate ? `[^/${inner}]` : `[${inner}]`;
}
var SEGMENT = "(?!\\.)[^/]*";
function toRegexSource(pattern, startsSegment = true) {
  let out = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    const atSegmentStart = i === 0 ? startsSegment : pattern[i - 1] === "/";
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        const next = pattern[i + 2];
        if (atSegmentStart && next === "/") {
          out += `(?:${SEGMENT}/)*`;
          i += 3;
          continue;
        }
        if (atSegmentStart && next === void 0) {
          out += `${SEGMENT}(?:/${SEGMENT})*`;
          i += 2;
          continue;
        }
        out += atSegmentStart ? SEGMENT : "[^/]*";
        i += 2;
        continue;
      }
      out += atSegmentStart ? SEGMENT : "[^/]*";
      i++;
    } else if (c === "?") {
      out += atSegmentStart ? "[^/.]" : "[^/]";
      i++;
    } else if (c === "[") {
      const end = closeOfSet(pattern, i);
      if (end === -1) {
        out += escapeRegex(c);
        i++;
      } else {
        out += setToRegex(pattern.slice(i + 1, end));
        i = end + 1;
      }
    } else if (c === "{") {
      const end = closeOfBrace(pattern, i);
      if (end === -1) {
        out += escapeRegex(c);
        i++;
      } else {
        const alternatives = splitAlternatives(pattern.slice(i + 1, end));
        const inner = alternatives.map((a) => toRegexSource(a, atSegmentStart));
        out += `(?:${inner.join("|")})`;
        i = end + 1;
      }
    } else {
      out += escapeRegex(c);
      i++;
    }
  }
  return out;
}
function compileGlob(pattern) {
  return new RegExp(`^${toRegexSource(pattern)}$`);
}
function fixedHead(pattern) {
  let out = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "*" || c === "?") return out;
    if (c === "{") {
      if (closeOfBrace(pattern, i) !== -1) return out;
    } else if (c === "[") {
      const end = closeOfSet(pattern, i);
      if (end !== -1) {
        if (end !== i + 2) return out;
        out += pattern[i + 1];
        i = end + 1;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}
function strength(pattern) {
  return fixedHead(pattern).length;
}
var GlobSet = class {
  regexes;
  constructor(patterns) {
    this.regexes = patterns.map(compileGlob);
  }
  matches(path) {
    return this.regexes.some((r) => r.test(path));
  }
};

// src/config.ts
var LANGUAGES = {
  js: {
    detect: ["package.json"],
    codeExts: ["astro", "cjs", "js", "jsx", "mjs", "svelte", "ts", "tsx", "vue"],
    dependencyDirs: ["node_modules"],
    buildOutputDirs: ["dist", "build", ".next", ".nuxt", ".svelte-kit", "out", "coverage"],
    mainRootGlobs: [],
    testRootGlobs: [],
    testPatterns: ["**/test/**", "**/tests/**", "**/__tests__/**", "**/*.test.*", "**/*.spec.*"],
    mapperPatterns: []
  },
  java: {
    detect: ["pom.xml", "build.gradle", "build.gradle.kts"],
    codeExts: ["java", "kt"],
    dependencyDirs: [],
    buildOutputDirs: ["target", "build", "out", ".gradle"],
    mainRootGlobs: ["**/src/main/java", "**/src/main/kotlin"],
    testRootGlobs: ["**/src/test/java", "**/src/test/kotlin"],
    testPatterns: ["**/src/test/**"],
    mapperPatterns: [
      "**/src/main/resources/**/mapper/**/*.xml",
      "**/src/main/resources/**/*Mapper.xml"
    ]
  }
};
var LANGUAGE_NAMES = Object.keys(LANGUAGES).sort();
var SettingsError = class extends Error {
};
var KEYS = ["languages", "watch", "skip", "roots", "tests", "home", "page"];
var CONFIG_FILE = "codeplan.json";
function detectLanguages(repo) {
  const found = LANGUAGE_NAMES.filter(
    (name) => LANGUAGES[name].detect.some((file) => existsSync(join(repo, file)))
  );
  return found.length > 0 ? found : ["js"];
}
function stringArray(raw, key) {
  const value = raw[key];
  if (value === void 0) return void 0;
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new SettingsError(`\`${key}\` must be an array of strings`);
  }
  return value;
}
function isPathForm(path) {
  return !path.includes("\\") && path.split("/").every((s) => s !== "" && s !== "." && s !== "..");
}
function isUnder(path, dir) {
  return path.startsWith(dir + "/");
}
function readConfig(repo) {
  const file = join(repo, CONFIG_FILE);
  let raw = {};
  if (existsSync(file)) {
    try {
      raw = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      throw new SettingsError(`${CONFIG_FILE} is not valid JSON: ${e.message}`);
    }
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new SettingsError(`${CONFIG_FILE} must hold a JSON object`);
  }
  const obj = raw;
  for (const key of Object.keys(obj)) {
    if (!KEYS.includes(key)) {
      throw new SettingsError(`unknown key \`${key}\`; known keys: ${KEYS.join(", ")}`);
    }
  }
  let languages;
  const languageList = stringArray(obj, "languages");
  if (languageList === void 0) {
    languages = detectLanguages(repo);
  } else {
    if (languageList.length === 0) throw new SettingsError("`languages` must not be empty");
    for (const name of languageList) {
      if (!LANGUAGE_NAMES.includes(name)) {
        throw new SettingsError(
          `\`languages\` has unknown language "${name}"; known: ${LANGUAGE_NAMES.join(", ")}`
        );
      }
    }
    if (new Set(languageList).size !== languageList.length) {
      throw new SettingsError("`languages` lists a language more than once");
    }
    languages = [...languageList].sort();
  }
  if (obj.tests !== void 0 && typeof obj.tests !== "boolean") {
    throw new SettingsError("`tests` must be true or false");
  }
  const tests = obj.tests === true;
  for (const key of ["home", "page"]) {
    if (obj[key] !== void 0 && typeof obj[key] !== "string") {
      throw new SettingsError(`\`${key}\` must be a string`);
    }
  }
  const home = obj.home ?? "docs/codeplan";
  if (!isPathForm(home)) {
    throw new SettingsError(
      `\`home\` "${home}" must be a directory inside the repository, written as parts joined by "/" with no empty, "." or ".." part and no backslash`
    );
  }
  const page = obj.page ?? `${home}/codeplan.html`;
  if (!isPathForm(page)) {
    throw new SettingsError(
      `\`page\` "${page}" must be a path inside the repository, written as parts joined by "/" with no empty, "." or ".." part and no backslash`
    );
  }
  if (!isUnder(page, home)) {
    throw new SettingsError(`\`page\` "${page}" must be under home "${home}"`);
  }
  const watch = stringArray(obj, "watch") ?? null;
  for (const pattern of watch ?? []) {
    const prefix = fixedHead(pattern);
    if (prefix === home || isUnder(prefix, home)) {
      throw new SettingsError(`\`watch\` pattern "${pattern}" starts inside home "${home}"`);
    }
  }
  const roots = stringArray(obj, "roots") ?? languages.flatMap((l) => [
    ...LANGUAGES[l].mainRootGlobs,
    ...tests ? LANGUAGES[l].testRootGlobs : []
  ]);
  return {
    languages,
    watch,
    skip: stringArray(obj, "skip") ?? [],
    roots,
    tests,
    home,
    page
  };
}

// src/draft.ts
import { existsSync as existsSync2, lstatSync as lstatSync2, readFileSync as readFileSync4 } from "node:fs";
import { join as join4 } from "node:path";

// src/lines.ts
function lineTotal(bytes) {
  let count2 = 0;
  for (const b of bytes) if (b === 10) count2++;
  if (bytes.length > 0 && bytes[bytes.length - 1] !== 10) count2++;
  return count2;
}

// src/measure.ts
import { lstatSync, readdirSync, readFileSync as readFileSync3 } from "node:fs";
import { join as join3 } from "node:path";

// src/imports.ts
var PIECE = String.raw`[\p{L}_$][\p{L}\p{N}_$]*`;
var NAME = String.raw`${PIECE}(?:\.${PIECE})*`;
var PACKAGE_LINE = new RegExp(String.raw`^[ \t]*package[ \t]+(${NAME})[ \t]*;`, "u");
var IMPORT_LINE = new RegExp(String.raw`^[ \t]*import[ \t]+(static[ \t]+)?(${NAME})(\.\*)?[ \t]*;`, "u");
function javaFile(text) {
  let pack = null;
  const imports = [];
  for (const line of text.split("\n")) {
    if (pack === null) pack = PACKAGE_LINE.exec(line)?.[1] ?? null;
    const found = IMPORT_LINE.exec(line);
    if (found !== null) imports.push({ name: found[2], isStatic: found[1] !== void 0, all: found[3] !== void 0 });
  }
  return { package: pack, imports };
}
function importFacts(owners, java) {
  const byName = /* @__PURE__ */ new Map();
  const byPackage = /* @__PURE__ */ new Map();
  const packages = /* @__PURE__ */ new Map();
  for (const [path, file] of java) {
    const base = path.slice(path.lastIndexOf("/") + 1, -".java".length);
    const name = file.package === null ? base : `${file.package}.${base}`;
    byName.set(name, byName.has(name) ? null : path);
    const owner = owners.get(path);
    const set = packages.get(owner) ?? /* @__PURE__ */ new Set();
    packages.set(owner, set);
    if (file.package !== null) {
      set.add(file.package);
      byPackage.set(file.package, [...byPackage.get(file.package) ?? [], path]);
    }
  }
  const typeFile = (name) => {
    for (let n = name; ; n = n.slice(0, n.lastIndexOf("."))) {
      if (byName.has(n)) return byName.get(n);
      if (!n.includes(".")) return null;
    }
  };
  const pairs = /* @__PURE__ */ new Map();
  const possible = /* @__PURE__ */ new Map();
  for (const [path, file] of java) {
    const from = owners.get(path);
    for (const found of file.imports) {
      const inPackage = !found.isStatic && found.all ? byPackage.get(found.name) : void 0;
      if (inPackage !== void 0) {
        const set = possible.get(from) ?? /* @__PURE__ */ new Set();
        possible.set(from, set);
        for (const other of inPackage) set.add(owners.get(other));
        continue;
      }
      const target = typeFile(found.name);
      if (target === null) continue;
      const to = owners.get(target);
      if (to === from) continue;
      const row = pairs.get(from) ?? /* @__PURE__ */ new Map();
      pairs.set(from, row);
      if (!row.has(to)) row.set(to, path);
    }
  }
  return { pairs, possible, packages };
}

// src/jsimports.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { join as join2, posix } from "node:path";
var JS_READ = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"];
var isJsRead = (path) => JS_READ.some((ext) => path.endsWith(ext));
var byCodeUnit = (a, b) => a < b ? -1 : a > b ? 1 : 0;
var isTs = (path) => path.endsWith(".ts") || path.endsWith(".tsx");
var REGEX_AFTER = /* @__PURE__ */ new Set([
  ..."(,=:[!&|?{};+-*%<>~^",
  ..."return typeof case do else in of new delete void throw yield await instanceof".split(" ")
]);
var isWordChar = (c) => /[A-Za-z0-9_$]/.test(c);
var isLineEnd = (c) => c === "\n" || c === "\r";
var LITERAL = "\0";
function erased(text) {
  const out = text.split("");
  const n = text.length;
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (!isLineEnd(out[k])) out[k] = " ";
  };
  let prev = "";
  let before = "";
  const push = (token) => {
    before = prev;
    prev = token;
  };
  const template = (start) => {
    for (let k = start; k < n; k++) {
      const c = text[k];
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
  const braces = [];
  const enterTemplate = (start) => {
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
    const c = text[i];
    const next = text[i + 1];
    if (/\s/.test(c)) {
      i++;
    } else if (c === "/" && next === "/") {
      let k = i;
      while (k < n && !isLineEnd(text[k])) k++;
      blank(i, k);
      i = k;
    } else if (c === "/" && next === "*") {
      const close = text.indexOf("*/", i + 2);
      const k = close < 0 ? n : close + 2;
      blank(i, k);
      i = k;
    } else if (c === "'" || c === '"') {
      let k = i + 1;
      while (k < n && text[k] !== c && !isLineEnd(text[k])) k += text[k] === "\\" ? 2 : 1;
      const end = Math.min(k, n);
      const modulePlace = prev === "from" || prev === "import" || prev === "(" && (before === "import" || before === "require");
      if (!modulePlace) blank(i + 1, end);
      i = end < n && text[end] === c ? end + 1 : end;
      push(LITERAL);
    } else if (c === "`") {
      i = enterTemplate(i + 1);
    } else if (c === "}" && braces.length > 0 && braces[braces.length - 1] === 0) {
      braces.pop();
      i = enterTemplate(i + 1);
    } else if (c === "/" && text[i - 1] !== "<" && next !== ">" && (prev === "" || REGEX_AFTER.has(prev))) {
      let k = i + 1;
      let inClass = false;
      let closed = false;
      while (k < n && !isLineEnd(text[k])) {
        const e = text[k];
        if (e === "\\") {
          k += k + 1 < n && !isLineEnd(text[k + 1]) ? 2 : 1;
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
      while (k < n && isWordChar(text[k])) k++;
      push(text.slice(i, k));
      i = k;
    } else {
      if (braces.length > 0) {
        if (c === "{") braces[braces.length - 1]++;
        else if (c === "}") braces[braces.length - 1]--;
      }
      push(c);
      i++;
    }
  }
  return out.join("");
}
var STATIC = /(?<![.\w$])(?:import|export)\s+(?:type\s+)?[\w*$\s{},]*?\s*from\s*(['"])([^'"\n]+)\1/g;
var SIDE = /(?<![.\w$])import\s*(['"])([^'"\n]+)\1/g;
var DYN = /(?<![.\w$])import\s*\(\s*(['"])([^'"\n]+)\1\s*[,)]/g;
var REQ = /(?<![.\w$])require\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g;
var REQ_TS = /(?<![.\w$])import\s+[\w$]+\s*=\s*require\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g;
function pathsFound(text, ts) {
  const out = [];
  for (const expression of [STATIC, SIDE, DYN, ts ? REQ_TS : REQ]) {
    for (const match of text.matchAll(expression)) out.push({ path: match[2], at: match.index });
  }
  return out;
}
function fileImports(text, ts) {
  const read = pathsFound(erased(text), ts);
  const left = /* @__PURE__ */ new Map();
  for (const f of read) left.set(f.path, (left.get(f.path) ?? 0) + 1);
  const firstAt = /* @__PURE__ */ new Map();
  const extra = /* @__PURE__ */ new Set();
  for (const f of pathsFound(text, ts)) {
    firstAt.set(f.path, Math.min(firstAt.get(f.path) ?? f.at, f.at));
    const count2 = left.get(f.path) ?? 0;
    if (count2 > 0) left.set(f.path, count2 - 1);
    else extra.add(f.path);
  }
  const onlyWritten = [...extra].map((path) => ({ path, at: firstAt.get(path) })).sort((a, b) => a.at - b.at);
  return { read, onlyWritten };
}
var STRING = String.raw`"(?:\\.|[^"\\])*"`;
var COMMENT = new RegExp(String.raw`${STRING}|//[^\n\r]*|/\*[\s\S]*?(?:\*/|$)`, "g");
var LAST_COMMA = new RegExp(String.raw`${STRING}|,(?=\s*[}\]])`, "g");
function parseConfigJson(text) {
  const plain2 = text.replace(COMMENT, (m) => m[0] === '"' ? m : " ").replace(LAST_COMMA, (m) => m[0] === '"' ? m : "");
  try {
    return JSON.parse(plain2);
  } catch {
    return void 0;
  }
}
var isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var isOutside = (path) => /^(\.\.(\/|$)|\/)/.test(path);
function jsFacts(repo, owners, texts, isFile) {
  const fileCache = /* @__PURE__ */ new Map();
  const fileThere = (path) => {
    if (isOutside(path)) return false;
    if (!fileCache.has(path)) fileCache.set(path, isFile(path));
    return fileCache.get(path);
  };
  const reasons = /* @__PURE__ */ new Map();
  const note = (path, reason) => {
    if (!reasons.has(path)) reasons.set(path, reason);
  };
  const references = /* @__PURE__ */ new Set();
  const parsed = /* @__PURE__ */ new Map();
  const read = (path) => {
    if (!parsed.has(path)) {
      let value;
      try {
        value = parseConfigJson(readFileSync2(join2(repo, path), "utf8"));
      } catch {
        value = void 0;
      }
      parsed.set(path, isObj(value) ? value : void 0);
    }
    return parsed.get(path);
  };
  const load = (path, line) => {
    const value = read(path);
    if (value === void 0) {
      note(path, "it is not JSON");
      return null;
    }
    const dir = posix.dirname(path);
    let aliases = {};
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
      const entries = Object.entries(options.paths).filter(([, values]) => Array.isArray(values)).map(([key, values]) => [key, values.filter((v) => typeof v === "string")]);
      aliases = { ...aliases, paths: { entries, dir } };
    }
    return aliases;
  };
  const configOf2 = /* @__PURE__ */ new Map();
  const configFor = (dir) => {
    if (configOf2.has(dir)) return configOf2.get(dir);
    const place = (name) => dir === "." ? name : `${dir}/${name}`;
    let aliases;
    const file = [place("tsconfig.json"), place("jsconfig.json")].find(fileThere);
    if (file !== void 0) {
      aliases = load(file, [file]);
      const value = read(file);
      if (aliases !== null && Array.isArray(value?.references) && value.references.length > 0 && aliases.baseUrl === void 0 && aliases.paths === void 0) {
        references.add(file);
      }
    } else aliases = dir === "." ? null : configFor(posix.dirname(dir));
    configOf2.set(dir, aliases);
    return aliases;
  };
  const fileFor = (path) => {
    const tries = [];
    if (path.endsWith(".js")) tries.push(...[".ts", ".tsx", ".d.ts"].map((e) => path.slice(0, -3) + e));
    else if (path.endsWith(".jsx")) tries.push(...[".tsx", ".d.ts"].map((e) => path.slice(0, -4) + e));
    const exts = [".ts", ".tsx", ".d.ts", ".js", ".jsx"];
    tries.push(path, ...exts.map((e) => path + e), ...exts.map((e) => posix.join(path, `index${e}`)));
    return tries.map((p2) => posix.normalize(p2)).find(fileThere) ?? null;
  };
  const resolve2 = (from, path) => {
    if (/^\.\.?(\/|$)/.test(path)) {
      return fileFor(posix.join(posix.dirname(from), path)) ?? "missing";
    }
    const aliases = configFor(posix.dirname(from));
    if (aliases === null || path.startsWith("/")) return null;
    if (aliases.paths !== void 0) {
      let key = aliases.paths.entries.find(([k]) => !k.includes("*") && k === path);
      let star = "";
      if (key === void 0) {
        let longest = -1;
        for (const entry of aliases.paths.entries) {
          const parts = entry[0].split("*");
          if (parts.length !== 2) continue;
          const [head, tail] = parts;
          if (path.length < head.length + tail.length || !path.startsWith(head) || !path.endsWith(tail)) continue;
          if (head.length > longest) {
            longest = head.length;
            key = entry;
            star = path.slice(head.length, path.length - tail.length);
          }
        }
      }
      if (key !== void 0) {
        const base = aliases.baseUrl ?? aliases.paths.dir;
        for (const value of key[1]) {
          if (value.startsWith("/")) continue;
          const found = fileFor(posix.join(base, key[0].includes("*") ? value.replace("*", star) : value));
          if (found !== null) return found;
        }
        return "missing";
      }
    }
    if (aliases.baseUrl !== void 0) return fileFor(posix.join(aliases.baseUrl, path));
    return null;
  };
  let notResolved = 0;
  const pairs = /* @__PURE__ */ new Map();
  const onlyWritten = /* @__PURE__ */ new Map();
  const ownerOf = (file) => file === null || file === "missing" ? null : owners.get(file) ?? null;
  const add = (map, from, to, value) => {
    if (to === null || to === from) return;
    const row = map.get(from) ?? /* @__PURE__ */ new Map();
    map.set(from, row);
    if (!row.has(to)) row.set(to, value);
  };
  for (const [file, text] of texts) {
    const from = owners.get(file);
    configFor(posix.dirname(file));
    const found = fileImports(text, isTs(file));
    const counted = /* @__PURE__ */ new Set();
    for (const f of found.read) {
      const target = resolve2(file, f.path);
      if (target === "missing" && !counted.has(f.path)) {
        counted.add(f.path);
        notResolved++;
      }
      add(pairs, from, ownerOf(target), file);
    }
    for (const f of found.onlyWritten) add(onlyWritten, from, ownerOf(resolve2(file, f.path)), { file, path: f.path });
  }
  const configs = [
    ...[...reasons.keys()].sort(byCodeUnit).map((path) => ({
      code: "tsconfig-not-read",
      path,
      message: `${path} is not read: ${reasons.get(path)}`
    })),
    ...[...references].sort(byCodeUnit).map((path) => ({
      code: "tsconfig-references-not-followed",
      path,
      message: `${path} has references, which are not followed, and no paths or baseUrl, so aliases in the referenced configs are not used`
    }))
  ];
  return { files: texts.size, notResolved, pairs, onlyWritten, configs };
}

// src/measure.ts
var byCodeUnit2 = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function listFiles(repo, prunedDirs) {
  const out = [];
  const visit = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = prefix + entry.name;
      if (entry.isDirectory()) {
        if (!prunedDirs.has(entry.name)) visit(join3(dir, entry.name), path + "/");
      } else if (entry.isFile()) {
        out.push(path);
      }
    }
  };
  visit(repo, "");
  return out.sort(byCodeUnit2);
}
function extensionOf(path) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1);
}
function hasDotSegment(path) {
  return path.split("/").some((s) => s.startsWith("."));
}
var Rules = class {
  constructor(config) {
    this.config = config;
    const rules = config.languages.map((l) => LANGUAGES[l]);
    this.prunedDirs = /* @__PURE__ */ new Set([".git", ...rules.flatMap((r) => r.dependencyDirs)]);
    this.buildOutputDirs = new Set(rules.flatMap((r) => r.buildOutputDirs));
    this.codeExtSet = new Set(rules.flatMap((r) => r.codeExts));
    this.roots = new GlobSet(config.roots);
    this.mappers = new GlobSet(rules.flatMap((r) => r.mapperPatterns));
    this.userWatch = config.watch === null ? null : new GlobSet(config.watch);
    this.skip = new GlobSet(config.skip);
    this.testRules = rules.map((r) => ({
      codeExts: new Set(r.codeExts),
      patterns: new GlobSet(r.testPatterns)
    }));
    this.javaTests = config.languages.includes("java") ? new GlobSet(LANGUAGES.java.testPatterns) : null;
  }
  config;
  prunedDirs;
  buildOutputDirs;
  codeExtSet;
  roots;
  mappers;
  userWatch;
  skip;
  testRules;
  javaTests;
  // A directory prefix of `path` (its first `n` segments) is a source root.
  rootEndsBefore(segments, n) {
    for (let j = 1; j <= n; j++) {
      if (this.roots.matches(segments.slice(0, j).join("/"))) return true;
    }
    return false;
  }
  underRoot(path) {
    const segments = path.split("/");
    return this.rootEndsBefore(segments, segments.length - 1);
  }
  // A build-output directory name comes before any source-root prefix.
  inBuildOutput(path) {
    const segments = path.split("/");
    for (let i = 0; i < segments.length - 1; i++) {
      if (this.buildOutputDirs.has(segments[i]) && !this.rootEndsBefore(segments, i)) {
        return true;
      }
    }
    return false;
  }
  matchesMapperGlob(path) {
    return this.mappers.matches(path);
  }
  // Test patterns apply to each language's own code extensions; mapper XML
  // takes only the java test patterns.
  isTest(path) {
    const ext = extensionOf(path);
    if (this.testRules.some((t) => t.codeExts.has(ext) && t.patterns.matches(path))) {
      return true;
    }
    return this.javaTests !== null && this.matchesMapperGlob(path) && this.javaTests.matches(path);
  }
  inDefaultWatch(path) {
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
  excluded(path) {
    return this.skip.matches(path) || isUnder(path, this.config.home) || !this.config.tests && this.isTest(path);
  }
  isWatched(path) {
    const inWatch = this.userWatch ? this.userWatch.matches(path) : this.inDefaultWatch(path);
    return inWatch && !this.excluded(path);
  }
  // Code the language rules recognise but the watch set does not hold.
  isUnwatched(path) {
    if (hasDotSegment(path) || this.inBuildOutput(path)) return false;
    if (!this.codeExtSet.has(extensionOf(path)) && !this.matchesMapperGlob(path)) return false;
    return !this.isWatched(path) && !this.excluded(path);
  }
};
function isPlainFile(repo, path) {
  const segments = path.split("/");
  try {
    for (let i = 1; i <= segments.length; i++) {
      const stat = lstatSync(join3(repo, ...segments.slice(0, i)), { throwIfNoEntry: false });
      if (stat === void 0 || stat.isSymbolicLink()) return false;
      if (i === segments.length) return stat.isFile();
      if (!stat.isDirectory()) return false;
    }
  } catch {
    return false;
  }
  return false;
}
function unownedTest(config, plan) {
  const rules = new Rules(config);
  const patterns = plan.flatMap((part) => part.paths.map((p2) => compileGlob(p2)));
  return (path) => {
    const dirs = path.split("/").slice(0, -1);
    if (dirs.some((d) => rules.prunedDirs.has(d))) return false;
    return rules.isWatched(path) && !patterns.some((regex) => regex.test(path));
  };
}
function measure(repo, config, plan) {
  const rules = new Rules(config);
  const files = listFiles(repo, rules.prunedDirs);
  const patterns = plan.flatMap(
    (part) => part.paths.map((p2) => ({ id: part.id, pattern: p2, regex: compileGlob(p2), strength: strength(p2) }))
  );
  const totals = new Map(plan.map((p2) => [p2.id, { files: 0, lines: 0 }]));
  const orphans = [];
  const contested = [];
  const unwatched = [];
  const owners = /* @__PURE__ */ new Map();
  const wonBy = /* @__PURE__ */ new Map();
  const lines = /* @__PURE__ */ new Map();
  const java = /* @__PURE__ */ new Map();
  const js = /* @__PURE__ */ new Map();
  let watchedFiles = 0;
  for (const path of files) {
    if (!rules.isWatched(path)) {
      if (rules.isUnwatched(path)) unwatched.push(path);
      continue;
    }
    watchedFiles++;
    let best = -1;
    let matched = /* @__PURE__ */ new Map();
    for (const p2 of patterns) {
      if (!p2.regex.test(path)) continue;
      if (p2.strength > best) {
        best = p2.strength;
        matched = /* @__PURE__ */ new Map([[p2.id, p2.pattern]]);
      } else if (p2.strength === best && !matched.has(p2.id)) {
        matched.set(p2.id, p2.pattern);
      }
    }
    if (matched.size === 0) {
      orphans.push(path);
      owners.set(path, null);
      continue;
    }
    const ids = [...matched.keys()].sort(byCodeUnit2);
    if (ids.length > 1) contested.push({ path, parts: ids });
    owners.set(path, ids[0]);
    wonBy.set(path, matched.get(ids[0]));
    const total = totals.get(ids[0]);
    total.files++;
    const bytes = readFileSync3(join3(repo, path));
    lines.set(path, lineTotal(bytes));
    total.lines += lines.get(path);
    if (path.endsWith(".java")) java.set(path, javaFile(bytes.toString("utf8")));
    if (isJsRead(path) && ids.length === 1) js.set(path, bytes.toString("utf8"));
  }
  return {
    parts: plan.map((p2) => ({ id: p2.id, ...totals.get(p2.id) })),
    orphans,
    contested,
    unwatched,
    watchedFiles,
    owners,
    wonBy,
    lines,
    java,
    js
  };
}

// src/draft.ts
var DraftError = class extends Error {
};
var BUILD_MARKERS = /* @__PURE__ */ new Set(["pom.xml", "build.gradle", "build.gradle.kts"]);
var MAIN_ROOTS = ["src/main/java", "src/main/kotlin"];
var TEST_ROOTS = ["src/test/java", "src/test/kotlin"];
var ROOT_FORM = /^(?:(.*)\/)?src\/(?:main|test)\/(?:java|kotlin)$/;
var MAPPER_RELATIVE = new GlobSet(["**/mapper/**/*.xml", "**/*Mapper.xml"]);
var MAPPER_NS_ATTR = /<mapper\b[^>]*?\bnamespace\s*=\s*(?:"([^"]*)"|'([^']*)')/;
var LAYER_NAMES = /* @__PURE__ */ new Set([
  "controller",
  "dao",
  "domain",
  "dto",
  "entity",
  "mapper",
  "model",
  "repository",
  "service",
  "vo"
]);
var FIRST_WORD = /^[A-Z][a-z0-9]+/;
var segs = (p2) => p2 === "" ? [] : p2.split("/");
var dirOf = (p2) => {
  const i = p2.lastIndexOf("/");
  return i < 0 ? "" : p2.slice(0, i);
};
var baseOf = (p2) => p2.slice(p2.lastIndexOf("/") + 1);
var stem = (name) => {
  const i = name.lastIndexOf(".");
  return i <= 0 ? name : name.slice(0, i);
};
var joinPath = (a, b) => a === "" ? b : b === "" ? a : `${a}/${b}`;
var isAncestor = (dir, path) => dir === "" ? path !== "" : isUnder(path, dir);
var strip = (path, dir) => dir === "" ? path : path.slice(dir.length + 1);
var sorted = (items) => [...new Set(items)].sort(byCodeUnit2);
function asGlobLiteral(path) {
  return path.replace(/[*?[{]/g, (c) => `[${c}]`);
}
function normalizeId(text) {
  const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return id === "" ? "top" : id;
}
function isRealDir(repo, path) {
  try {
    return lstatSync2(join4(repo, path), { throwIfNoEntry: false })?.isDirectory() ?? false;
  } catch {
    return false;
  }
}
function newPart(kind, fields2 = {}) {
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
    topDirs: /* @__PURE__ */ new Set(),
    alive: true,
    forward: null,
    id: "",
    mapperFiles: [],
    extra: [],
    ...fields2
  };
}
var linesOf = (files) => files.reduce((sum, f) => sum + f.lines, 0);
var moduleName = (m) => m.path === "" ? "." : m.path;
var layerOf = (f) => f.module !== null && f.root !== null && ["java", "kt"].includes(extensionOf(f.path)) ? segs(dirOf(strip(f.rel, f.module.commonPackage))).find((s) => LAYER_NAMES.has(s)) : void 0;
function compareParts(a, b) {
  if (a.kind !== b.kind) return a.kind - b.kind;
  if (a.kind === 1) {
    const byModule = byCodeUnit2(moduleName(a.module), moduleName(b.module));
    if (byModule !== 0) return byModule;
  }
  return byCodeUnit2(a.path, b.path);
}
function readRawConfig(repo) {
  const file = join4(repo, CONFIG_FILE);
  return existsSync2(file) ? JSON.parse(readFileSync4(file, "utf8")) : {};
}
function checkRoot(repo, root, where) {
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
function literalRoot(value) {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === "[" && value[i + 2] === "]") {
      out += value[i + 1];
      i += 2;
    } else if ("*?[{".includes(c)) {
      throw new DraftError(
        `roots in ${CONFIG_FILE} "${value}" is a glob; draft reads each root as one directory and does not expand globs, because it does not look at build files for given roots`
      );
    } else {
      out += c;
    }
  }
  return out;
}
function checkRoots(repo, values, where, read) {
  const roots = values.map((v) => checkRoot(repo, read(v), where));
  const repeated = roots.find((r, i) => roots.indexOf(r) !== i);
  if (repeated !== void 0) throw new DraftError(`${where} names "${repeated}" more than once`);
  return sorted(roots);
}
function chooseLanguages(repo, options, config, raw) {
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
    return { languages: sorted(options.languages), source: "command line" };
  }
  if (raw.languages !== void 0) return { languages: config.languages, source: "codeplan.json" };
  const detected = Object.keys(LANGUAGES).filter((l) => LANGUAGES[l].detect.some((f) => existsSync2(join4(repo, f)))).sort(byCodeUnit2);
  if (detected.length > 0) return { languages: detected, source: "detected" };
  return { languages: ["js"], source: "default" };
}
function findModules(repo, files, given, tests, rules) {
  const make = (path, roots, resources) => ({
    path,
    roots: sorted(roots),
    resources,
    code: [],
    mappers: [],
    commonPackage: "",
    start: null
  });
  if (given !== null) {
    const perDir = /* @__PURE__ */ new Map();
    for (const root of given) {
      const match = ROOT_FORM.exec(root);
      const dir = match ? match[1] ?? "" : root;
      const entry = perDir.get(dir) ?? { roots: [], dForm: false };
      entry.roots.push(root);
      entry.dForm ||= match !== null;
      perDir.set(dir, entry);
    }
    return sorted(perDir.keys()).map((dir) => {
      const { roots, dForm } = perDir.get(dir);
      const resources = joinPath(dir, "src/main/resources");
      return make(dir, roots, dForm && isRealDir(repo, resources) ? resources : null);
    });
  }
  const candidates = sorted(files.filter((f) => BUILD_MARKERS.has(baseOf(f))).map(dirOf));
  const modules = [];
  for (const dir of candidates) {
    if (hasDotSegment(dir)) continue;
    if (dir !== "" && rules.inBuildOutput(`${dir}/x`)) continue;
    const rootNames = tests ? [...MAIN_ROOTS, ...TEST_ROOTS] : MAIN_ROOTS;
    const roots = rootNames.map((r) => joinPath(dir, r)).filter((r) => isRealDir(repo, r));
    const resourcesPath = joinPath(dir, "src/main/resources");
    const resources = isRealDir(repo, resourcesPath) ? resourcesPath : null;
    const hasMapper = resources !== null && files.some((f) => isUnder(f, resources) && isMapperXml(repo, f, strip(f, resources)) !== null);
    if (roots.length === 0 && !hasMapper) continue;
    modules.push(make(dir, roots, resources));
  }
  return modules;
}
var namespaces = /* @__PURE__ */ new Map();
function readNamespace(repo, path) {
  const key = join4(repo, path);
  if (!namespaces.has(key)) {
    const match = MAPPER_NS_ATTR.exec(readFileSync4(key, "utf8"));
    const value = match ? match[1] ?? match[2] ?? "" : "";
    namespaces.set(key, value.trim() === "" ? null : value.trim());
  }
  return namespaces.get(key);
}
function isMapperXml(repo, path, rel) {
  if (extensionOf(path) !== "xml" || hasDotSegment(rel)) return null;
  const namespace = readNamespace(repo, path);
  if (MAPPER_RELATIVE.matches(rel)) return { outsidePattern: false, namespace };
  return namespace === null ? null : { outsidePattern: true, namespace };
}
function commonPackage(rels) {
  let cp = "";
  for (; ; ) {
    let hasFile = false;
    const subdirs = /* @__PURE__ */ new Set();
    for (const rel of rels) {
      const rest = segs(strip(rel, cp));
      if (rest.length === 1) hasFile = true;
      else subdirs.add(rest[0]);
    }
    if (hasFile || subdirs.size !== 1) return cp;
    cp = joinPath(cp, [...subdirs][0]);
  }
}
var keysAtDepth = (dirs) => (d) => new Set(dirs.map((dir) => segs(dir).slice(0, d).join("/")));
function startDepth(at, maxParts) {
  let depth = 1;
  for (; ; ) {
    const current = at(depth);
    const next = at(depth + 1);
    const same = next.size === current.size && [...next].every((k) => current.has(k));
    if (next.size > maxParts || same) return depth;
    depth++;
  }
}
function groupAtDepth(items, dirOfItem, depth) {
  const groups = /* @__PURE__ */ new Map();
  for (const item of items) {
    const key = segs(dirOfItem(item)).slice(0, depth).join("/");
    groups.set(key, [...groups.get(key) ?? [], item]);
  }
  return groups;
}
function draft(repo, options) {
  namespaces.clear();
  const config = readConfig(repo);
  const raw = readRawConfig(repo);
  const { maxParts } = options;
  const { languages, source: languageSource } = chooseLanguages(repo, options, config, raw);
  let given = null;
  let rootSource;
  if (options.roots !== null) {
    given = checkRoots(repo, options.roots, "--root", (r) => r);
    rootSource = "command line";
  } else if (raw.roots !== void 0) {
    given = checkRoots(repo, config.roots, `roots in ${CONFIG_FILE}`, literalRoot);
    rootSource = "codeplan.json";
  }
  const java = languages.includes("java");
  const codeExts = sorted(languages.flatMap((l) => LANGUAGES[l].codeExts));
  const codeExtSet = new Set(codeExts);
  const languageRoots = languages.flatMap((l) => [
    ...LANGUAGES[l].mainRootGlobs,
    ...config.tests ? LANGUAGES[l].testRootGlobs : []
  ]);
  const rules = new Rules({
    ...config,
    languages,
    watch: null,
    roots: given !== null ? given.map(asGlobLiteral) : languageRoots
  });
  const all = listFiles(repo, rules.prunedDirs);
  const modules = java ? findModules(repo, all, given, config.tests, rules) : [];
  const moduleCount = modules.length;
  const many = moduleCount > maxParts;
  const rootIndex = modules.flatMap((m) => m.roots.map((root) => ({ root, module: m }))).sort((a, b) => b.root.length - a.root.length);
  const resourcesIndex = modules.filter((m) => m.resources !== null).sort((a, b) => b.resources.length - a.resources.length);
  const languageRootWatch = many && given === null ? languageRoots.flatMap((r) => codeExts.map((e) => `${r}/**/*.${e}`)) : [];
  const languageRootSet = new GlobSet(languageRootWatch);
  const lineCount = (path) => lineTotal(readFileSync4(join4(repo, path)));
  const collected = [];
  const outside = [];
  for (const path of all) {
    const ext = extensionOf(path);
    const inRoot = codeExtSet.has(ext) ? rootIndex.find((r) => isUnder(path, r.root)) : void 0;
    if (inRoot) {
      const rel = strip(path, inRoot.root);
      if (hasDotSegment(rel) || rules.excluded(path)) continue;
      const rec = {
        path,
        lines: lineCount(path),
        module: inRoot.module,
        root: inRoot.root,
        rel,
        namespace: null,
        outsidePattern: false
      };
      inRoot.module.code.push(rec);
      collected.push(rec);
      continue;
    }
    const inResources = resourcesIndex.find((m) => isUnder(path, m.resources));
    if (inResources) {
      const rel = strip(path, inResources.resources);
      const mapper = isMapperXml(repo, path, rel);
      if (mapper !== null) {
        if (rules.excluded(path)) continue;
        const rec = {
          path,
          lines: lineCount(path),
          module: inResources,
          root: null,
          rel,
          ...mapper
        };
        inResources.mappers.push(rec);
        collected.push(rec);
        continue;
      }
    }
    const byDefault = rules.isWatched(path) || rules.isUnwatched(path);
    if (byDefault || languageRootSet.matches(path) && !rules.excluded(path)) {
      const rec = {
        path,
        lines: lineCount(path),
        module: null,
        root: null,
        rel: path,
        namespace: null,
        outsidePattern: false
      };
      outside.push(rec);
      collected.push(rec);
    }
  }
  const underGiven = (path) => given !== null && given.some((r) => isUnder(path, r));
  const fromBuildOutput = collected.filter(
    (f) => rules.inBuildOutput(f.path) && !underGiven(f.path)
  ).length;
  for (const m of modules) m.commonPackage = commonPackage(m.code.map((f) => f.rel));
  const nameParts = [];
  const byName = /* @__PURE__ */ new Map();
  if (options.partsByName !== null) {
    const perWord = /* @__PURE__ */ new Map();
    for (const f of modules.flatMap((m) => m.code)) {
      const layer = layerOf(f);
      const word = FIRST_WORD.exec(baseOf(f.path))?.[0];
      if (layer === void 0 || word === void 0) continue;
      const entry = perWord.get(word) ?? { files: [], layers: /* @__PURE__ */ new Set() };
      entry.files.push(f);
      entry.layers.add(layer);
      perWord.set(word, entry);
    }
    const patterns = [];
    for (const word of sorted(perWord.keys())) {
      const { files, layers } = perWord.get(word);
      if (files.length < options.partsByName || layers.size < 2) continue;
      const part = newPart(3, {
        path: word,
        extra: sorted(files.map((f) => `${asGlobLiteral(dirOf(f.path))}/${word}*`))
      });
      nameParts.push(part);
      for (const p2 of part.extra) patterns.push({ part, regex: compileGlob(p2), strength: strength(p2) });
    }
    patterns.sort((a, b) => b.strength - a.strength);
    for (const f of [...modules.flatMap((m) => m.code), ...outside]) {
      const part = patterns.find((p2) => p2.regex.test(f.path))?.part;
      if (part === void 0) continue;
      part.files.push(f);
      byName.set(f, part);
    }
  }
  const remaining = (files) => files.filter((f) => !byName.has(f));
  const foldLimit = Math.max(1, maxParts - nameParts.length);
  const parts = [];
  const outsideGroup = [];
  if (many) {
    const nonRoot = modules.filter((m) => m.path !== "").sort((a, b) => b.path.length - a.path.length);
    const extraFiles = /* @__PURE__ */ new Map();
    for (const f of remaining(outside)) {
      const home = f.path.includes("/") ? nonRoot.find((m) => isUnder(f.path, m.path)) : void 0;
      if (home) extraFiles.set(home, [...extraFiles.get(home) ?? [], f]);
      else outsideGroup.push(f);
    }
    for (const m of modules) {
      const extra = extraFiles.get(m) ?? [];
      const code = remaining(m.code);
      const onlyMappers = m.code.length === 0 && m.mappers.length > 0;
      if (code.length + extra.length === 0 && !onlyMappers) continue;
      const part = newPart(1, {
        module: m,
        modulePart: true,
        files: [...code, ...extra],
        dirPattern: extra.length > 0
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
      const dirFor = (f) => dirOf(strip(f.rel, m.commonPackage));
      const depth = startDepth(keysAtDepth(code.map(dirFor)), foldLimit);
      for (const [key, files] of groupAtDepth(code, dirFor, depth)) {
        const part = newPart(1, { module: m, common: key === "", path: key, files });
        if (part.common) m.start = part;
        parts.push(part);
      }
    }
  }
  if (outsideGroup.length > 0) {
    const resourcesDirOf = (f) => resourcesIndex.find((m) => isUnder(f.path, m.resources))?.resources ?? null;
    const keyAt = (f, d) => resourcesDirOf(f) ?? segs(dirOf(f.path)).slice(0, d).join("/");
    const depth = startDepth((d) => new Set(outsideGroup.map((f) => keyAt(f, d))), foldLimit);
    const groups = /* @__PURE__ */ new Map();
    for (const f of outsideGroup) {
      const key = keyAt(f, depth);
      groups.set(key, [...groups.get(key) ?? [], f]);
    }
    for (const [key, files] of groups) {
      if (key === "") parts.push(newPart(0, { files }));
      else parts.push(newPart(2, { path: key, files, exactPaths: resourcesDirOf(files[0]) === key }));
    }
  }
  const alive = () => parts.filter((p2) => p2.alive);
  const place = (p2) => p2.modulePart ? p2.module.path : p2.path;
  const levelOf = (p2) => p2.modulePart ? 0 : segs(p2.path).length;
  const topHasAll = (top) => top.moduleContent || moduleCount === 0 && top.received;
  const sameSpace = (a, x) => {
    if (many) return !(a.modulePart && a.module.path === "");
    return x.kind === 1 ? a.kind === 1 && a.module === x.module : a.kind !== 1;
  };
  const covers = (a, x) => {
    if (a.kind === 2) return true;
    if (a.kind === 0) return topHasAll(a) || a.topDirs.has(segs(place(x))[0] ?? "");
    if (a.modulePart) return true;
    return !a.common || a.received;
  };
  const add = (part) => {
    parts.push(part);
    return part;
  };
  const topOrNew = () => alive().find((p2) => p2.kind === 0) ?? add(newPart(0));
  const upperPartOf = (x) => {
    const up = dirOf(place(x));
    if (!many && x.kind === 1) {
      const m = x.module;
      const found = alive().find((p2) => p2.kind === 1 && p2.module === m && p2.path === up);
      if (found) return found;
      const created = add(newPart(1, { module: m, common: up === "", path: up }));
      if (created.common) m.start = created;
      return created;
    }
    if (up === "") return topOrNew();
    return alive().find((p2) => p2.kind !== 0 && sameSpace(p2, x) && place(p2) === up) ?? add(newPart(2, { path: up }));
  };
  const target = (x) => {
    if (x.common) return topOrNew();
    let best = null;
    for (const a of alive()) {
      if (a === x || !sameSpace(a, x) || !isAncestor(place(a), place(x)) || !covers(a, x)) continue;
      if (best === null || place(a).length > place(best).length) best = a;
    }
    return best ?? upperPartOf(x);
  };
  const merge = (x, into) => {
    into.files.push(...x.files);
    into.received = true;
    if (x.kind === 1 || x.moduleContent) into.moduleContent = true;
    if (into.kind === 0 && x.kind === 2) into.topDirs.add(segs(x.path)[0]);
    if (into.modulePart) into.dirPattern = true;
    x.alive = false;
    x.forward = into;
  };
  const eligible = () => {
    const now = alive();
    if (many) {
      const moduleParts = now.filter((p2) => p2.modulePart && p2.module.path !== "");
      const dirs = now.filter((p2) => p2.kind === 2 && (!p2.received || moduleParts.length === 0));
      return [...moduleParts, ...dirs];
    }
    const early = now.filter((p2) => p2.kind === 2 || p2.kind === 1 && !p2.common);
    if (early.length > 0 || moduleCount !== 1) return early;
    return now.filter((p2) => p2.common);
  };
  const foldOrder = (a, b) => linesOf(a.files) - linesOf(b.files) || levelOf(b) - levelOf(a) || compareParts(a, b);
  while (alive().length > foldLimit) {
    const candidates = eligible();
    if (candidates.length === 0) break;
    const x = candidates.sort(foldOrder)[0];
    merge(x, target(x));
  }
  const final = [...alive().sort(compareParts), ...nameParts];
  const notes = [];
  const used = /* @__PURE__ */ new Set();
  for (const p2 of final) {
    let base;
    if (p2.kind === 0) base = "top";
    else if (p2.kind !== 1) base = normalizeId(p2.path);
    else {
      const m = p2.module;
      const name = m.path === "" ? "top" : normalizeId(m.path);
      if (p2.modulePart) base = name;
      else if (moduleCount >= 2) base = p2.common ? name : normalizeId(`${name}-${p2.path}`);
      else if (p2.common) base = m.commonPackage === "" ? name : normalizeId(segs(m.commonPackage).at(-1));
      else base = normalizeId(p2.path);
    }
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    p2.id = id;
  }
  const zoneOf = (p2) => {
    if (moduleCount === 0) return p2.kind === 0 ? void 0 : segs(p2.path)[0];
    if (moduleCount === 1) return void 0;
    if (!many) return p2.kind === 1 ? p2.module.path === "" ? "top" : p2.module.path : void 0;
    if (p2.modulePart) return p2.module.path === "" ? "top" : segs(p2.module.path)[0];
    return p2.kind === 2 ? segs(p2.path)[0] : void 0;
  };
  const resolve2 = (p2) => p2.forward ? resolve2(p2.forward) : p2;
  const ownerOf = /* @__PURE__ */ new Map();
  for (const p2 of final) for (const f of p2.files) ownerOf.set(f.path, p2);
  const codeLines = (p2) => linesOf(p2.files);
  const mappers = {
    namespace: 0,
    fileName: 0,
    package: 0,
    rest: 0,
    restFiles: [],
    outsidePattern: 0
  };
  const underNamePattern = /* @__PURE__ */ new Set();
  for (const m of modules) {
    if (m.mappers.length === 0) continue;
    const packageParts = final.filter((p2) => p2.kind === 1 && !p2.modulePart && p2.module === m).map((p2) => ({ part: p2, pkg: joinPath(m.commonPackage, p2.path) })).filter((x) => x.pkg !== "");
    const found = /* @__PURE__ */ new Map();
    for (const xml of m.mappers) {
      if (xml.outsidePattern) mappers.outsidePattern++;
      if (xml.namespace !== null) {
        const cls = xml.namespace.split(".").join("/");
        const file = m.code.find((f) => f.rel === `${cls}.java` || f.rel === `${cls}.kt`);
        if (file) {
          found.set(xml, ownerOf.get(file.path));
          mappers.namespace++;
          continue;
        }
      }
      const sameName = m.code.filter(
        (f) => ["java", "kt"].includes(extensionOf(f.path)) && stem(baseOf(f.path)) === stem(baseOf(xml.path))
      );
      if (sameName.length === 1) {
        found.set(xml, ownerOf.get(sameName[0].path));
        mappers.fileName++;
        continue;
      }
      const dir = dirOf(xml.rel);
      let byPackage = null;
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
    const best = (candidates, counted) => {
      const count2 = (p2) => counted.filter((x) => found.get(x) === p2).length;
      const ranked = [...new Set(candidates)].sort(
        (a, b) => count2(b) - count2(a) || codeLines(b) - codeLines(a) || byCodeUnit2(a.id, b.id)
      );
      return ranked[0] ?? null;
    };
    const fromNames = () => {
      const count2 = (p2) => m.mappers.filter((x) => found.get(x) === p2).length;
      const lines = (p2) => linesOf(m.code.filter((f) => byName.get(f) === p2));
      return [...new Set(m.code.map((f) => byName.get(f)))].sort(
        (a, b) => count2(b) - count2(a) || lines(b) - lines(a) || byCodeUnit2(a.path, b.path)
      )[0];
    };
    const representative = m.start !== null ? resolve2(m.start) : best(remaining(m.code).map((f) => ownerOf.get(f.path)), m.mappers) ?? fromNames();
    const perDir = /* @__PURE__ */ new Map();
    for (const xml of m.mappers) {
      const dir = dirOf(xml.rel);
      perDir.set(dir, [...perDir.get(dir) ?? [], xml]);
    }
    const take = (part, xml) => {
      part.mapperFiles.push(xml);
      if (!found.has(xml)) {
        mappers.rest++;
        mappers.restFiles.push(xml.path);
      }
    };
    for (const dir of sorted(perDir.keys())) {
      const xmls = perDir.get(dir);
      if (dir === "") {
        for (const xml of xmls) {
          const owner = found.get(xml) ?? representative;
          owner.extra.push(asGlobLiteral(xml.path));
          take(owner, xml);
        }
        continue;
      }
      const taken = xmls.filter((x) => found.has(x));
      const holder = best(taken.map((x) => found.get(x)), taken) ?? representative;
      holder.extra.push(`${asGlobLiteral(joinPath(m.resources, dir))}/*.xml`);
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
      `${prefix}src/main/resources/**/*Mapper.xml`
    );
  }
  mappers.restFiles.sort(byCodeUnit2);
  const pathsOf = (p2) => {
    const globsUnderRoots = (files, pkg) => sorted(files.filter((f) => f.root !== null).map((f) => f.root)).map(
      (root) => `${asGlobLiteral(joinPath(root, pkg))}/**`
    );
    let own;
    if (p2.kind === 0) {
      own = topHasAll(p2) ? ["**"] : [
        ...[...p2.topDirs].map((d) => `${asGlobLiteral(d)}/**`),
        ...p2.files.filter((f) => !f.path.includes("/")).map((f) => asGlobLiteral(f.path))
      ];
    } else if (p2.kind === 2) {
      own = p2.exactPaths && !p2.received ? p2.files.map((f) => asGlobLiteral(f.path)) : [`${asGlobLiteral(p2.path)}/**`];
    } else if (p2.modulePart) {
      own = p2.dirPattern ? [`${asGlobLiteral(p2.module.path)}/**`] : globsUnderRoots(p2.files, "");
    } else if (p2.kind === 3) {
      own = [];
    } else if (p2.common && !p2.received) {
      own = p2.files.map((f) => asGlobLiteral(f.path));
    } else {
      own = globsUnderRoots(p2.files, joinPath(p2.module.commonPackage, p2.path));
    }
    const all2 = sorted([...own, ...p2.extra]);
    const wide = all2.filter((q) => q === "**" || q.endsWith("/**")).map((q) => q.slice(0, -2));
    return all2.filter(
      (q) => underNamePattern.has(q) || !wide.some((w) => q !== `${w}**` && q.startsWith(w))
    );
  };
  const draftConfig = { languages };
  if (java && collected.length > 0) {
    const watch = [];
    const forRoot = (root) => codeExts.map((e) => `${root}/**/*.${e}`);
    if (moduleCount > 0) {
      if (!many) {
        for (const m of modules) {
          for (const root of sorted(m.code.map((f) => f.root))) watch.push(...forRoot(asGlobLiteral(root)));
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
          `${prefix}src/main/resources/**/*Mapper.xml`
        );
        const outsidePattern = m.mappers.filter((x) => x.outsidePattern);
        for (const dir of sorted(outsidePattern.map((x) => dirOf(x.path)))) {
          const others = all.some((f) => {
            if (dirOf(f) !== dir || extensionOf(f) !== "xml" || baseOf(f).startsWith(".")) return false;
            return isMapperXml(repo, f, strip(f, m.resources)) === null;
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
        message: `${outside.length} files outside modules are listed in config.watch by exact path; a directory pattern can replace them`
      });
    }
  }
  if (given !== null) draftConfig.roots = sorted(given.map(asGlobLiteral));
  if (java && moduleCount === 1) {
    notes.push({ code: "no-zones", message: "one module, so no zone is proposed" });
  }
  if (final.length > maxParts) {
    const noFold = many ? "the root module part cannot fold" : "parts do not fold across modules";
    notes.push({
      code: "over-max-parts",
      parts: final.length,
      maxParts,
      message: `${final.length} parts, more than the maximum ${maxParts}: ` + (nameParts.length === 0 ? noFold : `--parts-by-name made ${nameParts.length} of them` + (final.length - nameParts.length > foldLimit ? `, and ${noFold}` : ""))
    });
  }
  if (many) {
    const remaining2 = final.filter((p2) => p2.modulePart).length;
    notes.push({
      code: "modules",
      modules: moduleCount,
      notRemaining: moduleCount - remaining2,
      message: `${moduleCount} modules; ${moduleCount - remaining2} of them do not remain as module parts`
    });
  }
  const javaCode = modules.flatMap(
    (m) => m.code.filter((f) => ["java", "kt"].includes(extensionOf(f.path))).map((f) => ({ f, m }))
  );
  const layerFiles = javaCode.filter(({ f }) => layerOf(f) !== void 0).length;
  if (javaCode.length > 0 && layerFiles * 2 >= javaCode.length) {
    notes.push({
      code: "layers",
      layerFiles,
      files: javaCode.length,
      message: `${layerFiles} of ${javaCode.length} Java/Kotlin files sit in layer directories (controller, service, ...); parts here follow packages, not layers`
    });
  }
  if (options.partsByName !== null && nameParts.length > 0) {
    const files = nameParts.reduce((sum, p2) => sum + p2.files.length + p2.mapperFiles.length, 0);
    notes.push({
      code: "parts-by-name",
      parts: nameParts.length,
      files,
      message: `${nameParts.length} parts come from the first word of file names in layer directories; they hold ${files} files`
    });
  } else if (options.partsByName !== null) {
    notes.push({
      code: "no-parts-by-name",
      message: `no part comes from file names: no first word of a file name has ${options.partsByName} or more files under two or more of these names: ${[...LAYER_NAMES].join(", ")}`
    });
  }
  if (fromBuildOutput > 0) {
    notes.push({
      code: "build-output",
      files: fromBuildOutput,
      message: `${fromBuildOutput} files under build-output directory names are measured because config.watch reaches them`
    });
  }
  const draftParts = final.map((p2) => {
    const zone = zoneOf(p2);
    return {
      id: p2.id,
      name: p2.kind === 3 ? p2.path : p2.id,
      ...zone === void 0 ? {} : { zone },
      about: "",
      paths: pathsOf(p2)
    };
  });
  const measured = final.map((p2) => ({
    id: p2.id,
    files: p2.files.length + p2.mapperFiles.length,
    lines: linesOf(p2.files) + linesOf(p2.mapperFiles)
  }));
  const result2 = {
    plan: { format: 1, name: "", about: "", parts: draftParts, externals: [], scenarios: [] },
    config: draftConfig,
    measure: {
      parts: measured,
      files: measured.reduce((s, p2) => s + p2.files, 0),
      lines: measured.reduce((s, p2) => s + p2.lines, 0)
    },
    sources: { languages: languageSource, ...rootSource ? { roots: rootSource } : {} },
    notes
  };
  const javaFiles = java || languageSource === "command line" || languageSource === "codeplan.json" ? 0 : all.filter(
    (p2) => ["java", "kt"].includes(extensionOf(p2)) && !rules.excluded(p2) && !rules.inBuildOutput(p2)
  ).length;
  if (javaFiles > result2.measure.files) {
    notes.push({
      code: "unmeasured-java",
      files: javaFiles,
      message: `${javaFiles} .java and .kt files are not measured (${result2.measure.files} files are); for Java, run draft with --language java and --root for each source root`
    });
  }
  if (java) {
    result2.modules = sorted(modules.map(moduleName));
    result2.mappers = mappers;
  }
  return result2;
}

// src/history.ts
import { lstatSync as lstatSync4, readdirSync as readdirSync2, readFileSync as readFileSync6 } from "node:fs";

// src/page.ts
var PAGE_MARK = "<!doctype html><!-- codeplan page -->";
var BLOCK_OPEN = '<script type="application/json" id="codeplan-data">';
function blockJson(data) {
  return JSON.stringify(data).replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}
var THEMES = {
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
    "--cp-part-side": "#dfe5ee",
    "--cp-edge": "#5b6170",
    "--cp-connector": "#8a6a1f",
    "--cp-active": "#b5400f",
    "--cp-control-fill": "#ffffff",
    "--cp-control-line": "#6b7486",
    "--cp-control-text": "#1d2433"
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
    "--cp-part-side": "#2c3441",
    "--cp-edge": "#9aa1ae",
    "--cp-connector": "#d0a650",
    "--cp-active": "#f08a4b",
    "--cp-control-fill": "#1e232c",
    "--cp-control-line": "#8d96a6",
    "--cp-control-text": "#e7e9ee"
  }
};
var tokens = (theme) => Object.entries(theme).map(([k, v]) => `${k}: ${v};`).join(" ");
var THEME_STYLE = `:root { color-scheme: light dark; ${tokens(THEMES.light)} }
@media (prefers-color-scheme: dark) { :root:not([data-theme]) { ${tokens(THEMES.dark)} } }
:root[data-theme="light"] { color-scheme: light; ${tokens(THEMES.light)} }
:root[data-theme="dark"] { color-scheme: dark; ${tokens(THEMES.dark)} }`;
var ZONES = {
  light: { "--cp-zone-1": "#d9eaf2", "--cp-zone-2": "#e1d9f2", "--cp-zone-3": "#f2d9ea", "--cp-zone-4": "#f2e1d9", "--cp-zone-5": "#eaf2d9", "--cp-zone-6": "#d9f2e1" },
  dark: { "--cp-zone-1": "#20323c", "--cp-zone-2": "#29203c", "--cp-zone-3": "#3c2032", "--cp-zone-4": "#3c2920", "--cp-zone-5": "#323c20", "--cp-zone-6": "#203c29" }
};
var STYLE = `
${THEME_STYLE}
:root { ${tokens(ZONES.light)} }
@media (prefers-color-scheme: dark) { :root:not([data-theme]) { ${tokens(ZONES.dark)} } }
:root[data-theme="light"] { ${tokens(ZONES.light)} }
:root[data-theme="dark"] { ${tokens(ZONES.dark)} }
html, body { margin: 0; background: var(--cp-bg); color: var(--cp-text); font: 13px/1.4 system-ui, sans-serif; }
main { padding: 16px; }
#tools { display: flex; justify-content: flex-end; gap: 8px; margin: 0 0 8px; }
#view { display: grid; max-height: 80vh; overflow: auto; scrollbar-gutter: stable; user-select: none; -webkit-user-select: none; cursor: grab; }
#plane, #raised { display: block; margin: auto; background: transparent; }
#plane[hidden], #raised[hidden] { display: none; }
.zone { stroke: var(--cp-zone-line); stroke-width: 1; }
.zone[data-colour="1"], #zones [data-colour="1"]::before { fill: var(--cp-zone-1); background: var(--cp-zone-1); }
.zone[data-colour="2"], #zones [data-colour="2"]::before { fill: var(--cp-zone-2); background: var(--cp-zone-2); }
.zone[data-colour="3"], #zones [data-colour="3"]::before { fill: var(--cp-zone-3); background: var(--cp-zone-3); }
.zone[data-colour="4"], #zones [data-colour="4"]::before { fill: var(--cp-zone-4); background: var(--cp-zone-4); }
.zone[data-colour="5"], #zones [data-colour="5"]::before { fill: var(--cp-zone-5); background: var(--cp-zone-5); }
.zone[data-colour="6"], #zones [data-colour="6"]::before { fill: var(--cp-zone-6); background: var(--cp-zone-6); }
#zones { margin: 8px 0 0; display: flex; flex-wrap: wrap; gap: 4px 12px; color: var(--cp-zone-title); }
#zones:empty, #zones[hidden] { display: none; }
#zones span::before { content: ""; display: inline-block; width: 10px; height: 10px; margin: 0 4px 0 0; border: 1px solid var(--cp-zone-line); vertical-align: -1px; }
.zone-title { fill: var(--cp-zone-title); font-size: 12px; font-weight: 600; }
.part { fill: var(--cp-part-fill); stroke: var(--cp-part-line); stroke-width: 1; }
.part[data-planned] { stroke-dasharray: 6 3; }
.external { fill: var(--cp-ext-fill); stroke: var(--cp-ext-line); stroke-width: 1; stroke-dasharray: 4 2; }
.label { fill: var(--cp-text); font-size: 12px; }
.name { font-weight: 600; }
.side { fill: var(--cp-part-side); stroke: var(--cp-part-line); stroke-width: 1; stroke-linejoin: round; }
.top { fill: var(--cp-part-fill); stroke: var(--cp-part-line); stroke-width: 1; stroke-linejoin: round; }
g[data-planned] .side, g[data-planned] .top { stroke-dasharray: 6 3; }
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
var EARLY = `try { var t = localStorage.getItem("codeplan-theme"); if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t); } catch (e) {}`;
var THEME_BUTTON = `  var root = document.documentElement;
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
  });`;
var VIEWER = `
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
  // The first n lines (one when n is not given) are name lines.
  function textBox(box, lines, cls, parent, n) {
    var clip = make("svg", { x: box.x, y: box.y, width: box.w, height: box.h, overflow: "hidden" }, parent);
    for (var i = 0; i < lines.length; i++) {
      var t = make("text", { x: 6, y: 16 * (i + 1), "class": i < (n || 1) ? cls + " name" : cls }, clip);
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
  // The zones in the order they first come in the plan's parts; the i-th
  // takes colour (i mod 6) + 1.
  var zoneColour = Object.create(null);
  var zoneOrder = [];
  for (var y = 0; y < planParts.length; y++) {
    var zn = str(planParts[y].zone);
    if (zn && !(zn in zoneColour)) zoneColour[zn] = zoneOrder.push(zn) % 6 || 6;
  }
  var zoneList = document.getElementById("zones");
  for (var yo = 0; yo < zoneOrder.length; yo++) {
    var item = html("span", zoneList);
    item.setAttribute("data-zone", zoneOrder[yo]);
    item.setAttribute("data-colour", zoneColour[zoneOrder[yo]]);
    item.textContent = zoneOrder[yo];
  }
  for (var e = 0; e < planExternals.length; e++) names[planExternals[e].id] = str(planExternals[e].name) || planExternals[e].id;
  var measured = Object.create(null);
  for (var j = 0; j < data.measure.parts.length; j++) measured[data.measure.parts[j].id] = data.measure.parts[j];

  // A part's label: its name on one line, or the two lines of wrap, then
  // the line count and the file count.
  function partText(part, m, parent) {
    var name = part.label.wrap || [names[part.id] || part.id];
    textBox(part.label, name.concat([m.lines + " lines", planned[part.id] ? "planned" : m.files + " files"]), "label", parent, name.length);
  }

  var defs = make("defs", {}, plane);
  // The arrowhead is 6 drawing units whatever the line width or highlight,
  // so it stays in the gap of 8 before the rectangle and inside the canvas.
  var marker = make("marker", { id: "arrow", viewBox: "0 0 10 10", refX: 10, refY: 5, markerWidth: 6, markerHeight: 6, markerUnits: "userSpaceOnUse", orient: "auto" }, defs);
  make("path", { d: "M0,0 L10,5 L0,10 z", "class": "arrow" }, marker);

  for (var z = 0; z < layout.zones.length; z++) {
    var zone = layout.zones[z];
    make("rect", { x: zone.x, y: zone.y, width: zone.w, height: zone.h, "class": "zone", "data-zone": zone.name, "data-colour": zoneColour[zone.name] }, plane);
    textBox(zone.title, [zone.name], "zone-title", plane);
  }
  var rects = Object.create(null);
  for (var p = 0; p < layout.parts.length; p++) {
    var part = layout.parts[p];
    var m = measured[part.id] || { lines: 0, files: 0 };
    rects[part.id] = make("rect", { x: part.x, y: part.y, width: part.w, height: part.h, "class": "part", "data-id": part.id }, plane);
    if (planned[part.id]) rects[part.id].setAttribute("data-planned", "true");
    partText(part, m, plane);
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

  // The raised picture: zone lines, then the shapes in the order the data
  // gives, then the labels and the zone titles. A part is its left side,
  // its front side and its top; an external is the rectangle on the ground.
  var raised = data.raised;
  var raisedSvg = document.getElementById("raised");
  raisedSvg.setAttribute("viewBox", "0 0 " + raised.width + " " + raised.height);
  var px = raised.projection.x;
  var py = raised.projection.y;
  function face(corners, cls, parent) {
    var out = [];
    for (var i = 0; i < corners.length; i++) {
      var c = corners[i];
      out.push((px[0] * c[0] + px[1] * c[1] + px[2] * c[2] + px[3]) + "," + (py[0] * c[0] + py[1] * c[1] + py[2] * c[2] + py[3]));
    }
    return make("polygon", { points: out.join(" "), "class": cls }, parent);
  }
  function level(b, z) {
    return [[b.x, b.y, z], [b.x + b.w, b.y, z], [b.x + b.w, b.y + b.h, z], [b.x, b.y + b.h, z]];
  }
  for (var rz = 0; rz < raised.zones.length; rz++) {
    var ground = face(level(raised.zones[rz], 0), "zone", raisedSvg);
    ground.setAttribute("data-zone", raised.zones[rz].name);
    ground.setAttribute("data-colour", zoneColour[raised.zones[rz].name]);
  }
  var raisedParts = Object.create(null);
  for (var rp = 0; rp < raised.parts.length; rp++) raisedParts[raised.parts[rp].id] = raised.parts[rp];
  var raisedExternals = Object.create(null);
  for (var rx = 0; rx < raised.externals.length; rx++) raisedExternals[raised.externals[rx].id] = raised.externals[rx];
  for (var ro = 0; ro < raised.order.length; ro++) {
    var shape = make("g", { "data-id": raised.order[ro] }, raisedSvg);
    var b = raisedParts[raised.order[ro]];
    if (!b) {
      face(level(raisedExternals[raised.order[ro]], 0), "external", shape);
      continue;
    }
    if (planned[b.id]) shape.setAttribute("data-planned", "true");
    face([[b.x, b.y, 0], [b.x, b.y + b.h, 0], [b.x, b.y + b.h, b.z], [b.x, b.y, b.z]], "side", shape);
    face([[b.x, b.y + b.h, 0], [b.x + b.w, b.y + b.h, 0], [b.x + b.w, b.y + b.h, b.z], [b.x, b.y + b.h, b.z]], "side", shape);
    face(level(b, b.z), "top", shape);
  }
  for (var rl = 0; rl < raised.parts.length; rl++) {
    var rm = measured[raised.parts[rl].id] || { lines: 0, files: 0 };
    partText(raised.parts[rl], rm, raisedSvg);
  }
  for (var re = 0; re < raised.externals.length; re++) textBox(raised.externals[re].label, [names[raised.externals[re].id] || raised.externals[re].id, "external"], "label", raisedSvg);
  for (var rt = 0; rt < raised.zones.length; rt++) textBox(raised.zones[rt].title, [raised.zones[rt].name], "zone-title", raisedSvg);

  var legend = document.getElementById("legend");
  function line(text) { html("p", legend).textContent = text; }
  var title = str(plan.name);
  line(data.measure.files + " files, " + data.measure.lines + " lines" + (title ? " \\u00b7 " + title : ""));
  if (data.orphans.length > 0) line(data.orphans.length + " orphan files: no part owns them");
  if (data.unwatched > 0) line(data.unwatched + " unwatched files: code outside the watch set");
  if (title) document.title = title;

  // The view: the shown picture at scale s in the scroll frame. Its width
  // and height attributes are the size times s; the frame scrolls the rest.
  var view = document.getElementById("view");
  var S_MAX = 4;
  var R = 1.25;
  var scale = 1;
  var frameWidth = -1;
  function size() { return picture === "raised" ? raised : layout; }
  function setScale(s) {
    scale = s;
    var svg = picture === "raised" ? raisedSvg : plane;
    svg.setAttribute("width", size().width * s);
    svg.setAttribute("height", size().height * s);
  }
  function smallest() { return Math.min(view.clientWidth / size().width, view.clientHeight / size().height, S_MAX); }
  // The first state: as wide as the frame, at most 2, top left.
  function start() {
    frameWidth = view.clientWidth;
    var s = Math.min(frameWidth / size().width, 2);
    view.style.height = size().height * s + "px";
    setScale(s);
    view.scrollLeft = 0;
    view.scrollTop = 0;
  }
  function fit() {
    setScale(smallest());
    view.scrollLeft = 0;
    view.scrollTop = 0;
  }
  // The gap before a picture smaller than the frame on one axis.
  function gap(f, l, s) { return Math.max(0, (f - l * s) / 2); }
  // The drawing point at (x, y) in the frame stays there.
  function zoomTo(s, x, y) {
    s = Math.min(Math.max(s, smallest()), S_MAX);
    if (s === scale) return;
    var fw = view.clientWidth;
    var fh = view.clientHeight;
    var w = size().width;
    var h = size().height;
    var drawX = (view.scrollLeft + x - gap(fw, w, scale)) / scale;
    var drawY = (view.scrollTop + y - gap(fh, h, scale)) / scale;
    setScale(s);
    view.scrollLeft = drawX * s + gap(fw, w, s) - x;
    view.scrollTop = drawY * s + gap(fh, h, s) - y;
  }
  function stepScale(f) { zoomTo(scale * f, view.clientWidth / 2, view.clientHeight / 2); }
  function tool(role, text, title, act) {
    var button = html("button", document.getElementById("tools"));
    button.type = "button";
    button.setAttribute("data-role", role);
    button.textContent = text;
    button.title = title;
    button.addEventListener("click", act);
  }
  tool("zoom-in", "+", "Zoom in (+ key)", function () { stepScale(R); });
  tool("zoom-out", "\u2212", "Zoom out (- key)", function () { stepScale(1 / R); });
  tool("fit", "fit", "Show the whole picture (0 key)", fit);
  tool("fit-width", "width", "Fit the picture to the width of the page", start);
  // Ctrl or Cmd with the wheel, and a pinch on a trackpad, zoom at the
  // pointer; the page itself never zooms from it.
  view.addEventListener("wheel", function (event) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    var d = event.deltaY;
    if (d === 0) return;
    var f = event.deltaMode === 0 ? Math.min(Math.max(Math.pow(R, -d / 100), 1 / R), R) : d < 0 ? R : 1 / R;
    var box = view.getBoundingClientRect();
    zoomTo(scale * f, event.clientX - box.left, event.clientY - box.top);
  }, { passive: false });
  // A drag with the mouse or a pen moves the picture after 4px.
  var drag = null;
  view.addEventListener("pointerdown", function (event) {
    var box = view.getBoundingClientRect();
    if (event.button !== 0 || (event.pointerType !== "mouse" && event.pointerType !== "pen")) return;
    if (event.clientX - box.left >= view.clientWidth || event.clientY - box.top >= view.clientHeight) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: view.scrollLeft, top: view.scrollTop, on: false };
  });
  view.addEventListener("pointermove", function (event) {
    if (drag === null || event.pointerId !== drag.id) return;
    if (!(event.buttons & 1)) return stopDrag();
    var dx = event.clientX - drag.x;
    var dy = event.clientY - drag.y;
    if (!drag.on) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 4) return;
      drag.on = true;
      view.setPointerCapture(drag.id);
    }
    view.scrollLeft = drag.left - dx;
    view.scrollTop = drag.top - dy;
  });
  function stopDrag() { drag = null; }
  view.addEventListener("pointerup", stopDrag);
  view.addEventListener("pointercancel", stopDrag);
  window.addEventListener("resize", function () {
    if (view.clientWidth === frameWidth) return;
    start();
    if (current !== null) reach();
  });

  // The picture button: one picture shows at a time, and the button names
  // the other one.
  var pictureButton = html("button", document.getElementById("tools"));
  pictureButton.type = "button";
  pictureButton.setAttribute("data-role", "picture");
  pictureButton.title = "Show the other picture of the plan";
  var picture;
  function setPicture(name) {
    if (name === picture) return;
    picture = name;
    (name === "raised" ? plane : raisedSvg).setAttribute("hidden", "");
    (name === "raised" ? raisedSvg : plane).removeAttribute("hidden");
    pictureButton.textContent = name === "raised" ? "plane" : "raised";
    start();
  }
  setPicture("plane");
  // The raised picture ends a walk-through and a chosen task, and its
  // fragment has the picture key alone.
  function showRaised() {
    if (current !== null) close(true);
    endTask(true);
    setPicture("raised");
    setHash("picture=raised");
  }
  pictureButton.addEventListener("click", function () {
    if (picture === "raised") {
      setPicture("plane");
      setHash("");
    } else showRaised();
  });

  // The theme button: auto, then light, then dark, then auto again.
${THEME_BUTTON}

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
    setPicture("plane");
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
      if (select.value === "") {
        if (current !== null) close();
      } else open(Number(select.value), 0);
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
    reach();
    stepText.textContent = (k + 1) + "/" + steps.length + " " + (names[at] || at) + ": " + fill(steps[k].does);
    prev.disabled = k === 0;
    next.disabled = k === steps.length - 1;
    if (!keep) setHash("scenario=" + scenario.id + "&step=" + (k + 1));
  }
  // When the rectangle of the step is not all in the frame, the frame
  // scrolls on each axis where it is not: by the least, 16px in, or to
  // the middle or the start when it does not fit.
  function axis(key, f, l, at, len) {
    var a = at * scale + gap(f, l, scale) - view[key];
    var b = a + len * scale;
    if (a >= 0 && b <= f) return;
    var to = b - a <= f - 32 ? (a < 0 ? 16 : f - 16 - (b - a)) : Math.max(0, (f - (b - a)) / 2);
    view[key] += a - to;
  }
  function reach() {
    var steps = scenarios[current.index].steps || [];
    var el = steps.length > 0 ? rects[steps[current.step].at] : null;
    if (!el) return;
    axis("scrollLeft", view.clientWidth, layout.width, Number(el.getAttribute("x")), Number(el.getAttribute("width")));
    axis("scrollTop", view.clientHeight, layout.height, Number(el.getAttribute("y")), Number(el.getAttribute("height")));
  }
  function open(index, step, fromHash) {
    setPicture("plane");
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
    if (!event.altKey && !event.ctrlKey && !event.metaKey && document.activeElement !== select) {
      if (event.key === "+" || event.key === "=") stepScale(R);
      else if (event.key === "-") stepScale(1 / R);
      else if (event.key === "0") fit();
    }
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
  // The picture key is read only when neither of those keys is there; the
  // raised picture shows for the value "raised" and the plane picture for
  // anything else.
  function fromHash(onLoad) {
    var text = location.hash.replace(/^#/, "");
    if (text === "") {
      if (!onLoad) {
        if (current !== null) close();
        endTask();
        setPicture("plane");
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
      setPicture("plane");
      for (var w = 0; w < scenarios.length; w++) {
        if (scenarios[w].id !== wanted.scenario) continue;
        var n = (scenarios[w].steps || []).length;
        var k = /^[0-9]+$/.test(wanted.step || "") ? parseInt(wanted.step, 10) : 0;
        open(w, k >= 1 && k <= n ? k - 1 : 0, true);
        return;
      }
      return;
    }
    if ("task" in wanted) {
      setPicture("plane");
      if (taskRows[wanted.task]) chooseTask(wanted.task, true);
    } else if (wanted.picture === "raised") showRaised();
    else setPicture("plane");
  }
  window.addEventListener("hashchange", function () { fromHash(false); });
  fromHash(true);
})();
`;
var FRAME = {
  head: `${PAGE_MARK}
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>codeplan</title>
<style>${STYLE}</style>
<script>${EARLY}</script>
</head>
<body>
<main>
<div id="tools"></div>
<div id="view">
<svg id="plane" data-picture="plane" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="parts of the repository"></svg>
<svg id="raised" data-picture="raised" hidden xmlns="http://www.w3.org/2000/svg" role="img" aria-label="parts of the repository as raised rectangles"></svg>
</div>
<div id="zones"></div>
<div id="tasks"></div>
<div id="walk"></div>
<div id="legend"></div>
</main>
`,
  tail: `
<script>${VIEWER}</script>
</body>
</html>
`
};
function pageHtml(data, frame = FRAME) {
  return frame.head + BLOCK_OPEN + blockJson(data) + "</script>" + frame.tail;
}

// src/validate.ts
import { lstatSync as lstatSync3 } from "node:fs";
import { join as join6 } from "node:path";

// src/stamp.ts
import { createHash } from "node:crypto";
import { readFileSync as readFileSync5 } from "node:fs";
import { join as join5 } from "node:path";
function stampOf(line) {
  let end = line.length;
  if (end > 0 && line[end - 1] === 13) end--;
  let start = 0;
  const blank = (b) => b === 32 || b === 9;
  while (start < end && blank(line[start])) start++;
  while (end > start && blank(line[end - 1])) end--;
  return createHash("sha256").update(line.subarray(start, end)).digest("hex").slice(0, 8);
}
var built = 0;
function fileLines(bytes) {
  built++;
  const stamps2 = [];
  for (let start = 0, end; start < bytes.length; start = end + 1) {
    end = bytes.indexOf(10, start);
    if (end < 0) end = bytes.length;
    stamps2.push(stampOf(bytes.subarray(start, end)));
  }
  const found = /* @__PURE__ */ new Map();
  stamps2.forEach((stamp, i) => found.set(stamp, found.has(stamp) ? 0 : i + 1));
  return { stamps: stamps2, found };
}
function cachedLines(repo) {
  const read = /* @__PURE__ */ new Map();
  return (path) => {
    if (!read.has(path)) {
      try {
        read.set(path, isPlainFile(repo, path) ? fileLines(readFileSync5(join5(repo, path))) : null);
      } catch {
        read.set(path, null);
      }
    }
    return read.get(path);
  };
}
function readEvidence(text) {
  const colon = text.lastIndexOf(":");
  const path = text.slice(0, Math.max(colon, 0));
  const tail = /^([1-9][0-9]*)(?:#([0-9a-f]{8}))?$/.exec(text.slice(colon + 1));
  if (colon < 0 || tail === null || !isPathForm(path)) return null;
  return { path, line: Number(tail[1]), stamp: tail[2] ?? null };
}
function judge(e, files) {
  const none = (state) => ({ state, line: null, stamp: null });
  if (e.stamp === null) {
    const count2 = files.count(e.path);
    if (count2 === null) return none("no-file");
    if (count2 < e.line) return none("no-line");
    return { state: "no-stamp", line: e.line, stamp: null };
  }
  const lines = files.lines(e.path);
  if (lines === null) return none("no-file");
  const now = lines.stamps[e.line - 1];
  if (now === e.stamp) return { state: "same", line: e.line, stamp: e.stamp };
  const found = lines.found.get(e.stamp);
  if (found) return { state: "elsewhere", line: found, stamp: e.stamp };
  if (now === void 0) return none("no-line");
  return { state: "differs", line: e.line, stamp: now };
}

// src/validate.ts
var SEVERITY = {
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
  "evidence-not-read": "info",
  "evidence-no-file": "info",
  "evidence-no-line": "info",
  "evidence-stamp-elsewhere": "info",
  "evidence-stamp-differs": "info",
  "import-without-use": "info",
  "use-without-import": "info",
  "import-needs-check": "info",
  "tsconfig-not-read": "info",
  "tsconfig-references-not-followed": "info"
};
function diagnostic(code, at, message) {
  return { code, severity: SEVERITY[code], at, message };
}
var ID_FORM = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
var REFERENCE = /\{([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\}/g;
var KNOWN = {
  plan: ["format", "name", "about", "parts", "externals", "scenarios", "tasks", "note"],
  part: ["id", "name", "zone", "about", "start", "paths", "planned", "uses", "note"],
  use: ["to", "why", "evidence", "note"],
  external: ["id", "name", "about", "note"],
  scenario: ["id", "name", "steps", "note"],
  step: ["at", "does", "note"],
  task: ["id", "name", "status", "parts", "makes", "note"]
};
var STATUSES = ["todo", "doing", "done"];
var isStatus = (v) => STATUSES.includes(v);
var isObj2 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var validId = (v) => typeof v === "string" && ID_FORM.test(v);
var arrayOf = (v) => Array.isArray(v) ? v : [];
function goodPaths(paths) {
  return Array.isArray(paths) && paths.length > 0 && paths.every((p2) => typeof p2 === "string" && p2 !== "");
}
function preparePlan(raw) {
  const prepared = {
    raw,
    parts: [],
    excluded: 0,
    repeatedItems: /* @__PURE__ */ new Set(),
    targets: /* @__PURE__ */ new Set(),
    partIds: /* @__PURE__ */ new Set(),
    usesOf: /* @__PURE__ */ new Map(),
    skipInGaps: /* @__PURE__ */ new Set(),
    used: /* @__PURE__ */ new Set(),
    brokenRelation: false
  };
  if (!isObj2(raw)) return prepared;
  const parts = arrayOf(raw.parts);
  const externals = arrayOf(raw.externals);
  const scenarios = arrayOf(raw.scenarios);
  const seen = /* @__PURE__ */ new Set();
  for (const item of [...parts, ...externals, ...scenarios, ...arrayOf(raw.tasks)]) {
    if (!isObj2(item) || !validId(item.id)) continue;
    if (seen.has(item.id)) prepared.repeatedItems.add(item);
    else seen.add(item.id);
  }
  const kept = (item) => isObj2(item) && validId(item.id) && !prepared.repeatedItems.has(item);
  for (const item of [...parts, ...externals]) if (kept(item)) prepared.targets.add(item.id);
  for (const part of parts) if (kept(part)) prepared.partIds.add(part.id);
  for (const part of parts) {
    if (kept(part) && goodPaths(part.paths)) prepared.parts.push({ id: part.id, paths: part.paths, planned: part.planned === true });
    else prepared.excluded++;
    if (!isObj2(part)) continue;
    if (prepared.repeatedItems.has(part)) prepared.skipInGaps.add(part.id);
    if (part.uses === void 0) continue;
    if (!Array.isArray(part.uses)) {
      prepared.brokenRelation = true;
      if (validId(part.id)) prepared.skipInGaps.add(part.id);
      continue;
    }
    for (const use of part.uses) {
      if (!isObj2(use) || !validId(use.to) || !prepared.targets.has(use.to)) {
        prepared.brokenRelation = true;
        continue;
      }
      prepared.used.add(use.to);
      if (kept(part)) {
        const set = prepared.usesOf.get(part.id) ?? /* @__PURE__ */ new Set();
        set.add(use.to);
        prepared.usesOf.set(part.id, set);
      }
    }
  }
  for (const scenario of scenarios) {
    if (!isObj2(scenario)) continue;
    if (!Array.isArray(scenario.steps)) {
      prepared.brokenRelation = true;
      continue;
    }
    for (const step of scenario.steps) {
      if (!isObj2(step) || !validId(step.at) || !prepared.targets.has(step.at)) {
        prepared.brokenRelation = true;
        continue;
      }
      prepared.used.add(step.at);
    }
  }
  return prepared;
}
function taskPaths(task) {
  if (!("makes" in task)) return [];
  if (!Array.isArray(task.makes)) return null;
  return [...new Set(task.makes.filter((p2) => typeof p2 === "string" && isPathForm(p2)))].sort(byCodeUnit2);
}
function planTasks(prepared, isFile) {
  if (!isObj2(prepared.raw)) return [];
  const out = [];
  for (const task of arrayOf(prepared.raw.tasks)) {
    if (!isObj2(task) || !validId(task.id) || prepared.repeatedItems.has(task)) continue;
    const makes = taskPaths(task) ?? [];
    out.push({
      id: task.id,
      name: typeof task.name === "string" ? task.name : "",
      status: isStatus(task.status) ? task.status : null,
      parts: [...new Set(arrayOf(task.parts).filter((p2) => validId(p2) && prepared.partIds.has(p2)))],
      makes,
      missing: makes.filter((p2) => !isFile(p2))
    });
  }
  return out;
}
function evidenceItems(prepared) {
  const out = [];
  if (!isObj2(prepared.raw)) return out;
  arrayOf(prepared.raw.parts).forEach((part, i) => {
    if (!isObj2(part) || prepared.repeatedItems.has(part) || !Array.isArray(part.uses)) return;
    part.uses.forEach((use, k) => {
      if (!isObj2(use) || !Array.isArray(use.evidence)) return;
      use.evidence.forEach((evidence, j) => {
        if (typeof evidence !== "string") return;
        out.push({
          at: `parts[${i}].uses[${k}].evidence[${j}]`,
          part: validId(part.id) ? part.id : null,
          to: validId(use.to) ? use.to : null,
          evidence,
          form: readEvidence(evidence)
        });
      });
    });
  });
  return out;
}
function evidenceFinding(text, facts) {
  const written = JSON.stringify(text);
  const evidence = readEvidence(text);
  if (evidence === null) return ["evidence-not-read", `evidence ${written} is not written as file:line`];
  const { state } = judge(evidence, { count: facts.lineCount, lines: facts.stampLines });
  const sentence = {
    "no-file": `the file of evidence ${written} is not a file in the repository`,
    "no-line": `the file of evidence ${written} does not have that line`,
    elsewhere: `one other line of the file has the stamp of evidence ${written}`,
    differs: `the line of evidence ${written} does not have its stamp`
  }[state];
  return sentence === void 0 ? null : [`evidence-${state.startsWith("no-") ? "" : "stamp-"}${state}`, sentence];
}
function diagnosePlan(prepared, facts) {
  const out = [];
  const emit = (code, at, message) => out.push(diagnostic(code, at, message));
  const raw = prepared.raw;
  if (!isObj2(raw)) {
    emit("bad-shape", "plan", "the plan must be a JSON object");
    return out;
  }
  const measured = new Set(prepared.parts.map((p2) => p2.id));
  const plannedIds = new Set(prepared.parts.filter((p2) => p2.planned).map((p2) => p2.id));
  const imports = facts.imports;
  const js = facts.js;
  const pairExample = (a, b) => {
    const found = [imports?.pairs.get(a)?.get(b), js?.pairs.get(a)?.get(b)].filter((p2) => p2 !== void 0);
    return found.sort(byCodeUnit2)[0];
  };
  const sharePackage = (a, b) => [...imports.packages.get(a)].some((p2) => imports.packages.get(b).has(p2));
  const missing = (at, who, key) => emit("bad-shape", at, `${who}\`${key}\` is required`);
  const string = (obj, key, at, who, required) => {
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
  const text = (obj, key, at, who, required, refs) => {
    if (!string(obj, key, at, who, required) || !refs) return;
    const named = /* @__PURE__ */ new Set();
    for (const match of obj[key].matchAll(REFERENCE)) {
      const id2 = match[1];
      if (prepared.targets.has(id2) || named.has(id2)) continue;
      named.add(id2);
      emit("unknown-reference", at, `${who}{${id2}} names no part or external`);
    }
  };
  const rest = (obj, at, who, known) => {
    const place = (key) => at === "" ? key : `${at}.${key}`;
    if ("note" in obj && typeof obj.note !== "string") {
      emit("bad-shape", place("note"), `${who}\`note\` must be a string`);
    }
    for (const key of Object.keys(obj).filter((k) => !known.includes(k)).sort(byCodeUnit2)) {
      emit("bad-shape", place(key), `${who}unknown key \`${key}\``);
    }
  };
  const id = (obj, at, kind, repeated) => {
    if (!("id" in obj)) missing(`${at}.id`, "", "id");
    else if (!validId(obj.id)) {
      emit("bad-shape", `${at}.id`, `${kind} id must be lowercase letters, digits and inner hyphens`);
    } else if (repeated) {
      emit("repeated-id", `${at}.id`, `${kind} "${obj.id}": the id is used by an earlier item`);
    }
    return validId(obj.id) ? `${kind} "${obj.id}": ` : "";
  };
  for (const finding of js?.configs ?? []) emit(finding.code, "plan", finding.message);
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
  function checkTask(task, at) {
    if (!isObj2(task)) {
      emit("bad-shape", at, "a task must be an object");
      return;
    }
    const repeated = prepared.repeatedItems.has(task);
    const who = id(task, at, "task", repeated);
    string(task, "name", `${at}.name`, who, true);
    const paths = taskPaths(task);
    const there = (paths ?? []).filter((p2) => facts.isFile(p2)).length;
    if (!("status" in task)) missing(`${at}.status`, who, "status");
    else if (!isStatus(task.status)) {
      emit("bad-shape", `${at}.status`, `${who}\`status\` must be todo, doing or done`);
    } else if (!repeated && paths !== null) {
      if (task.status === "done" && there < paths.length) {
        emit(
          "task-done-missing",
          `${at}.status`,
          `${who}the status is done and ${there} of ${paths.length} files in \`makes\` are in the repository`
        );
      }
      if (task.status === "todo" && there >= 1) {
        emit(
          "task-todo-has-files",
          `${at}.status`,
          `${who}the status is todo and ${there} of ${paths.length} files in \`makes\` are already in the repository`
        );
      }
    }
    if ("parts" in task) {
      if (!Array.isArray(task.parts)) {
        emit("bad-shape", `${at}.parts`, `${who}\`parts\` must be an array of part ids`);
      } else {
        const seenPart = /* @__PURE__ */ new Set();
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
      const seenPath = /* @__PURE__ */ new Set();
      arrayOf(task.makes).forEach((path, j) => {
        if (typeof path !== "string" || !isPathForm(path)) {
          emit("bad-shape", `${at}.makes[${j}]`, `${who}a path in \`makes\` must be a path inside the repository`);
          return;
        }
        if (seenPath.has(path)) return;
        seenPath.add(path);
        if (!repeated && prepared.excluded === 0 && !facts.isFile(path) && facts.unowned(path)) {
          emit("task-path-unowned", `${at}.makes[${j}]`, `${who}${path} would be a watched file that no part owns`);
        }
      });
    }
    rest(task, at, who, KNOWN.task);
  }
  function checkPart(part, at) {
    if (!isObj2(part)) {
      emit("bad-shape", at, "a part must be an object");
      return;
    }
    const repeated = prepared.repeatedItems.has(part);
    const who = id(part, at, "part", repeated);
    const partId = validId(part.id) ? part.id : null;
    const isMeasured = partId !== null && !repeated && measured.has(partId);
    const planned = part.planned === true;
    string(part, "name", `${at}.name`, who, true);
    string(part, "zone", `${at}.zone`, who, false);
    text(part, "about", `${at}.about`, who, true, !repeated);
    if ("start" in part) {
      const start = part.start;
      if (typeof start !== "string" || !isPathForm(start)) {
        emit("bad-shape", `${at}.start`, `${who}\`start\` must be a path inside the repository`);
      } else if (!repeated) {
        let isFile = false;
        try {
          isFile = lstatSync3(join6(facts.repo, start), { throwIfNoEntry: false })?.isFile() ?? false;
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
      paths.forEach((p2, j) => {
        if (typeof p2 !== "string" || p2 === "") {
          emit("bad-shape", `${at}.paths[${j}]`, `${who}a pattern must be a non-empty string`);
        }
      });
      if (isMeasured && !planned && facts.files.get(partId) === 0) {
        emit("empty-part", `${at}.paths`, `${who}its paths match no watched file`);
      }
    } else if (paths !== void 0 && !Array.isArray(paths)) {
      emit("bad-shape", `${at}.paths`, `${who}\`paths\` must be an array of patterns`);
    } else if (!repeated) {
      emit("no-paths", `${at}.paths`, `${who}a part needs at least one pattern in \`paths\``);
    }
    if ("planned" in part && typeof part.planned !== "boolean") {
      emit("bad-shape", `${at}.planned`, `${who}\`planned\` must be true or false`);
    } else if (planned && isMeasured && facts.files.get(partId) > 0) {
      emit(
        "planned-has-files",
        `${at}.planned`,
        `${who}the part is planned, but ${facts.files.get(partId)} watched files are measured in it`
      );
    }
    const uses = "uses" in part ? part.uses : [];
    if ((imports !== null || js !== null) && partId !== null && !repeated && !planned && Array.isArray(uses)) {
      const named = new Set(uses.map((use) => isObj2(use) ? use.to : void 0));
      for (const other of prepared.parts) {
        if (other.planned || named.has(other.id)) continue;
        const example = pairExample(partId, other.id);
        const written = js?.onlyWritten.get(partId)?.get(other.id);
        if (example === void 0 && written !== void 0) {
          emit(
            "import-needs-check",
            `${at}.uses`,
            `${who}${written.file} may import files of part "${other.id}" through ${JSON.stringify(written.path)}, found only when comments and strings are read too, and the plan has no use of it`
          );
        }
        if (example === void 0) continue;
        emit(
          "import-without-use",
          `${at}.uses`,
          `${who}files of this part import files of part "${other.id}" and the plan has no use of it, for example ${example}`
        );
      }
    }
    if ("uses" in part) {
      if (!Array.isArray(part.uses)) {
        emit("bad-shape", `${at}.uses`, `${who}\`uses\` must be an array`);
      } else {
        const seenTo = /* @__PURE__ */ new Set();
        part.uses.forEach((use, k) => {
          const uat = `${at}.uses[${k}]`;
          if (!isObj2(use)) {
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
            if (imports !== null && partId !== null && to !== partId && prepared.partIds.has(to) && !planned && !plannedIds.has(to) && imports.packages.has(partId) && imports.packages.has(to) && !sharePackage(partId, to) && pairExample(partId, to) === void 0 && !imports.possible.get(partId)?.has(to)) {
              emit("use-without-import", `${uat}.to`, `${who}no file of this part imports a file of part "${to}"`);
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
                } else if (!repeated) {
                  const found = evidenceFinding(e, facts);
                  if (found !== null) emit(found[0], `${uat}.evidence[${j}]`, `${who}${found[1]}`);
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
  function checkExternal(external, at) {
    if (!isObj2(external)) {
      emit("bad-shape", at, "an external must be an object");
      return;
    }
    const repeated = prepared.repeatedItems.has(external);
    if (validId(external.id) && !repeated && prepared.repeatedItems.size === 0 && !prepared.brokenRelation && !prepared.used.has(external.id)) {
      emit("unused-external", at, `external "${external.id}": no use or step names it`);
    }
    const who = id(external, at, "external", repeated);
    string(external, "name", `${at}.name`, who, true);
    text(external, "about", `${at}.about`, who, true, !repeated);
    rest(external, at, who, KNOWN.external);
  }
  function checkScenario(scenario, at) {
    if (!isObj2(scenario)) {
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
      const known = (step) => isObj2(step) && validId(step.at) && prepared.targets.has(step.at) && !prepared.skipInGaps.has(step.at) ? step.at : null;
      const linked = (a, b) => (prepared.usesOf.get(a)?.has(b) ?? false) || (prepared.usesOf.get(b)?.has(a) ?? false);
      steps.forEach((step, k) => {
        const sat = `${at}.steps[${k}]`;
        if (!isObj2(step)) {
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
  const first = /* @__PURE__ */ new Map();
  out.forEach((d, i) => {
    if (!first.has(d.at)) first.set(d.at, i);
  });
  return out.map((d, i) => ({ d, i })).sort((x, y) => first.get(x.d.at) - first.get(y.d.at) || byCodeUnit2(x.d.code, y.d.code) || x.i - y.i).map((x) => x.d);
}

// src/summary.ts
var oneLine = (text) => text.replace(/\r\n|\n|\r/g, " ");
var shown = (item) => item.name === "" ? item.id : item.name;
var filesCell = (task) => task.makes.length === 0 ? "" : `${task.makes.length - task.missing.length} of ${task.makes.length}`;
var plain = (text) => oneLine(text).replace(/[\\`*_[\]<>|~&#]/g, "\\$&");
function lineStart(text) {
  if (/^[-+=]/.test(text)) return `\\${text}`;
  return text.replace(/^([0-9]+)([.)])/, "$1\\$2");
}
function nodeLabel(text) {
  return oneLine(text).replace(/["#%&<>`|]/g, (c) => `#${c.charCodeAt(0)};`);
}
function mermaidLines(value) {
  const plan = value;
  const node = /* @__PURE__ */ new Map();
  plan.parts.forEach((p2, i) => node.set(p2.id, `p${i}`));
  (plan.externals ?? []).forEach((e, i) => node.set(e.id, `x${i}`));
  const partLine = (p2, indent) => `${indent}${node.get(p2.id)}["${nodeLabel(shown(p2))}"]`;
  const zoneOf = (p2) => p2.zone ?? "";
  const lines = ["flowchart LR"];
  const zones = [...new Set(plan.parts.map(zoneOf).filter((z) => z !== ""))].sort(byCodeUnit2);
  zones.forEach((zone, i) => {
    lines.push(`  subgraph z${i}["${nodeLabel(zone)}"]`);
    for (const p2 of plan.parts) if (zoneOf(p2) === zone) lines.push(partLine(p2, "    "));
    lines.push("  end");
  });
  for (const p2 of plan.parts) if (zoneOf(p2) === "") lines.push(partLine(p2, "  "));
  for (const e of plan.externals ?? []) lines.push(`  ${node.get(e.id)}[("${nodeLabel(shown(e))}")]`);
  for (const p2 of plan.parts) {
    for (const use of p2.uses ?? []) {
      const why = use.why ?? "";
      const arrow = why === "" ? "-->" : `-->|"${nodeLabel(why)}"|`;
      lines.push(`  ${node.get(p2.id)} ${arrow} ${node.get(use.to)}`);
    }
  }
  const planned = plan.parts.filter((p2) => p2.planned === true).map((p2) => node.get(p2.id));
  if (planned.length > 0) {
    lines.push("  classDef planned stroke-dasharray: 5 5", `  class ${planned.join(",")} planned`);
  }
  return lines;
}
function mermaidText(value) {
  return `${mermaidLines(value).join("\n")}
`;
}
function summaryText(value, m, tasks) {
  const plan = value;
  const externals = plan.externals ?? [];
  const scenarios = plan.scenarios ?? [];
  const names = /* @__PURE__ */ new Map();
  for (const item of [...plan.parts, ...externals]) names.set(item.id, shown(item));
  const strong = (id) => `**${plain(names.get(id))}**`;
  const prose = (text) => {
    const line = oneLine(text);
    let out = "";
    let from = 0;
    for (const match of line.matchAll(REFERENCE)) {
      if (!names.has(match[1])) continue;
      out += plain(line.slice(from, match.index)) + strong(match[1]);
      from = match.index + match[0].length;
    }
    return out + plain(line.slice(from));
  };
  const paragraph = (text) => {
    const trimmed = oneLine(text).replace(/^[ \t]+|[ \t]+$/g, "");
    if (trimmed !== "") blocks.push(lineStart(prose(trimmed)));
  };
  const row = (cells) => `| ${cells.join(" | ")} |`;
  const blocks = [`# ${plan.name === "" ? "codeplan" : plain(plan.name)}`];
  paragraph(plan.about);
  blocks.push("## Parts");
  const counts = new Map(m.parts.map((p2) => [p2.id, p2]));
  blocks.push(
    [
      "| Part | Id | Zone | Files | Lines |",
      "|---|---|---|---|---|",
      ...plan.parts.map((p2) => {
        const count2 = counts.get(p2.id);
        const [files, lines] = p2.planned === true ? ["planned", "planned"] : [count2.files, count2.lines];
        return row([plain(shown(p2)), p2.id, plain(p2.zone ?? ""), files, lines]);
      })
    ].join("\n")
  );
  if (m.orphans.length > 0) blocks.push(`${m.orphans.length} watched files belong to no part.`);
  if (m.unwatched.length > 0) blocks.push(`${m.unwatched.length} code files are outside the watch set.`);
  for (const p2 of plan.parts) {
    blocks.push(`### ${plain(shown(p2))}`);
    paragraph(p2.about);
    const uses = p2.uses ?? [];
    if (uses.length > 0) {
      blocks.push("Uses:");
      blocks.push(
        uses.map((u) => `- ${strong(u.to)}${u.why === void 0 || u.why === "" ? "" : `: ${prose(u.why)}`}`).join("\n")
      );
    }
  }
  if (externals.length > 0) {
    blocks.push("## Externals");
    blocks.push(
      [
        "| External | Id | About |",
        "|---|---|---|",
        ...externals.map((e) => row([plain(shown(e)), e.id, prose(e.about)]))
      ].join("\n")
    );
  }
  if (scenarios.length > 0) {
    blocks.push("## Scenarios");
    for (const s of scenarios) {
      blocks.push(`### ${plain(shown(s))}`);
      if (s.steps.length > 0) {
        blocks.push(
          s.steps.map((step, k) => `${k + 1}. ${strong(step.at)}${step.does === "" ? "" : `: ${prose(step.does)}`}`).join("\n")
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
        ...tasks.map(
          (t) => row([
            plain(shown(t)),
            t.id,
            t.status,
            filesCell(t),
            t.parts.map((id) => plain(names.get(id))).join(", ")
          ])
        )
      ].join("\n")
    );
  }
  blocks.push("## Diagram");
  blocks.push(["```mermaid", ...mermaidLines(plan), "```"].join("\n"));
  return `${blocks.join("\n\n")}
`;
}

// src/report.ts
var SNAPSHOT_FORMAT = 1;
var RULES = 1;
var LIST_LIMIT = 30;
var STAMP_CODES = ["stamp-elsewhere", "stamp-differs", "no-line", "no-file"].map((c) => `evidence-${c}`);
var COUNT_KEYS = ["entries", "elsewhere", "differs", "noLine", "noFile"];
var shown2 = (text) => {
  const points = [...text.replace(/\r\n|\n|\r/g, " ").replace(/[\p{Cc}\p{Cf}]/gu, "\uFFFD")];
  const more = points.length - 300;
  return plain(points.slice(0, 300).join("")) + (more > 0 ? ` (${more} more characters)` : "");
};
var entryKey = (e) => JSON.stringify([e.part, e.to, e.evidence]);
function tallyKeys(keys) {
  const n = /* @__PURE__ */ new Map();
  for (const k of keys) n.set(k, (n.get(k) ?? 0) + 1);
  return n;
}
function takeSnapshot(found) {
  const { config, measurement: m } = found;
  const counts = new Map(m.parts.map((p2) => [p2.id, p2]));
  const contested = new Set(m.contested.map((c) => c.path));
  const complete = found.excluded === 0;
  const at = new Map(found.stamped.map((e) => [e.at, e]));
  const hits = found.diagnostics.map((d) => at.get(d.at));
  const seen = tallyKeys(hits.flatMap((e) => e ? [entryKey(e)] : []));
  const entryOf = (e) => e?.part && e.to && seen.get(entryKey(e)) === 1 && { entry: { part: e.part, to: e.to, evidence: e.evidence } };
  const count2 = (i) => found.diagnostics.filter((d, j) => hits[j] && d.code === STAMP_CODES[i]).length;
  return {
    snapshot: SNAPSHOT_FORMAT,
    rules: RULES,
    config: {
      languages: config.languages,
      watch: config.watch,
      skip: config.skip,
      roots: config.roots,
      tests: config.tests
    },
    plan: !found.hasPlan ? "missing" : found.diagnostics.some((d) => d.severity === "error") ? "invalid" : "ok",
    complete,
    page: found.pageState,
    parts: found.measured.map((p2) => ({
      id: p2.id,
      paths: p2.paths,
      planned: p2.planned === true,
      files: counts.get(p2.id).files,
      lines: counts.get(p2.id).lines
    })),
    ...found.jsImports === null ? {} : {
      jsImports: {
        ...found.jsImports,
        toCheck: found.diagnostics.filter((d) => d.code === "import-needs-check").length
      }
    },
    ...at.size === 0 ? {} : { stampEntries: { entries: at.size, elsewhere: count2(0), differs: count2(1), noLine: count2(2), noFile: count2(3) } },
    owned: [...m.owners].filter(([path, part]) => part !== null && !contested.has(path)).map(([path, part]) => ({ path, part, pattern: m.wonBy.get(path) })).sort((a, b) => byCodeUnit2(a.path, b.path)),
    orphans: complete ? [...m.orphans].sort(byCodeUnit2) : [],
    contested: m.contested.map((c) => ({ path: c.path, parts: [...c.parts].sort(byCodeUnit2) })).sort((a, b) => byCodeUnit2(a.path, b.path)),
    unwatched: [...m.unwatched].sort(byCodeUnit2),
    tasks: found.tasks.map((t) => ({ id: t.id, status: t.status, makes: t.makes, missing: t.missing })),
    diagnostics: found.diagnostics.map((d, i) => ({
      at: d.at,
      code: d.code,
      severity: d.severity,
      message: d.message,
      fix: found.fix(d.code),
      ...entryOf(hits[i])
    }))
  };
}
function snapshotText(snapshot2) {
  return `${JSON.stringify(snapshot2, null, 2)}
`;
}
var isObj3 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var strings = (v) => Array.isArray(v) && v.every((s) => typeof s === "string");
var each = (v, ok) => Array.isArray(v) && v.every((item) => isObj3(item) && ok(item));
function readSnapshot(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("it is not JSON");
  }
  const snapshot2 = shapedSnapshot(value);
  const j = snapshot2.jsImports;
  const count2 = (v) => Number.isInteger(v) && v >= 0;
  if ("jsImports" in snapshot2 && (!isObj3(j) || !count2(j.files) || !count2(j.notResolved) || !count2(j.toCheck))) {
    throw new Error("its jsImports does not have the fields of a snapshot");
  }
  const s = snapshot2.stampEntries;
  const shaped = (e) => isObj3(e) && [e.part, e.to, e.evidence].every((v) => typeof v === "string");
  if ("stampEntries" in snapshot2 && !(isObj3(s) && COUNT_KEYS.every((k) => Number.isSafeInteger(s[k]) && s[k] >= 0)) || snapshot2.diagnostics.some((d) => "entry" in d && !shaped(d.entry))) {
    throw new Error("its stampEntries or an entry of its diagnostics does not have the fields of a snapshot");
  }
  return snapshot2;
}
function shapedSnapshot(value) {
  if (!isObj3(value)) throw new Error("it is not a snapshot");
  if (value.snapshot !== SNAPSHOT_FORMAT) {
    throw new Error(`its snapshot format is ${JSON.stringify(value.snapshot)}, and this codeplan reads ${SNAPSHOT_FORMAT}`);
  }
  if (value.rules !== RULES) {
    throw new Error(`its counting rules are ${JSON.stringify(value.rules)}, and this codeplan counts with ${RULES}`);
  }
  const shaped = isObj3(value.config) && (value.plan === "ok" || value.plan === "missing" || value.plan === "invalid") && typeof value.complete === "boolean" && typeof value.page === "string" && each(
    value.parts,
    (p2) => typeof p2.id === "string" && strings(p2.paths) && typeof p2.planned === "boolean" && typeof p2.files === "number" && typeof p2.lines === "number"
  ) && each(value.owned, (o) => typeof o.path === "string" && typeof o.part === "string" && typeof o.pattern === "string") && strings(value.orphans) && each(value.contested, (c) => typeof c.path === "string" && strings(c.parts)) && strings(value.unwatched) && each(value.diagnostics, (d) => typeof d.at === "string" && typeof d.code === "string");
  if (!shaped) throw new Error("it does not have the fields of a snapshot");
  if (!("tasks" in value)) value.tasks = [];
  const tasksShaped = each(
    value.tasks,
    (t) => typeof t.id === "string" && (t.status === null || STATUSES.includes(t.status)) && strings(t.makes) && strings(t.missing)
  );
  if (!tasksShaped) throw new Error("its tasks do not have the fields of a snapshot");
  const ids = value.tasks.map((t) => t.id);
  if (new Set(ids).size !== ids.length) throw new Error("two of its tasks have the same id");
  return value;
}
function list(items, line) {
  const lines = items.slice(0, LIST_LIMIT).map((item) => `- ${line(item)}`);
  if (items.length > LIST_LIMIT) lines.push(`- and ${items.length - LIST_LIMIT} more`);
  return lines.join("\n");
}
function statusLine(head) {
  const errors = head.diagnostics.filter((d) => d.severity === "error").length;
  const counted = [
    [errors, "errors"],
    [head.diagnostics.filter((d) => d.severity === "warning").length, "warnings"],
    [head.orphans.length, "orphan files"],
    [head.contested.length, "contested files"],
    [head.unwatched.length, "unwatched files"]
  ];
  const reasons = counted.filter(([n]) => n > 0).map(([n, what]) => `${n} ${what}`);
  if (head.page === "outdated") reasons.push("page outdated");
  if (head.page === "missing") reasons.push("page missing");
  if (head.page === "foreign") reasons.push("foreign page");
  if (!head.complete) reasons.push("measurement incomplete");
  return reasons.length === 0 ? "check: ok" : `check: fails (${reasons.join(", ")})`;
}
function sameValue(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  if (isObj3(a) && isObj3(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => k in b && sameValue(a[k], b[k]));
  }
  return a === b;
}
var configOf = ({ config }) => ({
  languages: config.languages,
  watch: config.watch,
  skip: config.skip,
  roots: config.roots,
  tests: config.tests
});
function table(head, rows, row) {
  const columns = head.split("|").length - 2;
  const blocks = [[head, `|${"---|".repeat(columns)}`, ...rows.slice(0, LIST_LIMIT).map(row)].join("\n")];
  if (rows.length > LIST_LIMIT) blocks.push(`And ${rows.length - LIST_LIMIT} more rows.`);
  return blocks;
}
var taskRow = (t) => `| ${shown2(t.id)} | ${t.status ?? ""} | ${filesCell(t)} |`;
function taskChanges(head, base) {
  const before = new Map(base.tasks.map((t) => [t.id, t]));
  const after = new Set(head.tasks.map((t) => t.id));
  const paths = (list2) => [...new Set(list2)].sort(byCodeUnit2);
  const counts = (t) => `${t.makes.length - t.missing.length} of ${t.makes.length}`;
  const rows = [];
  for (const t of head.tasks) {
    const b = before.get(t.id);
    if (b === void 0) {
      rows.push([t.id, t.status ?? "", filesCell(t), "new"]);
    } else if (b.status !== t.status || !sameValue(paths(b.makes), paths(t.makes)) || !sameValue(paths(b.missing), paths(t.missing))) {
      rows.push([t.id, `${b.status ?? ""} \u2192 ${t.status ?? ""}`, `${counts(b)} \u2192 ${counts(t)}`, "changed"]);
    }
  }
  for (const b of base.tasks) if (!after.has(b.id)) rows.push([b.id, b.status ?? "", filesCell(b), "removed"]);
  return rows;
}
function rulesDiffer(head, base) {
  const before = new Map(base.parts.map((p2) => [p2.id, p2]));
  return !sameValue(configOf(base), configOf(head)) || head.parts.some((p2) => before.has(p2.id) && !sameValue(before.get(p2.id).paths, p2.paths));
}
function compare(head, base) {
  if (base.plan === "missing") return { compared: false, why: "no-plan" };
  if (!base.complete || !head.complete) return { compared: false, why: base.complete ? "head" : "base" };
  const before = new Map(base.parts.map((p2) => [p2.id, p2]));
  const after = new Set(head.parts.map((p2) => p2.id));
  const parts = [];
  for (const p2 of head.parts) {
    const b = before.get(p2.id);
    if (b === void 0) {
      parts.push({ id: p2.id, files: `${p2.files}`, lines: `${p2.lines}`, change: "new", by: null });
    } else if (b.planned && !p2.planned || b.files !== p2.files || b.lines !== p2.lines) {
      const change = b.planned && p2.files >= 1 ? "planned, has code" : "changed";
      parts.push({ id: p2.id, files: `${b.files} \u2192 ${p2.files}`, lines: `${b.lines} \u2192 ${p2.lines}`, change, by: p2.lines - b.lines });
    }
  }
  for (const b of base.parts) {
    if (!after.has(b.id)) parts.push({ id: b.id, files: `${b.files}`, lines: `${b.lines}`, change: "removed", by: null });
  }
  const tasks = base.plan === "invalid" || head.plan === "invalid" ? "invalid" : base.tasks.length === 0 && head.tasks.length === 0 ? null : taskChanges(head, base);
  return { compared: true, parts, rulesDiffer: rulesDiffer(head, base), tasks };
}
function changes(head, base) {
  const found = compare(head, base);
  if (!found.compared) {
    const block = found.why === "no-plan" ? "No plan in the base, so there is nothing to compare." : `Measurement is incomplete in the ${found.why}, so changes are not shown.`;
    return { blocks: [block], rulesDiffer: false };
  }
  const blocks = found.parts.length === 0 ? ["No part changed."] : table("| Part | Files | Lines | Change |", found.parts, (p2) => `| ${shown2(p2.id)} | ${p2.files} | ${p2.lines} | ${p2.change} |`);
  if (found.rulesDiffer) {
    blocks.push("The config or part patterns changed, so some changes come from new rules, not new code.");
  }
  if (found.tasks === "invalid") {
    blocks.push("The plan has errors, so task changes are not shown.");
  } else if (found.tasks !== null) {
    const row = ([id, ...cells]) => `| ${shown2(id)} | ${cells.join(" | ")} |`;
    blocks.push(...found.tasks.length === 0 ? ["No task changed."] : table("| Task | Status | Files | Change |", found.tasks, row));
  }
  return { blocks, rulesDiffer: found.rulesDiffer };
}
function newDirectories(head, base) {
  const dirOf2 = (path) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
  const baseDirs = new Set(
    [...base.owned.map((o) => o.path), ...base.orphans, ...base.contested.map((c) => c.path)].map(dirOf2)
  );
  const baseParts = new Set(base.parts.map((p2) => p2.id));
  const groups = /* @__PURE__ */ new Map();
  for (const file of head.owned) {
    if (!file.path.includes("/")) continue;
    const dir = dirOf2(file.path);
    const fixed = fixedHead(file.pattern);
    if (baseDirs.has(dir) || !baseParts.has(file.part)) continue;
    if (!`${dir}/`.startsWith(fixed) || dir.length + 1 <= fixed.length) continue;
    const key = JSON.stringify([dir, file.part, file.pattern]);
    const group = groups.get(key) ?? { dir, part: file.part, pattern: file.pattern, files: 0 };
    group.files++;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => byCodeUnit2(a.dir, b.dir) || byCodeUnit2(a.part, b.part) || byCodeUnit2(a.pattern, b.pattern));
}
function entryChanges(head, base) {
  let skipped = 0;
  const side = (s) => {
    const found = s.diagnostics.filter((d) => STAMP_CODES.includes(d.code));
    skipped += found.filter((d) => !d.entry && d.code.includes("stamp")).length;
    const keyed = found.flatMap((d) => d.entry ? [[entryKey(d.entry), d.entry]] : []);
    const n = tallyKeys(keyed.map(([k]) => k));
    skipped += keyed.filter(([k]) => n.get(k) > 1).length;
    return new Map(keyed.filter(([k]) => n.get(k) === 1));
  };
  const h = side(head);
  const b = side(base);
  const only = (one, other) => [...one].filter(([k]) => !other.has(k)).map(([, e]) => e);
  const line = (e) => `part ${shown2(e.part)} to ${shown2(e.to)}: ${shown2(e.evidence)}`;
  const added = only(h, b);
  const gone = only(b, h);
  return [
    ...added.length > 0 ? ["Reported in the head and not in the base:", list(added, line)] : [],
    ...gone.length > 0 ? ["Reported in the base and not in the head:", list(gone, line)] : [],
    ...added.length + gone.length > 0 ? [] : ["No entry is newly reported or no longer reported. An entry whose finding changed is not listed."],
    "Entries are paired only when the part id, the `to` value and the evidence string are the same; writing any of them differently makes another entry. That an entry is no longer reported does not mean it was fixed.",
    ...skipped > 0 ? [`${skipped} entries were not compared: their part id or \`to\` value is not of the right form, or the same entry is written more than once.`] : []
  ];
}
function reportText(head, base) {
  const blocks = ["## codeplan", statusLine(head)];
  if (head.diagnostics.length > 0) {
    blocks.push("### Findings");
    blocks.push(list(head.diagnostics, (d) => `${shown2(d.at)}: ${d.code} [${d.severity}] ${shown2(d.message)}`));
  }
  if (!head.complete) {
    blocks.push("Measurement is incomplete, so files in no part are not listed.");
  } else if (head.orphans.length > 0) {
    blocks.push("### Files in no part", list(head.orphans, shown2));
  }
  if (head.contested.length > 0) {
    blocks.push("### Contested files", list(head.contested, (c) => `${shown2(c.path)}: ${c.parts.map(shown2).join(", ")}`));
  }
  if (head.unwatched.length > 0) {
    blocks.push("### Unwatched files", list(head.unwatched, shown2));
  }
  if (head.tasks.length > 0) {
    blocks.push("### Tasks", ...table("| Task | Status | Files |", head.tasks, taskRow));
  }
  if (head.jsImports !== void 0) {
    const j = head.jsImports;
    const inBase = base?.jsImports === void 0 ? "" : ` In the base: ${base.jsImports.files}, ${base.jsImports.notResolved}, ${base.jsImports.toCheck}.`;
    blocks.push(
      "### JS and TS imports",
      `${j.files} files read, ${j.notResolved} import paths not resolved, ${j.toCheck} imports to check.${inBase}`
    );
  }
  const counted = head.stampEntries;
  const baseCounted = base?.stampEntries;
  if (counted !== void 0 || baseCounted !== void 0) {
    blocks.push("### Evidence entries with a stamp");
    if (counted === void 0) {
      blocks.push(`The head snapshot does not have these counts. The base had ${baseCounted.entries} evidence entries with a stamp.`);
    } else {
      const inBase = baseCounted === void 0 ? "" : ` In the base: ${COUNT_KEYS.map((k) => baseCounted[k]).join(", ")}.`;
      blocks.push(
        `${counted.entries} evidence entries with a stamp, ${counted.elsewhere} with the stamp on one other line, ${counted.differs} without the stamp on the written line, ${counted.noLine} with no such line, ${counted.noFile} with no such file.${inBase}`
      );
      if (base !== null) {
        blocks.push(...baseCounted === void 0 ? ["The base snapshot does not have these counts, so the entries are not compared."] : entryChanges(head, base));
      }
    }
  }
  if (base !== null) {
    const changed = changes(head, base);
    blocks.push("### Changes", ...changed.blocks);
    if (!changed.rulesDiffer && base.complete && head.complete) {
      const dirs = newDirectories(head, base);
      if (dirs.length > 0) blocks.push("### New directories", list(dirs, (g) => `${shown2(g.dir)}/: ${g.files} files went to part ${shown2(g.part)} through ${shown2(g.pattern)}`));
    }
  }
  return `${blocks.join("\n\n")}
`;
}

// src/history.ts
var HISTORY_MARK = "<!doctype html><!-- codeplan history -->";
var CONTROL = /[\u0000-\u001f\u007f]/g;
var PAGES = ["ok", "outdated", "missing", "foreign", "not-checked"];
var count = (n) => Number.isInteger(n) && n >= 0;
function candidate(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return "not JSON";
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const { snapshot: snapshot2, rules } = value;
    if (typeof snapshot2 === "number" && typeof rules === "number" && (snapshot2 !== SNAPSHOT_FORMAT || rules !== RULES)) {
      return "another version";
    }
  }
  let shaped;
  try {
    shaped = shapedSnapshot(value);
  } catch {
    return "not a snapshot";
  }
  const ids = shaped.parts.map((p2) => p2.id);
  const proper = PAGES.includes(shaped.page) && new Set(ids).size === ids.length && shaped.parts.every((p2) => count(p2.files) && count(p2.lines)) && shaped.diagnostics.every((d) => typeof d.severity === "string");
  return proper ? shaped : "not a snapshot";
}
function readRecords(dir) {
  const records = [];
  const skipped = [];
  const markers = [];
  const candidates = /* @__PURE__ */ new Set();
  for (const bytes of readdirSync2(dir, { encoding: "buffer" })) {
    const file = bytes.toString("utf8");
    const end = [".json", ".failed"].find((e) => file.endsWith(e) && file.length > e.length);
    if (end === void 0) continue;
    const path = Buffer.concat([Buffer.from(`${dir}/`), bytes]);
    if (!lstatSync4(path, { throwIfNoEntry: false })?.isFile()) continue;
    const name = file.slice(0, -end.length);
    if (end === ".json") candidates.add(name);
    if (!Buffer.from(file, "utf8").equals(bytes) || file.search(CONTROL) >= 0) {
      skipped.push({ file: file.replace(CONTROL, "\uFFFD"), reason: "unsupported name" });
      continue;
    }
    if (end === ".failed") {
      markers.push({ name, file, path });
      continue;
    }
    let text;
    try {
      text = readFileSync6(path, "utf8");
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
    let text;
    try {
      text = readFileSync6(path, "utf8");
    } catch {
      skipped.push({ file, reason: "cannot read" });
      continue;
    }
    const first = text.split("\n", 1)[0].replace(/\r$/, "");
    records.push({ name, snapshot: null, line: [...first].slice(0, 200).join("").replace(CONTROL, "\uFFFD") });
  }
  records.sort((a, b) => byCodeUnit2(a.name, b.name));
  skipped.sort((a, b) => byCodeUnit2(a.file, b.file));
  return { records, skipped };
}
var planFields = (s) => ({
  plan: s.plan,
  complete: s.complete,
  orphans: s.orphans,
  contested: s.contested.map((c) => ({ path: c.path, parts: c.parts })),
  unwatched: s.unwatched,
  diagnostics: s.diagnostics.map((d) => ({ at: d.at, code: d.code, severity: d.severity, message: d.message, fix: d.fix }))
});
var fields = (s) => ({
  ...planFields(s),
  config: configOf(s),
  page: s.page,
  parts: s.parts.map((p2) => ({ id: p2.id, paths: p2.paths, planned: p2.planned, files: p2.files, lines: p2.lines })),
  tasks: s.tasks.map((t) => ({ id: t.id, status: t.status, makes: t.makes, missing: t.missing }))
});
var outOfDate = (s) => s.plan !== "ok" || s.orphans.length > 0 || s.contested.length > 0 || s.unwatched.length > 0 || s.diagnostics.some((d) => d.severity === "warning" || d.severity === "error");
var sizeOf = (by) => Math.abs(by) < 10 ? 1 : Math.abs(by) < 100 ? 2 : 3;
function columnsOf(records) {
  const columns = [];
  let before = null;
  let follows = false;
  for (const record of records) {
    const s = record.snapshot;
    if (s === null) {
      columns.push({ record, marks: ["not measured"], same: [], before: null, found: null, cells: /* @__PURE__ */ new Map() });
      follows = false;
      continue;
    }
    const base = before?.snapshot ?? null;
    if (base !== null && follows && sameValue(fields(base), fields(s))) {
      columns[columns.length - 1].same.push(record.name);
    } else {
      const found = base === null ? null : compare(s, base);
      const marks = [];
      if (base === null ? outOfDate(s) : !sameValue(planFields(base), planFields(s))) marks.push("plan");
      if (base === null ? s.page !== "ok" : base.page !== s.page) marks.push("page");
      if (base !== null && rulesDiffer(s, base)) marks.push("config");
      if (base !== null && taskChanges(s, base).length > 0) marks.push("tasks");
      if (found !== null && !found.compared) marks.push("not compared");
      const cells = /* @__PURE__ */ new Map();
      if (found?.compared) {
        for (const p2 of found.parts) {
          cells.set(p2.id, p2.by === null ? { text: p2.change, size: null } : { text: `${p2.by < 0 ? "" : "+"}${p2.by}`, size: sizeOf(p2.by) });
        }
      }
      columns.push({ record, marks, same: [], before: before?.name ?? null, found, cells });
    }
    before = { name: record.name, snapshot: s };
    follows = true;
  }
  return columns;
}
function runs(items) {
  const found = [];
  let open = false;
  for (const { name, key } of items) {
    const last = found[found.length - 1];
    if (key !== null && open && last.key === key) last.last = name;
    else if (key !== null) found.push({ key, first: name, last: name });
    open = key !== null;
  }
  return found.map((r) => ({ key: r.key, span: r.first === r.last ? `in ${r.first}` : `from ${r.first} to ${r.last}` }));
}
function listed(items) {
  const shown3 = items.slice(0, LIST_LIMIT).join(", ");
  return items.length > LIST_LIMIT ? `${shown3}, and ${items.length - LIST_LIMIT} more.` : `${shown3}.`;
}
var PAGE_WAS = {
  outdated: "outdated",
  missing: "missing",
  foreign: "not a codeplan page",
  "not-checked": "not compared"
};
function statusSentences(records, skipped) {
  const measured = records.flatMap((r) => r.snapshot === null ? [] : [{ name: r.name, snapshot: r.snapshot }]);
  const plan = runs(measured.map((r) => ({ name: r.name, key: outOfDate(r.snapshot) ? "" : null })));
  const page = runs(measured.map((r) => ({ name: r.name, key: r.snapshot.page === "ok" ? null : r.snapshot.page })));
  const sentences = plan.length === 0 ? ["The plan was not out of date in any record."] : plan.map((r) => `The plan was out of date ${r.span}.`);
  if (page.length === 0) sentences.push("The page was up to date in every record.");
  for (const r of page) sentences.push(`The page was ${PAGE_WAS[r.key]} ${r.span}.`);
  const failed = records.filter((r) => r.snapshot === null).map((r) => r.name);
  if (failed.length > 0) sentences.push(`Not measured: ${listed(failed)}`);
  if (skipped.length > 0) sentences.push(`Files not read: ${listed(skipped.map((s) => `${s.file} (${s.reason})`))}`);
  return sentences;
}
function partIds(records) {
  const measured = records.flatMap((r) => r.snapshot === null ? [] : [r.snapshot]);
  const ids = new Set(measured[measured.length - 1].parts.map((p2) => p2.id));
  for (const s of measured) for (const p2 of s.parts) ids.add(p2.id);
  return [...ids];
}
var esc = (text) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
var p = (text) => `<p>${esc(text)}</p>`;
var tableOf = (head, rows) => `<table>
<tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr>
` + rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>
`).join("") + `</table>`;
function recordBlocks(column) {
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
        found.why === "no-plan" ? "No plan in the record before, so there is nothing to compare." : `Measurement is incomplete in ${found.why === "base" ? "the record before" : "this record"}, so changes are not shown.`
      )
    );
    return blocks;
  }
  blocks.push(
    found.parts.length === 0 ? p("No part changed.") : tableOf(
      ["Part", "Files", "Lines", "Change"],
      found.parts.map((part) => [part.id, part.files, part.lines, part.change])
    )
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
var SIZES = {
  light: { "--cp-size-1": "#dbe6f6", "--cp-size-2": "#c0d3ef", "--cp-size-3": "#a4c1e8" },
  dark: { "--cp-size-1": "#1b2d47", "--cp-size-2": "#263f63", "--cp-size-3": "#2f507d" }
};
var sizeTokens = (theme) => Object.entries(theme).map(([k, v]) => `${k}: ${v};`).join(" ");
var STYLE2 = `
${THEME_STYLE}
:root { ${sizeTokens(SIZES.light)} }
@media (prefers-color-scheme: dark) { :root:not([data-theme]) { ${sizeTokens(SIZES.dark)} } }
:root[data-theme="light"] { ${sizeTokens(SIZES.light)} }
:root[data-theme="dark"] { ${sizeTokens(SIZES.dark)} }
html, body { margin: 0; background: var(--cp-bg); color: var(--cp-text); font: 13px/1.4 system-ui, sans-serif; }
main { padding: 16px; }
p { margin: 0 0 4px; }
h2 { margin: 0 0 4px; font-size: 15px; font-weight: 600; }
.records { overflow-x: auto; margin: 12px 0; }
table { border-collapse: separate; border-spacing: 0; border-top: 1px solid var(--cp-control-line); }
th, td { border-right: 1px solid var(--cp-control-line); border-bottom: 1px solid var(--cp-control-line); padding: 4px 8px; text-align: left; vertical-align: top; white-space: nowrap; font-weight: 400; }
tr > :first-child { border-left: 1px solid var(--cp-control-line); }
.records tr > :first-child { position: sticky; left: 0; background: var(--cp-bg); }
.records th span { display: block; width: min-content; white-space: normal; color: var(--cp-text-dim); }
th[data-same] { color: var(--cp-text-dim); white-space: normal; width: 4.5em; max-width: 4.5em; }
th[data-marks~="config"], td.config { border-left: 4px solid var(--cp-control-line); }
.records td:not(:empty) { background: var(--cp-part-fill); box-shadow: inset 0 0 0 1px var(--cp-part-line); }
.records td[data-size="1"], p[data-role="sizes"] span[data-size="1"] { background: var(--cp-size-1); }
.records td[data-size="2"], p[data-role="sizes"] span[data-size="2"] { background: var(--cp-size-2); }
.records td[data-size="3"], p[data-role="sizes"] span[data-size="3"] { background: var(--cp-size-3); }
p[data-role="sizes"] span { padding: 0 4px; box-shadow: inset 0 0 0 1px var(--cp-part-line); }
.records [data-active] { box-shadow: inset 3px 0 0 var(--cp-active), inset -3px 0 0 var(--cp-active); font-weight: 700; }
.records td[data-active]:not(:empty) { box-shadow: inset 0 0 0 3px var(--cp-active); }
button { background: var(--cp-control-fill); color: var(--cp-control-text); border: 1px solid var(--cp-control-line); border-radius: 4px; font: inherit; padding: 2px 8px; }
th[data-record] button { writing-mode: vertical-rl; padding: 8px 2px; font-variant-numeric: tabular-nums; }
section { margin: 12px 0; }
#tools { margin: 12px 0 0; }
`;
var SCRIPT = `
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
function historyHtml(records, skipped) {
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
  const cell = (c, id) => {
    const { text, size } = c.cells.get(id) ?? { text: "", size: null };
    return `<td${c.marks.includes("config") ? ' class="config"' : ""}${size === null ? "" : ` data-size="${size}"`}>${esc(text)}</td>`;
  };
  const row = (id) => `<tr data-part="${esc(id)}"><th>${esc(id)}</th>` + columns.map((c) => `${cell(c, id)}${c.same.length === 0 ? "" : "<td></td>"}`).join("") + `</tr>
`;
  const sized = columns.some((c) => [...c.cells.values()].some((v) => v.size !== null));
  const sizes = ["0\u20139", "10\u201399", "100 or more"].map((span, i) => `<span data-size="${i + 1}">${span}</span>`).join(", ");
  return `${HISTORY_MARK}
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>codeplan history</title>
<style>${STYLE2}</style>
<script>${EARLY}</script>
</head>
<body>
<main>
` + statusSentences(records, skipped).map((s) => `${p(s)}
`).join("") + `<div class="records">
<table data-role="records">
<tr><th>Part</th>${head.join("")}</tr>
` + inTable.map(row).join("") + `</table>
</div>
` + (sized ? `<p data-role="sizes">Fill by lines changed: ${sizes}.</p>
` : "") + (notInTable.length === 0 ? "" : `${p(`Parts not in the table: ${notInTable.join(", ")}.`)}
`) + columns.map((c) => `<section data-role="record" data-record="${esc(c.record.name)}" hidden>
${recordBlocks(c).join("\n")}
</section>
`).join("") + `<div id="tools"></div>
</main>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

// src/plan.ts
import { existsSync as existsSync3, readFileSync as readFileSync7 } from "node:fs";
import { join as join7 } from "node:path";
function planPath(home) {
  return `${home}/plan.json`;
}
function readPlanFile(repo, home) {
  const relative = planPath(home);
  const file = join7(repo, relative);
  if (!existsSync3(file)) return { kind: "missing" };
  try {
    return { kind: "json", value: JSON.parse(readFileSync7(file, "utf8")) };
  } catch (e) {
    return { kind: "not-json", message: `${relative} is not valid JSON: ${e.message}` };
  }
}

// src/layout.ts
var GAP = 8;
var LABEL_HEIGHT = 3 * 16 + 8;
var TITLE_HEIGHT = 20;
var LABEL_CAP = 240;
var RATIO = 3;
function textWidth(text) {
  let width = 0;
  for (const ch of text) width += ch.codePointAt(0) < 4352 ? 7 : 13;
  return width;
}
function labelLines(p2) {
  return [p2.name === "" ? p2.id : p2.name, `${p2.lines} lines`, p2.planned ? "planned" : `${p2.files} files`];
}
function labelWidth(p2) {
  return Math.min(LABEL_CAP, Math.max(...labelLines(p2).map(textWidth)) + 12);
}
function nameLines(name) {
  const fit = LABEL_CAP - 12;
  if (textWidth(name) <= fit) return [name];
  const chars = [...name];
  let n = 0;
  for (let w = textWidth(chars[0]); w <= fit; w += textWidth(chars[n])) n++;
  let cut = n;
  for (let i = n - 1; i >= 0; i--) {
    if (" -_/.".includes(chars[i]) && chars.slice(0, i + 1).join("").trimEnd() !== "") {
      cut = i + 1;
      break;
    }
  }
  return [chars.slice(0, cut).join("").replace(/ +$/, ""), chars.slice(cut).join("")];
}
function partLabel(p2) {
  const name = nameLines(labelLines(p2)[0]);
  return name.length === 2 ? { a: labelWidth(p2), b: LABEL_HEIGHT + 16, wrap: name } : { a: labelWidth(p2), b: LABEL_HEIGHT };
}
function titleWidth(zone) {
  return Math.min(LABEL_CAP, textWidth(zone) + 12);
}
function partSize(a, lines, b = LABEL_HEIGHT) {
  const t2 = 16e4 * lines;
  if ((a * b) ** 2 >= t2) return { w: a, h: b };
  const w = Math.max(a, Math.ceil(Math.sqrt(Math.sqrt(t2))));
  let h = Math.max(b, Math.floor(Math.sqrt(t2) / w));
  while ((w * h) ** 2 < t2) h++;
  if ((w * h) ** 2 > 25e4 * lines) throw new Error(`no part size for ${a} and ${lines} lines`);
  return { w, h };
}
function packRows(blocks, width, setLevel) {
  const rows = [];
  for (const block of blocks) {
    const row = rows.at(-1);
    if (row && row.w + GAP + block.w <= width) {
      row.blocks.push(block);
      row.w += GAP + block.w;
      row.h = Math.max(row.h, block.h);
      row.ends += block.ends.length;
    } else {
      rows.push({ blocks: [block], w: block.w, h: block.h, ends: block.ends.length });
    }
  }
  const w = Math.max(0, ...rows.map((r) => r.w));
  const h = rows.reduce((sum, r, i) => sum + r.h + GAP * r.ends + (i > 0 ? GAP : 0), 0);
  return {
    w,
    h,
    last: rows.at(-1) ?? null,
    place(x, y, above) {
      let top = y;
      for (const [i, row] of rows.entries()) {
        let left = x;
        const down = [];
        for (const block of row.blocks) {
          block.place(left, top, i === 0 ? above : rows[i - 1]);
          for (const end of block.ends) down.push({ end, x: block.downAt(end) });
          left += block.w + GAP;
        }
        down.sort((a, b) => b.x - a.x);
        down.forEach((d, k) => setLevel(d.end, top + row.h + GAP * (k + 1), row));
        top += row.h + GAP * (row.ends + 1);
      }
    }
  };
}
function rowWidth(blocks) {
  const area = blocks.reduce((sum, b) => sum + (b.w + GAP) * (b.h + GAP), 0);
  return Math.max(Math.ceil(Math.sqrt(area)), ...blocks.map((b) => b.w));
}
var EXTERNAL_HEIGHT = 2 * 16 + 8;
var MARGIN = 8;
function externalWidth(e) {
  return Math.min(LABEL_CAP, Math.max(textWidth(e.name === "" ? e.id : e.name), textWidth("external")) + 12);
}
function layOut(inputs, externalInputs = [], relations = { edges: [], connectors: [] }) {
  if (inputs.length === 0 && externalInputs.length === 0) {
    return { width: 1, height: 1, zones: [], parts: [], externals: [], edges: [], connectors: [] };
  }
  const lines = [
    ...relations.edges.map((e) => ({ from: e.from, to: e.to, kind: 0 })),
    ...relations.connectors.map((c) => ({ from: c.from, to: c.to, kind: 1 }))
  ];
  const ends = [];
  const endsOf = /* @__PURE__ */ new Map();
  const endOf = (id, kind, out) => {
    const order = 2 * kind + (out ? 0 : 1);
    const list2 = endsOf.get(id) ?? [];
    endsOf.set(id, list2);
    let end = list2.find((e) => e.order === order);
    if (!end) {
      end = {
        order,
        x: 0,
        bottom: 0,
        innerLevel: null,
        column: null,
        level: 0,
        zone: null,
        innerRow: null,
        row: null,
        marginColumn: null
      };
      list2.push(end);
      list2.sort((a, b) => a.order - b.order);
      ends.push(end);
    }
    return end;
  };
  const drawn = lines.map((l) => ({ out: endOf(l.from, l.kind, true), in: endOf(l.to, l.kind, false) }));
  const parts = inputs.map((p2) => {
    const { a, b, wrap } = partLabel(p2);
    const { w, h } = partSize(a, p2.lines, b);
    return { id: p2.id, x: 0, y: 0, w, h, label: { x: 0, y: 0, w: a, h: b, ...wrap ? { wrap } : {} } };
  });
  const gapAbove = /* @__PURE__ */ new Map();
  const rectBlock = (rect) => {
    const own = endsOf.get(rect.id) ?? [];
    return {
      w: rect.w,
      h: rect.h,
      ends: own,
      place(x, y, above) {
        gapAbove.set(rect.id, above);
        rect.x = x;
        rect.y = y;
        rect.label.x = x;
        rect.label.y = y;
        own.forEach((end, i) => {
          end.x = x + Math.floor((i + 1) * rect.w / (own.length + 1));
          end.bottom = y + rect.h;
        });
      },
      downAt: (end) => end.x
    };
  };
  const setLevel = (end, y, row) => {
    end.level = y;
    end.row = row;
  };
  const zoneNames = [...new Set(inputs.map((p2) => p2.zone ?? "").filter((z) => z !== ""))].sort(byCodeUnit2);
  const zones = [];
  const blocks = [];
  for (const name of zoneNames) {
    const members = parts.filter((_, i) => inputs[i].zone === name).map(rectBlock);
    const own = members.flatMap((m) => m.ends);
    const inner = packRows(members, rowWidth(members), (end, y, row) => {
      end.innerLevel = y;
      end.innerRow = row;
    });
    const tw = titleWidth(name);
    const zone = {
      name,
      x: 0,
      y: 0,
      // Side margins GAP, and on the right a column for each end; parts
      // start below the title box and a GAP.
      w: Math.max(inner.w + GAP * own.length, tw) + 2 * GAP,
      h: TITLE_HEIGHT + GAP + inner.h + GAP,
      title: { x: 0, y: 0, w: tw, h: TITLE_HEIGHT }
    };
    zones.push(zone);
    for (const end of own) end.zone = zone;
    blocks.push({
      w: zone.w,
      h: zone.h,
      ends: own,
      place(x, y, above) {
        zone.x = x;
        zone.y = y;
        zone.title.x = x + GAP;
        zone.title.y = y;
        inner.place(x + GAP, y + TITLE_HEIGHT + GAP, above);
        [...own].sort((a, b) => a.innerLevel - b.innerLevel).forEach((end, k) => {
          end.column = x + GAP + inner.w + GAP * (own.length - k);
        });
      },
      downAt: (end) => end.column
    });
  }
  parts.forEach((part, i) => {
    const zone = inputs[i].zone ?? "";
    if (zone === "") blocks.push(rectBlock(part));
  });
  const all = packRows(blocks, blocks.length > 0 ? rowWidth(blocks) : 0, setLevel);
  all.place(MARGIN, MARGIN, null);
  const externals = externalInputs.map((e) => {
    const w = externalWidth(e);
    return { id: e.id, x: 0, y: 0, w, h: EXTERNAL_HEIGHT, label: { x: 0, y: 0, w, h: EXTERNAL_HEIGHT } };
  });
  let contentW = all.w;
  let contentH = all.h;
  if (externals.length > 0) {
    const extBlocks = externals.map(rectBlock);
    const rows = packRows(extBlocks, Math.max(all.w, rowWidth(extBlocks)), setLevel);
    const top = blocks.length > 0 ? all.h + GAP : 0;
    rows.place(MARGIN, MARGIN + top, all.last);
    contentW = Math.max(all.w, rows.w);
    contentH = top + rows.h;
  }
  const downTo = (end) => end.column === null ? [[end.x, end.bottom]] : [[end.x, end.bottom], [end.x, end.innerLevel], [end.column, end.innerLevel]];
  const near = (a, b) => {
    if (a.zone !== null && a.zone === b.zone) {
      if (a.innerRow === b.innerRow) {
        const [left2, right2] = a.x < b.x ? [a, b] : [b, a];
        const way3 = [[left2.x, left2.bottom], [left2.x, left2.innerLevel], [right2.x, left2.innerLevel], [right2.x, right2.bottom]];
        return left2 === a ? way3 : way3.reverse();
      }
      const [upper, lower] = a.innerLevel < b.innerLevel ? [a, b] : [b, a];
      const way2 = [
        [lower.x, lower.bottom],
        [lower.x, lower.innerLevel],
        [upper.column, lower.innerLevel],
        [upper.column, upper.innerLevel],
        [upper.x, upper.innerLevel],
        [upper.x, upper.bottom]
      ];
      return lower === a ? way2 : way2.reverse();
    }
    if (a.row !== b.row) return null;
    const [left, right] = at(a) < at(b) ? [a, b] : [b, a];
    const way = [...downTo(left), [at(left), left.level], [at(right), left.level], ...downTo(right).reverse()];
    return left === a ? way : way.reverse();
  };
  const at = (end) => end.column ?? end.x;
  const placeOf = new Map([...parts, ...externals].map((r) => [r.id, r]));
  const topEnds = /* @__PURE__ */ new Map();
  const takenIn = /* @__PURE__ */ new Map();
  const topEnd = (upper, id, order) => {
    const gap = gapAbove.get(id) ?? null;
    if (gap === null || upper.row !== gap) return null;
    const key = JSON.stringify([id, order]);
    if (!topEnds.has(key)) {
      const rect = placeOf.get(id);
      const taken = takenIn.get(gap) ?? [...ends.filter((e) => e.row === gap).map(at)];
      takenIn.set(gap, taken);
      let found = null;
      for (let x = rect.x + 1; x < rect.x + rect.w; x++) {
        if (taken.some((t) => Math.abs(t - x) < GAP)) continue;
        if (found === null || Math.abs(x - at(upper)) < Math.abs(found - at(upper))) found = x;
      }
      if (found !== null) taken.push(found);
      topEnds.set(key, found);
    }
    return topEnds.get(key);
  };
  const below = (line, out, into) => {
    for (const [upper, id, order, forward] of [[out, line.to, into.order, true], [into, line.from, out.order, false]]) {
      const x = topEnd(upper, id, order);
      if (x === null) continue;
      const way = [...downTo(upper), [at(upper), upper.level], [x, upper.level], [x, placeOf.get(id).y]];
      return forward ? way : way.reverse();
    }
    return null;
  };
  const nearWay = new Map(drawn.map((line, i) => [line, near(line.out, line.in) ?? below(lines[i], line.out, line.in)]));
  const columnOf = /* @__PURE__ */ new Map();
  for (; ; ) {
    const count2 = /* @__PURE__ */ new Map();
    for (const line of drawn) {
      if (columnOf.has(line) || nearWay.get(line) !== null) continue;
      count2.set(line.out, (count2.get(line.out) ?? 0) + 1);
      count2.set(line.in, (count2.get(line.in) ?? 0) + 1);
    }
    let pick = null;
    for (const end of ends) {
      if ((count2.get(end) ?? 0) > (pick === null ? 0 : count2.get(pick))) pick = end;
    }
    if (pick === null) break;
    for (const line of drawn) {
      if (!columnOf.has(line) && nearWay.get(line) === null && (line.out === pick || line.in === pick)) columnOf.set(line, pick);
    }
  }
  const withColumn = ends.filter((end) => [...columnOf.values()].includes(end));
  withColumn.forEach((end, k) => {
    end.marginColumn = MARGIN + contentW + GAP * (k + 1);
  });
  let width = contentW + GAP * withColumn.length + 2 * MARGIN;
  let height = contentH + 2 * MARGIN;
  if (width > RATIO * height) height = Math.ceil(width / RATIO);
  if (height > RATIO * width) width = Math.ceil(height / RATIO);
  const wayOf = (end) => [...downTo(end), [end.column ?? end.x, end.level]];
  const points = drawn.map((line) => {
    const joined2 = nearWay.get(line);
    if (joined2) return straightened(joined2);
    const x = columnOf.get(line).marginColumn;
    return [...wayOf(line.out), [x, line.out.level], [x, line.in.level], ...wayOf(line.in).reverse()];
  });
  const edges = relations.edges.map((e, i) => ({ from: e.from, to: e.to, points: points[i] }));
  const connectors = relations.connectors.map((c, i) => ({
    scenario: c.scenario,
    step: c.step,
    points: points[relations.edges.length + i]
  }));
  return { width, height, zones, parts, externals, edges, connectors };
}
function straightened(points) {
  return points.filter((p2, i) => {
    const [before, after] = [points[i - 1], points[i + 1]];
    if (!before || !after) return true;
    return !(before[0] === p2[0] && p2[0] === after[0] || before[1] === p2[1] && p2[1] === after[1]);
  }).map((p2) => [p2[0], p2[1]]);
}

// src/raised.ts
var K = 1;
var H0 = 8;
var PROJECTION = { x: [1, 0, 1, 8], y: [0, 1, -1, 8] };
var MARGIN2 = 8;
var RATIO2 = 3;
function joined(list2) {
  if (list2.length === 1) return list2[0];
  const total = list2.reduce((sum, g) => sum + g.area, 0);
  let cut = 1;
  let before = 0;
  let nearest = Infinity;
  for (let i = 1; i < list2.length; i++) {
    before += list2[i - 1].area;
    const off = Math.abs(2 * before - total);
    if (off < nearest) {
      nearest = off;
      cut = i;
    }
  }
  const a = joined(list2.slice(0, cut));
  const b = joined(list2.slice(cut));
  const beside = { w: a.w + GAP + b.w, h: Math.max(a.h, b.h) };
  const below = { w: Math.max(a.w, b.w), h: a.h + GAP + b.h };
  const area = a.area + b.area;
  if (Math.max(beside.w, beside.h) <= Math.max(below.w, below.h)) {
    return { ...beside, area, place: (x, y) => (a.place(x, y), b.place(x + a.w + GAP, y)) };
  }
  return { ...below, area, place: (x, y) => (a.place(x, y), b.place(x, y + a.h + GAP)) };
}
function raisedPicture(inputs, externalInputs) {
  if (inputs.length === 0 && externalInputs.length === 0) {
    return { width: 1, height: 1, projection: PROJECTION, zones: [], parts: [], externals: [], order: [] };
  }
  const [ax, , az, ox] = PROJECTION.x;
  const [, by, bz, oy] = PROJECTION.y;
  const parts = inputs.map((p2) => {
    const { a, b, wrap } = partLabel(p2);
    const { w, h } = partSize(a, p2.lines, b);
    const z = p2.planned ? H0 : Math.max(H0, Math.round(K * Math.sqrt(p2.lines)));
    return { id: p2.id, x: 0, y: 0, w, h, z, label: { x: 0, y: 0, w: a, h: b, ...wrap ? { wrap } : {} } };
  });
  const partCell = (part) => ({
    w: part.w + part.z,
    h: part.h + part.z,
    area: (part.w + part.z) * (part.h + part.z),
    place(x, y) {
      part.x = x;
      part.y = y + part.z;
      part.label.x = ax * part.x + az * part.z + ox;
      part.label.y = by * part.y + bz * part.z + oy;
    }
  });
  const zones = [];
  const zoneBlocks = /* @__PURE__ */ new Map();
  const zoneNames = [...new Set(inputs.map((p2) => p2.zone ?? "").filter((name) => name !== ""))].sort(byCodeUnit2);
  for (const name of zoneNames) {
    const inner = joined(parts.filter((_, i) => inputs[i].zone === name).map(partCell));
    const tw = titleWidth(name);
    const zone = {
      name,
      x: 0,
      y: 0,
      w: Math.max(inner.w, tw) + 2 * GAP,
      h: TITLE_HEIGHT + GAP + inner.h + GAP,
      title: { x: 0, y: 0, w: tw, h: TITLE_HEIGHT }
    };
    zones.push(zone);
    zoneBlocks.set(name, {
      w: zone.w,
      h: zone.h,
      area: zone.w * zone.h,
      place(x, y) {
        zone.x = x;
        zone.y = y;
        zone.title.x = ax * (x + GAP) + ox;
        zone.title.y = by * y + oy;
        inner.place(x + GAP, y + TITLE_HEIGHT + GAP);
      }
    });
  }
  const externals = externalInputs.map((e) => {
    const w = externalWidth(e);
    return { id: e.id, x: 0, y: 0, w, h: EXTERNAL_HEIGHT, label: { x: 0, y: 0, w, h: EXTERNAL_HEIGHT } };
  });
  const top = [];
  inputs.forEach((p2, i) => {
    const zone = zoneBlocks.get(p2.zone ?? "");
    if (!zone) top.push(partCell(parts[i]));
    else if (!top.includes(zone)) top.push(zone);
  });
  for (const external of externals) {
    top.push({
      w: external.w,
      h: external.h,
      area: external.w * external.h,
      place(x, y) {
        external.x = x;
        external.y = y;
        external.label.x = ax * x + ox;
        external.label.y = by * y + oy;
      }
    });
  }
  const all = joined(top);
  all.place(0, 0);
  let width = all.w + 2 * MARGIN2;
  let height = all.h + 2 * MARGIN2;
  if (width > RATIO2 * height) height = Math.ceil(width / RATIO2);
  if (height > RATIO2 * width) width = Math.ceil(height / RATIO2);
  const order = [...parts.map((p2) => p2.id), ...externals.map((e) => e.id)];
  return { width, height, projection: PROJECTION, zones, parts, externals, order };
}

// src/cli.ts
var USAGE = `Usage: node codeplan.mjs <command> [--repo <dir>] [options]
       node codeplan.mjs history <records-dir>

Commands:
  check   Measure the repository against its plan and report files no part
          owns, files two parts own equally, code outside the watch set,
          problems in the plan, and a viewer page that update would change.
          Writes nothing.
  update  Write the viewer page (codeplan.html under home by default) from
          the plan and the code.
  draft   Read the repository and print a first plan.json and codeplan.json
          as one JSON document on standard output. Writes nothing.
  summary Print the plan as Markdown on standard output: the parts with
          their counts, uses, externals, scenarios, tasks and a mermaid
          diagram.
          Writes nothing and does not read the viewer page.
  snapshot Print what check finds as JSON on standard output: the config
          used, each part's counts, which pattern owns each file, the
          problem lists and the findings. Writes nothing.
  report  Print the state of the plan as Markdown for a pull request. With
          --base, also what changed since that snapshot. Writes nothing and
          always exits with 0 when it printed; check is what fails CI.
  history Print the records in a directory as one HTML file on standard
          output: a table of the parts that changed from each record to
          the next. A record is a file that holds what snapshot printed.
          Takes the directory and no option, and reads no repository.
          Writes nothing.
  stamps  Print each evidence entry as one JSON line with its state, a
          line and that line's stamp. Writes nothing.
  help    Show this text.

Options:
  --repo <dir>        Repository to read (default: the current directory).

Check options:
  --no-page           Do not compare the page. The page place is not read.

Summary options:
  --mermaid           Print only the mermaid diagram.

Report options:
  --base <file>       A snapshot of the tree to compare with, made by the
                      snapshot command.

Draft options:
  --max-parts <n>     Most parts to propose (default 16).
  --parts-by-name <n> Also make a part from the first word of file names
                      in layer directories, when n or more files start
                      with that word.
  --language <name>   Language rules to use: js or java. Repeat for both.
  --root <dir>        Source root to use instead of the language rules.
                      Repeat for more than one.

Exit codes for check: 0 no problems, 1 problems or warnings,
2 an error in the plan, the config or plan file cannot be read, or the page
place holds something that is not a codeplan page.
Exit codes for update: 0 written, already current, or no plan file;
1 contested files (nothing written); 2 as for check.
Exit codes for draft: 0 printed, 2 an option, the config or the repository
cannot be used.
Exit codes for summary: 0 printed (warnings, orphans, contested and
unwatched files do not change it); 2 an error in the plan, no plan file, or
the config or plan file cannot be read.
Exit codes for snapshot and report: 0 printed; 2 the config cannot be used,
the plan file is not JSON, or the --base file cannot be used.
Exit codes for history: 0 printed (skipped files do not change it); 2 not
one directory given, an option given, the directory cannot be read, or no
file in it is a snapshot.
Exit codes for stamps: 0 printed; 2 as for snapshot, or no plan file.
Exit code 3 for any command: an unexpected error, in one line. Set
CODEPLAN_STACK to print its stack too.
`;
var LIST_LIMIT2 = 30;
var COMMANDS = ["check", "update", "draft", "summary", "snapshot", "report", "history", "stamps", "help"];
var OPTIONS = ["--repo", "--no-page", "--max-parts", "--parts-by-name", "--language", "--root", "--mermaid", "--base"];
function pagePlace(repo, page) {
  const segments = page.split("/");
  for (let i = 1; i < segments.length; i++) {
    const dir = lstatSync5(join8(repo, ...segments.slice(0, i)), { throwIfNoEntry: false });
    if (dir === void 0) break;
    if (dir.isSymbolicLink()) return { kind: "other", what: "a path through a symbolic link" };
    if (!dir.isDirectory()) return { kind: "other", what: "a path that passes through a file" };
  }
  const stat = lstatSync5(join8(repo, page), { throwIfNoEntry: false });
  if (stat === void 0) return { kind: "absent" };
  if (stat.isSymbolicLink()) return { kind: "other", what: "a symbolic link" };
  if (!stat.isFile()) return { kind: "other", what: stat.isDirectory() ? "a directory" : "not a regular file" };
  const bytes = readFileSync8(join8(repo, page));
  if (!bytes.subarray(0, PAGE_MARK.length).equals(Buffer.from(PAGE_MARK))) {
    return { kind: "other", what: "a file that does not start with the codeplan page mark" };
  }
  return { kind: "page", bytes };
}
function check(repo, page = "compare") {
  const read = readInputs(repo);
  if (typeof read === "string") return { kind: "error", message: read };
  const { config, file } = read;
  const place = page === "skip" ? { kind: "absent" } : pagePlace(repo, config.page);
  if (place.kind === "other" && page === "compare") {
    return {
      kind: "error",
      message: `${config.page} is ${place.what}, not a codeplan page; it was left as it is. Move it away, or set page in codeplan.json to another file under home`
    };
  }
  const notCompared = {
    path: config.page,
    bytes: null,
    current: false,
    state: place.kind === "other" ? "foreign" : "not-checked"
  };
  if (file.kind === "missing") {
    const plan = planPath(config.home);
    const measurement2 = measure(repo, config, []);
    const diagnostics2 = [diagnostic("no-plan", "plan", `${plan} not found, so every watched file is an orphan`)];
    const jsImports = config.languages.includes("js") ? { files: 0, notResolved: 0 } : null;
    return { kind: "measured", config, plan: null, measured: [], measurement: measurement2, diagnostics: diagnostics2, tasks: [], excluded: 0, jsImports, stamped: [], page: notCompared };
  }
  const prepared = preparePlan(file.value);
  const measurement = measure(repo, config, prepared.parts);
  const isFile = (path) => isPlainFile(repo, path);
  const tasks = planTasks(prepared, isFile);
  const otherLines = /* @__PURE__ */ new Map();
  const stampedItems = evidenceItems(prepared).filter((item) => item.form?.stamp);
  const stamped = new Set(stampedItems.map((item) => item.form.path));
  const stampLines = cachedLines(repo);
  const judged = prepared.excluded === 0 && measurement.contested.length === 0;
  const js = judged && config.languages.includes("js") ? jsFacts(repo, measurement.owners, measurement.js, isFile) : null;
  const diagnostics = diagnosePlan(prepared, {
    repo,
    isFile,
    unowned: unownedTest(config, prepared.parts),
    files: new Map(measurement.parts.map((p2) => [p2.id, p2.files])),
    owners: measurement.owners,
    stampLines,
    lineCount: (path) => {
      if (stamped.has(path)) return stampLines(path)?.stamps.length ?? null;
      const measuredLines = measurement.lines.get(path);
      if (measuredLines !== void 0) return measuredLines;
      if (!otherLines.has(path)) {
        let count2 = null;
        try {
          if (isPlainFile(repo, path)) count2 = lineTotal(readFileSync8(join8(repo, path)));
        } catch {
          count2 = null;
        }
        otherLines.set(path, count2);
      }
      return otherLines.get(path);
    },
    imports: judged && config.languages.includes("java") ? importFacts(measurement.owners, measurement.java) : null,
    js
  });
  const result2 = {
    kind: "measured",
    config,
    plan: file.value,
    measured: prepared.parts,
    measurement,
    diagnostics,
    tasks,
    excluded: prepared.excluded,
    jsImports: js === null ? null : { files: js.files, notResolved: js.notResolved },
    stamped: stampedItems
  };
  if (page === "skip" || place.kind === "other" || diagnostics.some((d) => d.severity === "error") || measurement.contested.length > 0) {
    return { ...result2, page: notCompared };
  }
  const bytes = Buffer.from(pageFor(file.value, measurement, tasks), "utf8");
  const current = place.kind === "page" && place.bytes.equals(bytes);
  const state = place.kind === "absent" ? "missing" : current ? "ok" : "outdated";
  return { ...result2, page: { path: config.page, bytes, current, state } };
}
function stamps(repo) {
  const read = readInputs(repo);
  const message = typeof read === "string" ? read : read.file.kind === "json" ? null : `${planPath(read.config.home)} not found`;
  if (message !== null) return { code: 2, stdout: "", stderr: `codeplan: ${message}
` };
  const file = read.file;
  const lines = cachedLines(repo);
  let stdout = "";
  for (const item of evidenceItems(preparePlan(file.value))) {
    const e = item.form;
    if (e === null) continue;
    const found = judge(e, { count: (path) => lines(path)?.stamps.length ?? null, lines });
    const stamp = found.state === "no-stamp" ? lines(e.path).stamps[e.line - 1] : found.stamp;
    stdout += `${JSON.stringify({ ...item, form: void 0, ...found, stamp })}
`;
  }
  return { code: 0, stdout, stderr: "" };
}
function readInputs(repo) {
  let config;
  try {
    config = readConfig(repo);
  } catch (e) {
    if (e instanceof SettingsError) return e.message;
    throw e;
  }
  const file = readPlanFile(repo, config.home);
  return file.kind === "not-json" ? file.message : { config, file };
}
function pageFor(plan, m, tasks) {
  const raw = plan;
  const parts = m.parts.map((p2) => ({ id: p2.id, files: p2.files, lines: p2.lines }));
  const externals = raw.externals ?? [];
  const edges = [];
  const seen = /* @__PURE__ */ new Set();
  for (const part of raw.parts) {
    for (const use of part.uses ?? []) {
      const key = JSON.stringify([part.id, use.to]);
      if (use.to === part.id || seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: part.id, to: use.to });
    }
  }
  const connectors = [];
  for (const scenario of raw.scenarios ?? []) {
    scenario.steps.forEach((step, k) => {
      if (k === 0) return;
      const a = scenario.steps[k - 1].at;
      const b = step.at;
      if (a === b || seen.has(JSON.stringify([a, b])) || seen.has(JSON.stringify([b, a]))) return;
      connectors.push({ scenario: scenario.id, step: k, from: a, to: b });
    });
  }
  const partInputs = raw.parts.map((part, i) => ({
    id: part.id,
    name: part.name,
    zone: part.zone,
    lines: parts[i].lines,
    files: parts[i].files,
    planned: part.planned === true
  }));
  const externalInputs = externals.map((e) => ({ id: e.id, name: e.name }));
  const layout = layOut(partInputs, externalInputs, { edges, connectors });
  return pageHtml({
    format: 2,
    plan,
    measure: {
      parts,
      files: parts.reduce((s, p2) => s + p2.files, 0),
      lines: parts.reduce((s, p2) => s + p2.lines, 0)
    },
    orphans: m.orphans,
    unwatched: m.unwatched.length,
    // marks: the parts the task names and the parts that hold its files, in
    // plan order.
    tasks: tasks.map((task) => {
      const marked = /* @__PURE__ */ new Set([...task.parts, ...task.makes.map((path) => m.owners.get(path))]);
      return { id: task.id, marks: parts.map((p2) => p2.id).filter((id) => marked.has(id)), missing: task.missing };
    }),
    layout,
    raised: raisedPicture(partInputs, externalInputs)
  });
}
function update(repo) {
  const result2 = check(repo);
  if (result2.kind === "error") return { code: 2, stdout: "", stderr: `codeplan: ${result2.message}
` };
  const { config, diagnostics, measurement: m, page } = result2;
  const plan = planPath(config.home);
  if (diagnostics.some((d) => d.code === "no-plan")) {
    return { code: 0, stdout: `update: ${plan} not found, so no page was written
`, stderr: "" };
  }
  const errors = diagnostics.filter((d) => d.severity === "error");
  if (errors.length > 0) {
    let stderr = "";
    for (const d of errors) stderr += `${d.at}: ${d.code} [${d.severity}] ${d.message}
`;
    stderr += `update: the plan has errors, so ${page.path} was not written
  fix: correct ${plan}, then run update again
`;
    return { code: 2, stdout: "", stderr };
  }
  if (m.contested.length > 0) {
    const stderr = listSection(
      "contested files: two or more parts own them with equally strong patterns",
      "give one part a pattern with a longer fixed prefix, or remove the overlap",
      m.contested.map((c) => `${c.path} (${c.parts.join(", ")})`)
    ) + `update: contested files, so ${page.path} was not written
`;
    return { code: 1, stdout: "", stderr };
  }
  if (page.current) return { code: 0, stdout: `update: ${page.path} is up to date
`, stderr: "" };
  const target = join8(repo, page.path);
  let temp = null;
  try {
    mkdirSync(dirname(target), { recursive: true });
    for (let n = 0; temp === null; n++) {
      const name = join8(dirname(target), `.${basename(target)}.${process.pid}.${n}.tmp`);
      try {
        const fd = openSync(name, "wx");
        temp = name;
        try {
          writeSync(fd, page.bytes);
        } finally {
          closeSync(fd);
        }
      } catch (e) {
        if (e.code !== "EEXIST" || temp !== null) throw e;
      }
    }
    renameSync(temp, target);
  } catch (e) {
    if (temp !== null) rmSync(temp, { force: true });
    return { code: 2, stdout: "", stderr: `codeplan: cannot write ${page.path}: ${e.message}
` };
  }
  return { code: 0, stdout: `update: wrote ${page.path}
`, stderr: "" };
}
var FIXES = {
  "bad-shape": "give the field at that place the type and form of the plan format, or remove an unknown key",
  "repeated-id": "give each part, external, scenario and task an id of its own",
  "no-paths": "give the part at least one pattern in paths",
  "unknown-target": "name an existing part or external, or add it; the parts of a task name parts only",
  "empty-part": "correct the part's paths so they match files, or remove the part",
  "planned-has-files": "remove planned from the part now that it has code; if the files are not its code, correct the part's paths",
  "start-missing": "point start at a file in the repository",
  "start-elsewhere": "point start at a file this part measures",
  "self-use": "remove the use of the part itself",
  "repeated-use": "keep one use for each target",
  "unused-external": "name the external in a use or a step, or remove it",
  "short-scenario": "give the scenario two steps or more",
  "gap-in-scenario": "add a use between the two steps' parts, or a step between them",
  "unknown-reference": "write the id of an existing part or external in the braces",
  "task-done-missing": "make the files that are not there, take them out of makes, or set the status the task has now",
  "task-todo-has-files": "nothing has to change; if the files are not what this task makes, correct makes",
  "task-path-unowned": "add a pattern for the path to a part's paths, or correct the path in makes",
  "evidence-not-read": "write the evidence as a path from the repository root, a colon and a line number of 1 or more",
  "evidence-no-file": "write the path of a file that is in the repository, or remove the evidence",
  "evidence-no-line": "write the line that shows the use as the file is now, or remove the evidence",
  "evidence-stamp-elsewhere": "read the line the stamps command gives and write its number only if it still shows the use; the same stamp only means the same text",
  "evidence-stamp-differs": "read the line: if it still shows the use, write the stamp the stamps command gives; if not, write another line, remove the evidence or correct the use",
  "import-without-use": "add a use of that part to this part's uses; nothing has to change if the plan is not to show that use",
  "use-without-import": "nothing has to change if the part uses the other without an import line; remove the use if it is no longer there",
  "import-needs-check": "look at the import path in the file: add a use of that part if the code uses it; nothing has to change if the import is commented out or is only text",
  "tsconfig-not-read": "make the config valid JSON (comments and trailing commas are allowed), or correct the path in extends",
  "tsconfig-references-not-followed": "nothing has to change if no import path uses an alias of the referenced configs; otherwise write those paths or baseUrl in this config too"
};
var fixFor = (code, plan) => code === "no-plan" ? `create ${plan} and give each part the paths it owns` : FIXES[code];
function findingLines(diagnostics, plan) {
  let text = "";
  for (const d of diagnostics) text += `${d.at}: ${d.code} [${d.severity}] ${d.message}
`;
  for (const code of new Set(diagnostics.map((d) => d.code))) text += `  fix: ${code}: ${fixFor(code, plan)}
`;
  return text;
}
function snapshotOf(repo) {
  const result2 = check(repo, "note");
  if (result2.kind === "error") return { code: 2, stdout: "", stderr: `codeplan: ${result2.message}
` };
  const plan = planPath(result2.config.home);
  return takeSnapshot({
    config: result2.config,
    hasPlan: result2.plan !== null,
    measured: result2.measured,
    measurement: result2.measurement,
    diagnostics: result2.diagnostics,
    tasks: result2.tasks,
    excluded: result2.excluded,
    jsImports: result2.jsImports,
    stamped: result2.stamped,
    pageState: result2.page.state,
    fix: (code) => fixFor(code, plan)
  });
}
function snapshot(repo) {
  const taken = snapshotOf(repo);
  return "snapshot" in taken ? { code: 0, stdout: snapshotText(taken), stderr: "" } : taken;
}
function report(repo, baseFile) {
  let base = null;
  if (baseFile !== void 0) {
    try {
      let text;
      try {
        text = readFileSync8(baseFile, "utf8");
      } catch {
        throw new Error("it cannot be read");
      }
      base = readSnapshot(text);
    } catch (e) {
      return { code: 2, stdout: "", stderr: `codeplan: the --base file ${baseFile} cannot be used: ${e.message}
` };
    }
  }
  const head = snapshotOf(repo);
  return "snapshot" in head ? { code: 0, stdout: reportText(head, base), stderr: "" } : head;
}
function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
function history(args, cwd) {
  const fail = (message, stderr2 = "") => ({ code: 2, stdout: "", stderr: `${stderr2}codeplan: ${message}
` });
  const option = args.find((arg) => arg.startsWith("-"));
  if (option !== void 0) return fail(`history takes no options, and ${option} was given`);
  if (args.length !== 1) return fail("history takes one records directory");
  const dir = resolve(cwd, args[0]);
  if (!isDirectory(dir)) return fail(`records directory not found: ${dir}`);
  let read;
  try {
    read = readRecords(dir);
  } catch (e) {
    return fail(`the records directory ${dir} cannot be read: ${e.message}`);
  }
  const stderr = read.skipped.map((s) => `history: skipped ${s.file}: ${s.reason}
`).join("");
  if (!read.records.some((r) => r.snapshot !== null)) return fail(`no file in ${dir} is a snapshot`, stderr);
  return { code: 0, stdout: historyHtml(read.records, read.skipped), stderr };
}
function summary(repo, mermaid) {
  const result2 = check(repo, "skip");
  if (result2.kind === "error") return { code: 2, stdout: "", stderr: `codeplan: ${result2.message}
` };
  const stderr = findingLines(result2.diagnostics, planPath(result2.config.home));
  if (result2.plan === null || result2.diagnostics.some((d) => d.severity === "error")) {
    return { code: 2, stdout: "", stderr };
  }
  const stdout = mermaid ? mermaidText(result2.plan) : summaryText(result2.plan, result2.measurement, result2.tasks);
  return { code: 0, stdout, stderr };
}
function listSection(title, fix, items) {
  if (items.length === 0) return "";
  const shown3 = items.slice(0, LIST_LIMIT2).map((i) => `  ${i}
`);
  const rest = items.length - LIST_LIMIT2;
  const more = rest > 0 ? `  ... and ${rest} more
` : "";
  return `${title} (${items.length})
  fix: ${fix}
${shown3.join("")}${more}`;
}
function checkReport(result2, noPage) {
  const { config, measurement: m, diagnostics, excluded } = result2;
  const plan = planPath(config.home);
  let stdout = `languages: ${config.languages.join(", ")}
`;
  stdout += `watched files: ${m.watchedFiles}
`;
  for (const p2 of m.parts) stdout += `part ${p2.id}: ${p2.files} files, ${p2.lines} lines
`;
  let stderr = "";
  const orphans = excluded > 0 ? [] : m.orphans;
  if (excluded > 0) {
    stderr += `measurement incomplete: ${excluded} parts are not measured, so orphan files are not listed
  fix: correct the errors in ${plan} below
`;
  }
  stderr += listSection(
    "orphan files: no part owns them",
    `add a pattern to a part's paths in ${plan}, or list them under skip in codeplan.json`,
    orphans
  );
  stderr += listSection(
    "contested files: two or more parts own them with equally strong patterns",
    "give one part a pattern with a longer fixed prefix, or remove the overlap",
    m.contested.map((c) => `${c.path} (${c.parts.join(", ")})`)
  );
  stderr += listSection(
    "unwatched files: code outside the watch set",
    "add a pattern for them under watch, or under skip, in codeplan.json",
    m.unwatched
  );
  const outdated = result2.page.bytes !== null && !result2.page.current;
  if (outdated) {
    stderr += `page outdated: ${result2.page.path} differs from the page update would write now
  fix: run update
`;
  }
  stderr += findingLines(diagnostics, plan);
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.filter((d) => d.severity === "warning").length;
  const problems = orphans.length + m.contested.length + m.unwatched.length;
  if (noPage) stdout += "page: not compared\n";
  if (problems === 0 && errors === 0 && warnings === 0 && excluded === 0 && !outdated) {
    stdout += "check: ok\n";
    return { code: 0, stdout, stderr };
  }
  stdout += `check: ${excluded > 0 ? "measurement incomplete" : `${orphans.length} orphan`}, ${m.contested.length} contested, ${m.unwatched.length} unwatched, ${errors} errors, ${warnings} warnings${outdated ? ", page outdated" : ""}
`;
  return { code: errors > 0 ? 2 : 1, stdout, stderr };
}
function run(argv, cwd) {
  const usageError = (message) => ({
    code: 2,
    stdout: "",
    stderr: `codeplan: ${message}

${USAGE}`
  });
  if (argv[0] === "history") return history(argv.slice(1), cwd);
  let command;
  let repo = cwd;
  let maxParts;
  let partsByName;
  const languages = [];
  const roots = [];
  const draftFlags = [];
  let mermaid = false;
  let noPage = false;
  let base;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--repo") {
      const value = argv[++i];
      if (value === void 0) return usageError("--repo needs a directory");
      repo = resolve(cwd, value);
    } else if (arg === "--mermaid") {
      mermaid = true;
    } else if (arg === "--no-page") {
      noPage = true;
    } else if (arg === "--base") {
      const value = argv[++i];
      if (value === void 0) return usageError("--base needs a file");
      base = resolve(cwd, value);
    } else if (OPTIONS.includes(arg)) {
      const value = argv[++i];
      if (value === void 0) return usageError(`${arg} needs a value`);
      draftFlags.push(arg);
      if (arg === "--max-parts") maxParts = value;
      else if (arg === "--parts-by-name") {
        if (partsByName !== void 0) return usageError("--parts-by-name is given more than once");
        partsByName = value;
      } else if (arg === "--language") languages.push(value);
      else roots.push(value);
    } else if (arg.startsWith("-")) {
      return usageError(`unknown option ${arg}`);
    } else if (command === void 0) {
      command = arg;
    } else if (command !== "history") {
      return usageError(`unexpected argument ${arg}`);
    }
  }
  if (command === "history") return history(argv, cwd);
  if (command === "help") return { code: 0, stdout: USAGE, stderr: "" };
  if (command === void 0 || !COMMANDS.includes(command)) {
    return usageError(command === void 0 ? "no command given" : `unknown command ${command}`);
  }
  if (command !== "draft" && draftFlags.length > 0) {
    return usageError(`${draftFlags[0]} is an option of draft only`);
  }
  if (command !== "summary" && mermaid) return usageError("--mermaid is an option of summary only");
  if (command !== "report" && base !== void 0) return usageError("--base is an option of report only");
  if (command !== "check" && noPage) return usageError("--no-page is an option of check only");
  if (maxParts !== void 0 && !/^[0-9]+$/.test(maxParts)) {
    return usageError(`--max-parts needs a whole number of 1 or more, not "${maxParts}"`);
  }
  const parts = maxParts === void 0 ? 16 : Number(maxParts);
  if (parts < 1) return usageError(`--max-parts needs a whole number of 1 or more, not "${maxParts}"`);
  if (partsByName !== void 0 && !/^[0-9]*[1-9][0-9]*$/.test(partsByName)) {
    return usageError(`--parts-by-name needs a whole number of 1 or more, not "${partsByName}"`);
  }
  if (!isDirectory(repo)) {
    return { code: 2, stdout: "", stderr: `codeplan: repository not found: ${repo}
` };
  }
  if (command === "draft") {
    try {
      const out = draft(repo, {
        maxParts: parts,
        partsByName: partsByName === void 0 ? null : Number(partsByName),
        languages: languages.length > 0 ? languages : null,
        roots: roots.length > 0 ? roots : null
      });
      return { code: 0, stdout: `${JSON.stringify(out, null, 2)}
`, stderr: "" };
    } catch (e) {
      if (e instanceof SettingsError || e instanceof DraftError) {
        return { code: 2, stdout: "", stderr: `codeplan: ${e.message}
` };
      }
      throw e;
    }
  }
  if (command === "update") return update(repo);
  if (command === "summary") return summary(repo, mermaid);
  if (command === "snapshot") return snapshot(repo);
  if (command === "report") return report(repo, base);
  if (command === "stamps") return stamps(repo);
  const result2 = check(repo, noPage ? "skip" : "compare");
  if (result2.kind === "error") {
    return { code: 2, stdout: "", stderr: `codeplan: ${result2.message}
` };
  }
  return checkReport(result2, noPage);
}
function main(argv, cwd, env, command = run) {
  try {
    return command(argv, cwd());
  } catch (e) {
    let text = "";
    try {
      text = e instanceof Error && typeof e.message === "string" ? e.message : String(e);
    } catch {
    }
    const stack = env.CODEPLAN_STACK && typeof e?.stack === "string" ? `${e.stack}
` : "";
    return { code: 3, stdout: "", stderr: `codeplan: unexpected error: ${text.replace(/[\0-\x1f\x7f\x85\u2028\u2029]/g, " ")}
${stack}` };
  }
}

// src/bin.ts
var result = main(process.argv.slice(2), () => process.cwd(), process.env);
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.code;
