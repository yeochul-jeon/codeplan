# Config file

The config file is `codeplan.json` at the repository root. It is optional:
without it, every key has its default. A file that is not JSON, an unknown
key or a value of the wrong type makes every command stop with exit code 2.

```json
{
  "languages": ["java", "js"],
  "watch": ["src/main/java/**/*.java", "web/**/*.ts"],
  "skip": ["web/generated/**"],
  "tests": false,
  "home": "docs/codeplan"
}
```

## Keys

| Key | Type | Default | What it does |
|---|---|---|---|
| `languages` | array of strings | from the files at the root (see [languages](languages.md)), else `["js"]` | Which language rules to use. An empty array, a repeated name or an unknown name is an error. |
| `watch` | array of globs | built from the language rules | The files to count. |
| `skip` | array of globs | `[]` | Files to leave out of the watch set (generated code and the like). |
| `roots` | array of paths | the language source roots | Source roots. When written, they replace the language source roots entirely, and `tests` adds no test source roots. |
| `tests` | boolean | `false` | Whether test files are counted. |
| `home` | path | `docs/codeplan` | The directory for the plan file, the page and `codeplan.mjs`. Files under it are never counted. |
| `page` | path | `<home>/codeplan.html` | The page file. It must be under `home`. |

A value written in the config file always wins over the default.

## The watch set

The watch set is: the files `watch` matches, minus the files `skip`
matches, minus files under `home`, minus test files when `tests` is
`false`. `.git` and the dependency directories are never entered.

When `tests` is `false`, the test patterns also apply to a `watch` you
wrote. Build-output names are skipped only by the default watch; a `watch`
you wrote counts whatever it matches.

A `watch` pattern whose fixed text before the first wildcard is `home`, or
starts with `home/`, is an error.

## Path values

`home`, `page` and the plan file's `start` are paths relative to the
repository root, with parts joined by `/`. A backslash, a leading or
trailing `/`, an empty part (`//`), or a `.` or `..` part is an error, on
every system. `home` cannot be the repository root.

## Globs

Globs match paths relative to the repository root, joined by `/`.

- `*` matches within one path part; `?` matches one character in a part.
- `**` as a whole part matches zero or more directories: `a/**/b` matches
  `a/b` too.
- `[...]` is a character set; `{a,b}` picks one of the alternatives.
- `*`, `?` and `**` do not match a name that starts with a dot. Write the dot
  to reach one: `.storybook/**`.
- A set with one character is that character, taken literally: `[*]`,
  `[?]`, `[[]`, `[{]`, `[!]`. This is how to write a path that contains a
  glob character. There is no backslash escape.
- Patterns are read from the left. An unclosed `[` or `{` and an unpaired
  `]` or `}` are plain characters.
- Matching is case-sensitive.

Code in dot directories and dot files (such as `.eslintrc.cjs`) is in no
default watch and is never unwatched.
