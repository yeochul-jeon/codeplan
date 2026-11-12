// Reading and checking codeplan.json, and the language rules.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fixedHead } from "./glob.js";

export type Language = "js" | "java";

interface LanguageRules {
  detect: string[];
  codeExts: string[];
  dependencyDirs: string[];
  buildOutputDirs: string[];
  mainRootGlobs: string[];
  testRootGlobs: string[];
  testPatterns: string[];
  mapperPatterns: string[];
}

export const LANGUAGES: Record<Language, LanguageRules> = {
  js: {
    detect: ["package.json"],
    codeExts: ["astro", "cjs", "js", "jsx", "mjs", "svelte", "ts", "tsx", "vue"],
    dependencyDirs: ["node_modules"],
    buildOutputDirs: ["dist", "build", ".next", ".nuxt", ".svelte-kit", "out", "coverage"],
    mainRootGlobs: [],
    testRootGlobs: [],
    testPatterns: ["**/test/**", "**/tests/**", "**/__tests__/**", "**/*.test.*", "**/*.spec.*"],
    mapperPatterns: [],
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
      "**/src/main/resources/**/*Mapper.xml",
    ],
  },
};

const LANGUAGE_NAMES = Object.keys(LANGUAGES).sort() as Language[];

export interface Config {
  languages: Language[];
  // null: use the watch built from the language rules.
  watch: string[] | null;
  skip: string[];
  roots: string[];
  tests: boolean;
  home: string;
  page: string;
}

export class SettingsError extends Error {}

export const KEYS = ["languages", "watch", "skip", "roots", "tests", "home", "page"];

export const CONFIG_FILE = "codeplan.json";

export function detectLanguages(repo: string): Language[] {
  const found = LANGUAGE_NAMES.filter((name) =>
    LANGUAGES[name].detect.some((file) => existsSync(join(repo, file))),
  );
  return found.length > 0 ? found : ["js"];
}

function stringArray(raw: Record<string, unknown>, key: string): string[] | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new SettingsError(`\`${key}\` must be an array of strings`);
  }
  return value;
}

// The one way to write a repository-relative path: "/" between non-empty
// parts, none of them "." or "..", and no backslash, on every system.
export function isPathForm(path: string): boolean {
  return !path.includes("\\") && path.split("/").every((s) => s !== "" && s !== "." && s !== "..");
}

export function isUnder(path: string, dir: string): boolean {
  return path.startsWith(dir + "/");
}

export function readConfig(repo: string): Config {
  const file = join(repo, CONFIG_FILE);
  let raw: unknown = {};
  if (existsSync(file)) {
    try {
      raw = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      throw new SettingsError(`${CONFIG_FILE} is not valid JSON: ${(e as Error).message}`);
    }
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new SettingsError(`${CONFIG_FILE} must hold a JSON object`);
  }
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!KEYS.includes(key)) {
      throw new SettingsError(`unknown key \`${key}\`; known keys: ${KEYS.join(", ")}`);
    }
  }

  let languages: Language[];
  const languageList = stringArray(obj, "languages");
  if (languageList === undefined) {
    languages = detectLanguages(repo);
  } else {
    if (languageList.length === 0) throw new SettingsError("`languages` must not be empty");
    for (const name of languageList) {
      if (!(LANGUAGE_NAMES as string[]).includes(name)) {
        throw new SettingsError(
          `\`languages\` has unknown language "${name}"; known: ${LANGUAGE_NAMES.join(", ")}`,
        );
      }
    }
    if (new Set(languageList).size !== languageList.length) {
      throw new SettingsError("`languages` lists a language more than once");
    }
    languages = [...(languageList as Language[])].sort();
  }

  if (obj.tests !== undefined && typeof obj.tests !== "boolean") {
    throw new SettingsError("`tests` must be true or false");
  }
  const tests = obj.tests === true;

  for (const key of ["home", "page"]) {
    if (obj[key] !== undefined && typeof obj[key] !== "string") {
      throw new SettingsError(`\`${key}\` must be a string`);
    }
  }
  const home = (obj.home as string | undefined) ?? "docs/codeplan";
  if (!isPathForm(home)) {
    throw new SettingsError(
      `\`home\` "${home}" must be a directory inside the repository, written as parts joined by "/" ` +
        'with no empty, "." or ".." part and no backslash',
    );
  }
  const page = (obj.page as string | undefined) ?? `${home}/codeplan.html`;
  if (!isPathForm(page)) {
    throw new SettingsError(
      `\`page\` "${page}" must be a path inside the repository, written as parts joined by "/" ` +
        'with no empty, "." or ".." part and no backslash',
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

  // Roots written in the config replace the language source roots entirely.
  const roots =
    stringArray(obj, "roots") ??
    languages.flatMap((l) => [
      ...LANGUAGES[l].mainRootGlobs,
      ...(tests ? LANGUAGES[l].testRootGlobs : []),
    ]);

  return {
    languages,
    watch,
    skip: stringArray(obj, "skip") ?? [],
    roots,
    tests,
    home,
    page,
  };
}
