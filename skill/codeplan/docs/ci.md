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

For a pull request that adds one file of 6 lines to the part `pay`:

````markdown
## codeplan

check: ok

### Changes

| Part | Files | Lines | Change |
|---|---|---|---|
| pay | 1 → 2 | 9 → 15 | changed |
````

The blocks, in order; one that has nothing to say is left out:

| Block | What it holds |
|---|---|
| Status line | `check: ok`, or `check: fails (…)` with what `check` would count: errors, warnings, orphan, contested and unwatched files, a page that is outdated, missing or not a codeplan page, and incomplete counting. |
| `### Findings` | The findings in the plan file, as `check` prints them. |
| `### Files in no part` | The orphan files. When counting is incomplete, one sentence says so in place of the list. |
| `### Contested files` | Each contested file and the parts that own it equally. |
| `### Unwatched files` | Code outside the watch set. |
| `### Changes` | Only with `--base`: a table of the parts whose counts changed, new parts and removed parts. |
| `### New directories` | Only with `--base`: directories that had no watched file in the base and whose files went to a part through a pattern that starts above the directory. |

A list shows 30 items and then the number of the rest.

In the Changes table, parts are matched by id: a part whose id changed is
one `new` row and one `removed` row. A planned part that now has files is
marked `planned, has code`. When the config or the `paths` of a part differ
between base and head, a sentence says that some changes come from the new
rules, and the directory notes are left out. When the base has no plan file,
or counting is incomplete on either side, a sentence says so in place of the
table.

A directory note such as
`src/newpkg/: 2 files went to part core through src/**` points at new code
that a wide pattern took in without anyone deciding where it belongs. Files
right at the repository root get no note.

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
| `owned` | Each file counted in one part, with its `path`, `part` and the `pattern` that won it. |
| `orphans` | The orphan files; empty when `complete` is `false`. |
| `contested` | Each contested file with its `path` and `parts`. |
| `unwatched` | Code outside the watch set. |
| `diagnostics` | The findings, each with `at`, `code`, `severity`, `message` and `fix`. |

Paths are in code unit order. The document holds no time and no absolute
path, so the same tree gives the same bytes.

## Exit codes

| Command | 0 | 2 |
|---|---|---|
| `snapshot` | printed | the repository or config cannot be used, the plan file is not JSON, or an option is unknown |
| `report` | printed | as for `snapshot`, or the `--base` file is missing, is not JSON, is not a snapshot, or has another `snapshot` or `rules` value |
