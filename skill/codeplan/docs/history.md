# history

`history` reads a directory of records and prints one HTML file: a table
of the parts that changed from each record to the next.

```sh
node docs/codeplan/codeplan.mjs history /path/to/records > /path/to/records/history.html
```

It takes the directory and no option, reads no repository, no config file
and no plan file, and writes nothing. The history file opens from disk and
loads nothing from outside. It is not the page: `check` does not compare
it, and there is no need to commit it.

## The records directory

A record is one file, left by one run of a script such as the one in
[Without CI](without-ci.md). `history` looks only at plain files directly
in the directory; it does not go into directories and does not follow
symbolic links.

| File name | What it is |
|---|---|
| `<name>.json` | What `snapshot` printed in that run. |
| `<name>.failed` | A marker for a run that has no snapshot: `snapshot` exited with something other than 0, or the newest code could not be fetched. Its first line is shown as the reason. |
| any other name | Not read, and not mentioned. |

- The order of the records is the order of their names, character by
  character. The tool reads no time, neither from a name nor from a file.
  Names made of a UTC time in a fixed width, such as `20260105T070000Z`,
  sort in the order of the runs as long as the clock was right.
- A `.json` file that cannot be used is skipped, with one line on standard
  error, `history: skipped <file>: <reason>`. The reasons are `cannot
  read`, `not JSON`, `another version` (a snapshot or rules version this
  `codeplan.mjs` does not read), `not a snapshot` and `unsupported name`
  (a name with a control character, or one that is not UTF-8).
- A `.failed` file beside a `.json` file of the same name is skipped
  (`a snapshot has the same name`).
- Of a `.failed` file, the first 200 characters of the first line are
  used.
- A file named `base.json` is read as a record named `base`. Move it away
  if a script of an earlier version of this reference left one.

A record is as large as the list of watched files it holds: `snapshot`
names every watched file with the part that owns it. For a repository with
16 watched files it is 2,077 bytes. There is no shorter form. The history
file holds no file list, so its size follows the number of records and
parts.

## The sentences at the top

- `The plan was not out of date in any record.`, or one sentence for each
  run of records in which it was: `The plan was out of date from <first>
  to <last>.` (`in <name>` for one record). The plan is out of date in a
  record that has no plan file or a plan with an error, an orphan, a
  contested or an unwatched file, or a finding that is a warning or an
  error.
- `The page was up to date in every record.`, or one sentence for each
  run of records with the same state: `outdated`, `missing`, `not a
  codeplan page`, or `not compared` (`check` does not compare the page
  when there is no plan file, the plan has an error, or a file is
  contested).
- `Not measured: <names>.` lists the records that are marker files.
- `Files not read: <file> (<reason>), …` lists the skipped files.

The last two lists stop after 30 names and say how many more there are.

## The table

Each column is a record and each row is a part.

- A record that is the same as the measured record just before it gets no
  column. The column before it is followed by a narrow one that says how
  many such records there are, for example `3 same records`. Two records
  are the same when every field of the snapshot but the file list `owned`
  has the same value.
- A cell has text when the part changed since the measured record before:
  `+12` or `-3` for the change in lines, `+0` when the files changed and
  the line count did not, `new` for a part that was not there before, and
  `removed` for one that is gone. An empty cell means no change. More and
  fewer lines differ by the sign alone, not by colour.
- A part with no change in any column has no row. Such parts are named
  under the table: `Parts not in the table: <ids>.`
- The rows are in the order of the parts in the last record, then the
  parts it does not have.

Under the name of a record, the column head says what changed since the
measured record before:

| Word | Meaning |
|---|---|
| `plan` | Whether the plan is out of date changed, or what makes it so: the findings, the orphans, the contested or unwatched files. On the first record: the plan is out of date. |
| `page` | The state of the page changed. On the first record: the page is not up to date. |
| `config` | The config changed, or the `paths` of a part. Changes in this column can come from new rules and not from new code; the column stands a little apart from the one before. |
| `tasks` | A task is new, changed or removed. |
| `not compared` | The parts and tasks are not compared here: the record before has no plan file, or one of the two has a part left out of counting. |
| `not measured` | The record is a marker file. |

## Choosing a record

The name in a column head is a button. It shows, under the table, what
that record holds:

- the line `check: ok` or `check: fails (…)` as `report` prints it;
- the names of the records after it that are the same;
- which record it is compared with, and then the table of parts that
  changed (`Part`, `Files`, `Lines`, `Change`) and the table of tasks that
  changed, as under `### Changes` in a report (see [CI](ci.md)). The task
  table stops after 30 rows.
- for a marker file, `Not measured:` and its first line.

The same button again, or Esc, hides it. The lists of files and findings
are not in the history file. They are in the record: open `<name>.json`.

The button at the bottom changes the colour theme, as on the page (see
[page](page.md)).

## Exit codes

0 when the file was printed, with or without skipped files. 2, with one
line on standard error after the lines for skipped files, when it is not
given exactly one directory, when an option is given (`--repo` too), when
the directory cannot be read, or when no file in it is a snapshot.
