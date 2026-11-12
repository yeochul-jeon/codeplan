# draft

`draft` reads the repository and prints a first plan file and config file
as one JSON document. It writes nothing. The result is a first version for
a person to edit.

```sh
node docs/codeplan/codeplan.mjs draft [--max-parts <n>] [--language <name>]... [--root <dir>]...
```

## Output

```json
{
  "plan": { "format": 1, "name": "", "about": "", "parts": [], "externals": [], "scenarios": [] },
  "config": { "languages": ["js"] },
  "measure": { "parts": [], "files": 0, "lines": 0 },
  "sources": { "languages": "detected" },
  "notes": []
}
```

| Field | What it holds |
|---|---|
| `plan` | A plan file. Each part has `id`, `name` (the id), an empty `about`, `paths` and, when there is one, a `zone`. No `uses`, externals or scenarios. |
| `config` | A config file: `languages`; `watch`, except when the only language is `js` or nothing was found (the default watch then counts the same files); and `roots` when roots were given. |
| `measure` | Files and lines for each part, and in total. |
| `sources` | Where the languages and roots came from: `command line`, `codeplan.json`, `detected` or `default`. |
| `notes` | Things a person should know about the result, each with a `code` and a `message`. |
| `modules` | (java) The module paths found. `"."` stands for a module at the repository root. |
| `mappers` | (java) For the mapper XML files, which rule placed how many of them in a part. |

Writing `config` into `codeplan.json` (in place of its `languages`, `watch`
and `roots`, keeping the other keys) and `plan` into the plan file, then
running `update` and `check`, gives no orphans, no contested and no
unwatched files, no findings, and the same counts as `measure`. Running
`draft` again with that config gives the same result in every field but
`sources`: its `languages` (and `roots`, when the config has them) now reads
`codeplan.json`, because the values come from the config file this time.
The output never holds the repository's directory name or location.

## Inputs

- Languages come from `--language`, else the config file, else the files
  at the root, else `js`.
- Source roots come from `--root`, else `roots` in the config file. A root
  is a path to a directory in the repository, not a glob; in the config
  file a one-character set such as `[[]` stands for its character. A glob
  root in the config file stops `draft` with exit code 2.
- `home`, `skip` and `tests` from the config file apply. Its `watch` is not
  read.

## How parts are proposed

- Without modules, parts follow directories. Starting at the top, `draft`
  goes one directory level deeper while the number of parts stays within
  `--max-parts` and the deeper level splits something. Files right at the
  repository root form one part, `top`.
- For java, `draft` takes a directory as a module when both of these hold:
  - a build file sits directly in it;
  - one of the source roots exists below it, or its `src/main/resources`
    holds mapper XML.

  Inside a module, parts follow packages below the common package: the
  deepest package all its code shares. Java and Kotlin roots with the same
  package give one part.
- Files directly in the common package (an application's start class, for
  instance) form their own part, which lists each file by its exact path,
  such as `src/main/java/org/shop/App.java`. Its id is the last directory
  of the common package (`shop`); when the common package is the source
  root itself, the id is the module's name (`top` for the repository root).
  With two or more modules, it is the module's name.
- When there are still more parts than `--max-parts`, the smallest part (by
  lines) is folded into the part above it, again and again. Parts of
  different modules are not folded together when there are no more modules
  than `--max-parts`; when there are more, each module starts as one part
  and modules fold into the directories above them. When parts cannot fold
  any further, `draft` stops above the maximum and reports it in `notes`.
- Ids come from paths, in lowercase, with every run of other characters
  turned into one hyphen; a repeated id gets `-2`, `-3`, and so on. Zones
  are the top directory (without modules) or the module (with several).
- Each mapper XML goes to the first part that fits, in this order:
  1. the part that holds the class its `namespace` names;
  2. the part that holds the only `.java` or `.kt` file with the same file
     name in the module;
  3. the part with the longest package that contains the XML's directory
     under `src/main/resources`;
  4. the part that already holds that directory's other mapper XML, or the
     module's main part.
- Glob characters in paths are written as one-character sets, such as
  `[[]`.

## Mappers

In a java result, `mappers` reports where the mapper XML files went: a
count for each of the four rules in the list above, the files the last rule
took, and a count of the files outside the mapper patterns.

| Field | What it holds |
|---|---|
| `namespace` | How many found the class their `namespace` names. |
| `fileName` | How many found the only class file with the same name. |
| `package` | How many found a part by the package their directory sits in. |
| `rest` | How many went to the part holding their directory, or the module's main part. |
| `restFiles` | Those last files, by path. |
| `outsidePattern` | Mapper XML that neither mapper pattern matches, known by its `<mapper namespace>` element: the number of such files. `watch` names each one. |

## Notes

| Code | Meaning |
|---|---|
| `no-zones` | One module: no zones are proposed. |
| `over-max-parts` | More parts than `--max-parts`; they cannot fold further. |
| `modules` | More modules than `--max-parts`: how many modules there are and how many do not remain as parts. |
| `layers` | At least half of the Java and Kotlin files sit in directories named like layers (`controller`, `service`, …); the parts follow packages, not layers. |
| `exact-paths` | Files outside modules are listed in `watch` one by one; a directory pattern can replace them. |
| `build-output` | Files under build-output names are counted because the written `watch` reaches them. |
