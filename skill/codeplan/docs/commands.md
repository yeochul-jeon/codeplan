# Commands

codeplan is one file, `codeplan.mjs`. In a repository it lives at
`<home>/codeplan.mjs` and runs with Node 22 or later:

```sh
node docs/codeplan/codeplan.mjs <command> [--repo <dir>] [options]
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
| `help` | Prints the usage. |

| Option | Command | What it does |
|---|---|---|
| `--repo <dir>` | all | The repository to read. |
| `--max-parts <n>` | `draft` | The most parts to propose (default 16). Decimal digits only, 1 or more. |
| `--language <name>` | `draft` | `js` or `java`. Repeat for both. |
| `--root <dir>` | `draft` | A source root to use instead of the language rules. Repeat for more. |
| `--mermaid` | `summary` | Print only the mermaid diagram. |

An option on a command it does not belong to, an unknown command or an
unknown option give exit code 2 and the usage.

## Exit codes

| Command | 0 | 1 | 2 |
|---|---|---|---|
| `check` | no problems | orphans, contested or unwatched files, an out of date page, or a warning | the config or plan file cannot be read, an error in the plan file, or something other than a codeplan page at the page place |
| `update` | written, already up to date, or no plan file | contested files (nothing written) | as for `check` |
| `draft` | printed | — | an option, the config file or the repository cannot be used |
| `summary` | printed, with or without warnings, orphans, contested or unwatched files | — | an error in the plan file, no plan file, or the config or plan file cannot be read |
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
