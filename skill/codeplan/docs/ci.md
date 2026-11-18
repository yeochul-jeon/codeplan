# CI

Two things are useful in CI: `check`, which fails the job when the plan is
out of date with the code, and `report`, which writes for a pull request
what state the plan is in and what the pull request changed. `report` never
fails the job; only `check` does.

## A workflow for pull requests

```yaml
name: codeplan
on: pull_request
jobs:
  codeplan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v7
        with:
          node-version: 22
      - name: Measure the base
        run: |
          git worktree add "$RUNNER_TEMP/base" "${{ github.event.pull_request.base.sha }}"
          node docs/codeplan/codeplan.mjs snapshot --repo "$RUNNER_TEMP/base" > "$RUNNER_TEMP/base.json"
      - name: Report
        run: node docs/codeplan/codeplan.mjs report --base "$RUNNER_TEMP/base.json" >> "$GITHUB_STEP_SUMMARY"
      - name: Check
        run: node docs/codeplan/codeplan.mjs check
```

- The base is checked out as a second working tree because the counts of
  the base have to come from the base's files. `fetch-depth: 0` makes the
  base commit available. The second tree is put under `$RUNNER_TEMP`,
  outside the checkout: inside it, the base's code files would be counted
  as files of the pull request.
- The same `codeplan.mjs` (the pull request's) measures both trees, so the
  two sides are counted by the same rules.
- `report` exits with 0 whenever it printed, problems or not. The `Check`
  step after it is what fails the job.
- The report goes to the job summary, which is shown for pull requests from
  forks too. The text is Markdown, so a later step may also post it as a
  pull request comment; that step is yours to add.
- Use the `pull_request` event. Do not use `pull_request_target` for this:
  it would run the pull request's code with a token that can write to the
  repository.

## What report prints

For the example in [plan file](plan-file.md) and a pull request that adds
`src/pay/refund.ts`, a file of 6 lines that the task `refunds` is to make:

````markdown
## codeplan

check: ok

### Tasks

| Task | Status | Files |
|---|---|---|
| refunds | doing | 1 of 1 |
| basket-total | done | 1 of 1 |

### JS and TS imports

4 files read, 0 import paths not resolved, 0 imports to check. In the base: 3, 0, 0.

### Evidence entries with a stamp

1 evidence entries with a stamp, 0 with the stamp on one other line, 0 without the stamp on the written line, 0 with no such line, 0 with no such file. In the base: 1, 0, 0, 0, 0.

No entry is newly reported or no longer reported. An entry whose finding changed is not listed.

Entries are paired only when the part id, the `to` value and the evidence string are the same; writing any of them differently makes another entry. That an entry is no longer reported does not mean it was fixed.

### Changes

| Part | Files | Lines | Change |
|---|---|---|---|
| pay | 1 → 2 | 9 → 15 | changed |

| Task | Status | Files | Change |
|---|---|---|---|
| refunds | doing → doing | 0 of 1 → 1 of 1 | changed |
````

The blocks, in order; one that has nothing to say is left out:

| Block | What it holds |
|---|---|
| Status line | `check: ok`, or `check: fails (…)` with what `check` would count: errors, warnings, orphan, contested and unwatched files, a page that is outdated, missing or not a codeplan page, and incomplete counting. |
| `### Findings` | The findings in the plan file, as `check` prints them. |
| `### Files in no part` | The orphan files. When counting is incomplete, one sentence says so in place of the list. |
| `### Contested files` | Each contested file and the parts that own it equally. |
| `### Unwatched files` | Code outside the watch set. |
| `### Tasks` | A table of the tasks: id, status and `<n> of <m>`, the number of the task's `makes` paths that are files in the repository. Files is empty for a task with no `makes`. |
| `### JS and TS imports` | When the JS and TS imports were read (the `js` language, every part counted, no contested file): the files read, the import paths that look relative or match a `paths` key and give no file, and the `import-needs-check` lines. With `--base`, the base's three numbers follow when the base has them. It does not change the status line. |
| `### Evidence entries with a stamp` | When the head or, with `--base`, the base snapshot has `stampEntries`: the five numbers of the head, then with `--base` the base's numbers and the entries reported on one side only. See [evidence entries with a stamp](#evidence-entries-with-a-stamp). It does not change the status line. |
| `### Changes` | Only with `--base`: a table of the parts whose counts changed, new parts and removed parts, then a table of the tasks that changed, new tasks and removed tasks. |
| `### New directories` | Only with `--base`: directories that had no watched file in the base and whose files went to a part through a pattern that starts above the directory. |

A list shows 30 items and then the number of the rest. A table of tasks
shows 30 rows and then a sentence with the number of the rest.

In the Changes table, parts are matched by id: a part whose id changed is
one `new` row and one `removed` row. A planned part that now has files is
marked `planned, has code`. When the config or the `paths` of a part differ
between base and head, a sentence says that some changes come from the new
rules, and the directory notes are left out. When the base has no plan file,
or counting is incomplete on either side, a sentence says so in place of the
table.

In the table of task changes, tasks are matched by id. A task is `changed`
when its status, the paths in its `makes` or the paths that are not there
differ; the row then gives status and count on both sides, such as
`doing → done` and `1 of 2 → 2 of 2`, also when one of them stayed the same.
When no task changed, a sentence says so. When the plan file has an error on
either side, a sentence says that task changes are not shown. With no tasks
on either side there is nothing about tasks. A base snapshot made before
tasks existed counts as having none.

A directory note such as
`src/newpkg/: 2 files went to part core through src/**` points at new code
that a wide pattern took in without anyone deciding where it belongs. Files
right at the repository root get no note.

### Evidence entries with a stamp

The numbers come from `stampEntries` and the lists from the `entry` of
each finding in `diagnostics`. Four cases, with `--base`:

- Both snapshots have `stampEntries`: the base's five numbers follow the
  head's, then the entries reported in the head and not in the base, the
  entries reported in the base and not in the head, and one paragraph on
  how entries are paired. When both lists are empty, one sentence says that
  no entry is newly reported or no longer reported.
- Only the head has it: one sentence says the entries are not compared.
  That is so for a base made by an older codeplan and for a base whose plan
  had no stamp.
- Only the base has it: one sentence gives the base's number of entries.
  The head may have no stamp, no plan file, or a plan file that is not
  an object.
- Neither has it: the block is left out. That means there is nothing to
  compare, not that no evidence entry is out of place.

Entries are paired by their part id, `to` value and evidence string, and by
nothing else:

- An entry in the second list was not necessarily fixed. It is there also
  when the evidence was removed, when its stamp was taken off, or when its
  line or stamp was written again, with or without reading the line.
- Writing the evidence string, the part id or the `to` value differently
  puts the old entry in the second list and, when the new string has a
  finding again, the new one in the first. A changed name is not guessed.
- An entry whose finding changed, such as from one other line to no such
  line, is in neither list. The numbers can differ, or stay the same when
  two entries change places.
- An evidence entry with a stamp whose file is gone or shorter is compared
  like the others. The same findings of an entry with no stamp are not
  compared.
- An entry is not compared when its part id or `to` value is not of the id
  form, or when the same string is written twice in one use or in two uses
  of a part with the same `to`. Both of the two are left out. When it is
  written twice on one side only, the one on the other side can show up in
  a list although nothing was added or removed. The number of findings of
  one other line or of no stamp on the written line left out this way is
  given in a last sentence; the left-out findings of no such line or file
  are in the numbers only.

Without `--base`, `report` prints the state alone:

```sh
node docs/codeplan/codeplan.mjs report
```

## What snapshot prints

`snapshot` prints one JSON document and writes nothing. It ends with exit
code 0 also when there are findings or problems; the document says what
they are.

| Field | What it holds |
|---|---|
| `snapshot` | The format of this document: `1`. |
| `rules` | The version of the counting rules: `1`. `report` refuses a base whose `snapshot` or `rules` is not its own. |
| `config` | The `languages`, `watch`, `skip`, `roots` and `tests` in use, defaults filled in. `watch` is `null` when the config file has none. |
| `plan` | `ok`, `missing` (no plan file) or `invalid` (the plan file has an error). |
| `complete` | `false` when a part was left out of counting. |
| `page` | `ok`, `outdated`, `missing`, `foreign` (something else is at the page place) or `not-checked` (no plan file, an error in it, or contested files). |
| `parts` | The counted parts in plan file order, each with `id`, `paths`, `planned`, `files` and `lines`. |
| `jsImports` | Only when the JS and TS imports were read (the `js` language, every part counted, no contested file): `files` (the JS and TS files read), `notResolved` (each file and import path that looks relative or matches a `paths` key and gives no file, once) and `toCheck` (the `import-needs-check` lines). A base without it is read; a base with it in another form is refused. |
| `stampEntries` | Only when the plan has an evidence entry with a stamp: the counts of those entries. `entries` (all of them, as the `stamps` command prints them), `elsewhere` (one other line has the stamp), `differs` (the written line does not have the stamp), `noLine` (the file does not have the line) and `noFile` (no such file). `entries` is the entries with no finding plus the other four. A base without it is read; a base with it in another form is refused. |
| `owned` | Each file counted in one part, with its `path`, `part` and the `pattern` that won it. |
| `orphans` | The orphan files; empty when `complete` is `false`. |
| `contested` | Each contested file with its `path` and `parts`. |
| `unwatched` | Code outside the watch set. |
| `tasks` | The tasks in plan file order, each with `id`, `status` (`null` when the plan file's value is not one of the three), `makes` (its paths, each once) and `missing` (those that are not files in the repository). |
| `diagnostics` | The findings, each with `at`, `code`, `severity` (`error`, `warning` or `info`), `message` and `fix`. A finding of an evidence entry with a stamp also has `entry`: the entry's `part`, `to` and `evidence`, as the `stamps` command prints them. It is left out when the part id or the `to` value is not of the id form, and when two such findings have the same three values. A base with an `entry` that is not three strings is refused. |

Paths are in code unit order. The document holds no time and no absolute
path, so the same tree gives the same bytes.

## Exit codes

| Command | 0 | 2 |
|---|---|---|
| `snapshot` | printed | the repository or config cannot be used, the plan file is not JSON, or an option is unknown |
| `report` | printed | as for `snapshot`, or the `--base` file is missing, is not JSON, is not a snapshot, or has another `snapshot` or `rules` value |

Any command exits with 3 on an error that codeplan did not expect (see
[commands](commands.md#exit-codes)). A CI step fails on it as on 1 or 2;
set `CODEPLAN_STACK` to `1` in the step to print the stack.
