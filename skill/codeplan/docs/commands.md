# Commands

codeplan is one file, `codeplan.mjs`. In a repository it lives at
`<home>/codeplan.mjs` and runs with Node 22 or later:

```sh
node docs/codeplan/codeplan.mjs <command> [--repo <dir>] [options]
node docs/codeplan/codeplan.mjs history <records-dir>
```

The repository is the current directory. `--repo <dir>` names another one;
a directory that does not exist (or is a file) gives exit code 2 and one
line naming the path.

Output for people goes to standard output; problem lists and errors go to
standard error.

| Command | What it does |
|---|---|
| `check` | Counts the files, checks the plan file and compares the page with what `update` would write. Writes nothing. |
| `update` | Writes the page. |
| `draft` | Prints a first plan file and config file for the repository, as one JSON document. Writes nothing. |
| `summary` | Prints the plan as Markdown with a mermaid diagram; see [summary](summary.md). Writes nothing. |
| `snapshot` | Prints what `check` finds as one JSON document; see [CI](ci.md). Writes nothing. |
| `report` | Prints the state of the plan, and with `--base` the changes since a snapshot, as Markdown for a pull request; see [CI](ci.md). Writes nothing. |
| `history <records-dir>` | Prints the records in a directory as one HTML file; see [history](history.md). Reads no repository. Writes nothing. |
| `stamps` | Prints one JSON line for each evidence entry of the plan: its state, a line and the stamp of that line; see [`stamps`](#stamps). Writes nothing. |
| `help` | Prints the usage. |

| Option | Command | What it does |
|---|---|---|
| `--repo <dir>` | all but `history` | The repository to read. |
| `--no-page` | `check` | `check` does not compare the page. |
| `--max-parts <n>` | `draft` | The most parts to propose (default 16). Decimal digits only, 1 or more. |
| `--parts-by-name <n>` | `draft` | Also make parts from the first word of file names in layer directories, when `<n>` or more files start with that word. Decimal digits only, 1 or more, given once. See [draft](draft.md). |
| `--language <name>` | `draft` | `js` or `java`. Repeat for both. |
| `--root <dir>` | `draft` | A source root to use instead of the language rules. Repeat for more. |
| `--mermaid` | `summary` | Print only the mermaid diagram. |
| `--base <file>` | `report` | A snapshot of the tree to compare with. |

An option on a command it does not belong to, an unknown command or an
unknown option give exit code 2 and the usage. `history` takes no option:
an option, or anything but one directory, gives exit code 2 and one line
without the usage.

## Exit codes

| Command | 0 | 1 | 2 |
|---|---|---|---|
| `check` | no problems | orphans, contested or unwatched files, an out of date page, or a warning | the config or plan file cannot be read, an error in the plan file, or something other than a codeplan page at the page place |
| `update` | written, already up to date, or no plan file | contested files (nothing written) | as for `check` |
| `draft` | printed | — | an option, the config file or the repository cannot be used |
| `summary` | printed, with or without warnings, orphans, contested or unwatched files | — | an error in the plan file, no plan file, or the config or plan file cannot be read |
| `snapshot` | printed, with or without findings and problems | — | the config cannot be used, or the plan file is not JSON |
| `report` | printed, with or without findings and problems | — | as for `snapshot`, or the `--base` file cannot be used |
| `history` | printed, with or without skipped files | — | not one directory given, an option given, the directory cannot be read, or no file in it is a snapshot |
| `stamps` | printed, also with no line; it does not mean the evidence is right | — | the config cannot be used, there is no plan file, or the plan file is not JSON |
| `help` | always | — | — |

## What stops `update` and `check`

The first of these that applies decides the result:

1. A config error (including a `page` outside `home` or outside the
   repository): both exit with 2.
2. A plan file that is not JSON: both exit with 2.
3. Something other than a codeplan page at the page place (a directory, a
   symbolic link, a file that does not start with the page's first line,
   an empty file), or a symbolic link among the directories from the
   repository root to the page: both exit with 2 and leave it as it is.
4. No plan file: `update` writes nothing, says so and exits with 0; `check`
   reports `no-plan` and exits with 1 without comparing the page.
5. An error in the plan file: `update` writes nothing and exits with 2;
   `check` exits with 2 without comparing the page.
6. Contested files: `update` writes nothing and exits with 1 (an earlier
   page stays); `check` lists them with the other problems and exits with 1
   without comparing the page.

Orphans, unwatched files and warnings do not stop `update`.

## `check`

`check` prints the languages, the number of watched files and, for each
part, its file and line counts, then a summary line. When everything is in
order the summary is `check: ok`. Otherwise it lists, on standard error,
orphans, contested files, unwatched files, the page if it is out of date,
and the plan file's findings (see [diagnostics](diagnostics.md)), each with
a line saying how to fix it.

With `--no-page`, `check` does not compare the page and does not read the
page place: a page that is out of date or not there, or something else at
the page place, changes nothing. The config is checked as before. The line
before the summary line is then:

```text
page: not compared
```

The summary line reads `check: ok`, or when something is wrong:

```text
check: 2 orphan, 0 contested, 1 unwatched, 0 errors, 3 warnings, page outdated
```

The last part, `, page outdated`, appears only when the page is out of
date. When a part is left out of counting (see
[diagnostics](diagnostics.md#incomplete-counting)), the orphan count is
replaced:

```text
check: measurement incomplete, 0 contested, 0 unwatched, 1 errors, 0 warnings
```

An out of date page shows as:

```text
page outdated: docs/codeplan/codeplan.html differs from the page update would write now
  fix: run update
```

## `update`

`update` writes the whole page file when it differs from what is there
(and creates its directory if needed). It writes a new file beside the page
and renames it over the page, so a file hard-linked to the page is left as
it was. When nothing changed it writes nothing.

```text
update: wrote docs/codeplan/codeplan.html
update: docs/codeplan/codeplan.html is up to date
update: docs/codeplan/plan.json not found, so no page was written
```

## `draft`

See [draft](draft.md).

## `stamps`

`stamps` reads the config file, the plan file and the files that evidence
entries name, and prints one line for each evidence entry. The output is
for programs and agents. It does not count files and does not look at the
page place, so it prints also when the page place holds something else or
a file no evidence names cannot be read. It writes nothing.

```text
{"at":"parts[0].uses[1].evidence[0]","part":"cart","to":"pay","evidence":"src/cart/checkout.ts:12#5d41402a","state":"elsewhere","line":14,"stamp":"5d41402a"}
```

Each line is a stamps line: one JSON object without spaces between its
items, then one LF. A tab or LF in a string is written as `\t` or `\n`,
so the LF bytes of the output are only at the ends of lines. There is one
line for each string in an `evidence` array of a use that is an object, in
a part that is an object and is not a later part with a repeated id, when
the string is written as `file:line` or `file:line#stamp` (see
[plan file](plan-file.md#stamps)). Other entries are left out; `check`
reports them. The lines follow the order of the plan file, and there is no
limit on their number. With no such entry the output is empty.

| Key | Value |
|---|---|
| `at` | The place of the entry in the plan file, as in [diagnostics](diagnostics.md). Two entries with the same string differ here. |
| `part` | The id of the part, or `null` when it is not a well-formed id. |
| `to` | The `to` of the use, or `null` when it is not a well-formed id. |
| `evidence` | The string as written. |
| `state` | What the tool found; see below. |
| `line` | A line number, or `null`. |
| `stamp` | A stamp, or `null`. |

`state`, `line` and `stamp` are what the tool read in the file now. They are
not values to copy into the plan: read the line first, and write its number
or stamp only when it still shows the use.

| `state` | When | `line` | `stamp` |
|---|---|---|---|
| `same` | The entry has a stamp and the written line has it. | the written line | the written stamp |
| `no-stamp` | The entry has no stamp and the file has the line. | the written line | the stamp of that line now |
| `elsewhere` | `check` reports `evidence-stamp-elsewhere`. | the one line that has the stamp | the written stamp |
| `differs` | `check` reports `evidence-stamp-differs`. | the written line | the stamp of that line now |
| `no-line` | `check` reports `evidence-no-line`. | `null` | `null` |
| `no-file` | `check` reports `evidence-no-file`. | `null` | `null` |

For the same plan file and the same files, the `state` of an entry and what
`check` reports for it agree: `same` and `no-stamp` have no finding.

Exit code 0 means the lines were printed: also with no line, with errors in
the plan file, or with a plan file whose top level is not an object (then
no line). Standard error is then empty. Exit code 0 does not mean the
evidence is right. Exit code 2 means the config cannot be used, there is no
plan file, the plan file is not JSON, or an option or an extra argument was
given: nothing on standard output and one line on standard error that
starts with `codeplan: ` (with the usage for an option or an argument).
With no plan file it prints no `no-plan` finding.
