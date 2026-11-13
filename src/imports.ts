// What the .java files of the parts import. Only lines are read: the first
// package line of a file and its import lines, one import to a line.
const PIECE = String.raw`[\p{L}_$][\p{L}\p{N}_$]*`;
const NAME = String.raw`${PIECE}(?:\.${PIECE})*`;
const PACKAGE_LINE = new RegExp(String.raw`^[ \t]*package[ \t]+(${NAME})[ \t]*;`, "u");
const IMPORT_LINE = new RegExp(String.raw`^[ \t]*import[ \t]+(static[ \t]+)?(${NAME})(\.\*)?[ \t]*;`, "u");

export interface JavaImport {
  name: string;
  isStatic: boolean;
  // The line ends with ".*".
  all: boolean;
}

export interface JavaFile {
  // null: the file has no package line.
  package: string | null;
  imports: JavaImport[];
}

export function javaFile(text: string): JavaFile {
  let pack: string | null = null;
  const imports: JavaImport[] = [];
  for (const line of text.split("\n")) {
    if (pack === null) pack = PACKAGE_LINE.exec(line)?.[1] ?? null;
    const found = IMPORT_LINE.exec(line);
    if (found !== null) imports.push({ name: found[2]!, isStatic: found[1] !== undefined, all: found[3] !== undefined });
  }
  return { package: pack, imports };
}

export interface ImportFacts {
  // Import pairs: part A, then part B, then the first file of A (by code
  // unit) with an import that is a file of B.
  pairs: Map<string, Map<string, string>>;
  // Part A, then the parts with a file in a package that a file of A
  // imports with ".*": an import of them is possible and cannot be known.
  possible: Map<string, Set<string>>;
  // The packages of the .java files of each part that has such a file.
  packages: Map<string, Set<string>>;
}

// `owners` has every watched file in code unit order with the one part that
// owns it; `java` has the .java files among them.
export function importFacts(owners: Map<string, string | null>, java: Map<string, JavaFile>): ImportFacts {
  // A full name that two files have is the name of neither.
  const byName = new Map<string, string | null>();
  const byPackage = new Map<string, string[]>();
  const packages = new Map<string, Set<string>>();
  for (const [path, file] of java) {
    const base = path.slice(path.lastIndexOf("/") + 1, -".java".length);
    const name = file.package === null ? base : `${file.package}.${base}`;
    byName.set(name, byName.has(name) ? null : path);
    const owner = owners.get(path)!;
    const set = packages.get(owner) ?? new Set<string>();
    packages.set(owner, set);
    if (file.package !== null) {
      set.add(file.package);
      byPackage.set(file.package, [...(byPackage.get(file.package) ?? []), path]);
    }
  }
  // The file of a type: the file with that full name, or with the name
  // without its last pieces (a nested type, a static member). A name that
  // two files have ends the search.
  const typeFile = (name: string): string | null => {
    for (let n = name; ; n = n.slice(0, n.lastIndexOf("."))) {
      if (byName.has(n)) return byName.get(n)!;
      if (!n.includes(".")) return null;
    }
  };

  const pairs = new Map<string, Map<string, string>>();
  const possible = new Map<string, Set<string>>();
  for (const [path, file] of java) {
    const from = owners.get(path)!;
    for (const found of file.imports) {
      const inPackage = !found.isStatic && found.all ? byPackage.get(found.name) : undefined;
      if (inPackage !== undefined) {
        const set = possible.get(from) ?? new Set<string>();
        possible.set(from, set);
        for (const other of inPackage) set.add(owners.get(other)!);
        continue;
      }
      const target = typeFile(found.name);
      if (target === null) continue;
      const to = owners.get(target)!;
      if (to === from) continue;
      const row = pairs.get(from) ?? new Map<string, string>();
      pairs.set(from, row);
      if (!row.has(to)) row.set(to, path);
    }
  }
  return { pairs, possible, packages };
}
