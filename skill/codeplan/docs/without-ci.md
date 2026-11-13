# Without CI

This reference is for a repository that has no CI, or whose CI you cannot
change. There, `check` does not stop a pull request: a plan that is out of
date can be merged, and nobody is told. What is left is to run `check`
yourself, at the times below.

## Checking before your own push

A pre-push hook in your clone runs `check` each time you push, and git
refuses the push when `check` exits with something other than 0. Run this
at the repository root:

```sh
cat > .git/hooks/pre-push <<'EOF'
#!/bin/sh
node docs/codeplan/codeplan.mjs check
EOF
chmod +x .git/hooks/pre-push
```

- The file is in `.git`, so it is not committed. It checks your pushes
  only; other people's pushes are not checked.
- `git push --no-verify` pushes without running the hook.
- `check` reads the files on disk, not the commits that are pushed. A
  change you have not committed is counted too.

## Checking on a schedule

A script can run `snapshot` in a clone at fixed times and keep what it
prints, one file for each run. It stops nothing: a plan that is out of
date is merged as before, and the records show it afterwards.

```sh
#!/bin/sh
# Usage: sh codeplan-record.sh <clone> <records> [<name>]
clone=$1
records=$2
name=${3:-$(date -u +%Y%m%dT%H%M%SZ)}
mkdir -p "$records" || exit 2
if [ -e "$records/$name.json" ] || [ -e "$records/$name.failed" ]; then
  echo "codeplan-record: $records already has a record named $name" >&2
  exit 2
fi
cd "$clone" || exit 2
out=$records/$name.out.tmp
err=$records/$name.err.tmp
if ! git pull --quiet --ff-only 2> "$err"; then
  mv "$err" "$records/$name.failed"
  exit 2
fi
if node docs/codeplan/codeplan.mjs snapshot > "$out" 2> "$err"; then
  mv "$out" "$records/$name.json"
  rm -f "$err"
else
  mv "$err" "$records/$name.failed"
  rm -f "$out"
  exit 1
fi
```

- `<clone>` is a clone used only for this, so that the pull has nothing to
  merge. `<records>` is a directory outside the clone. Give both as
  absolute paths.
- The script does not run `update`. It records the plan file and the page
  as they are committed.
- Each run leaves one record, `<name>.json`: what `snapshot` printed. The
  name is the UTC time of the run unless a third argument gives another.
- When `snapshot` exits with something other than 0 (a config file that
  cannot be read, for example), the run leaves `<name>.failed` with what
  `snapshot` wrote on standard error, and the script exits with 1.
- When the pull fails, `snapshot` does not run. The run leaves
  `<name>.failed` with what git wrote on standard error, and the script
  exits with 2.
- A record is written under another name and then renamed, so the
  directory never holds half of a `.json` or `.failed` file.
- When the directory already has a record of that name, the script exits
  with 2 before it does anything and leaves the record as it is. It takes
  no lock: do not start two runs on the same records directory at the same
  time.
- A script of an earlier version of this reference left `base.json` and
  `report-<date>.md` in the directory. Move `base.json` away or remove it:
  `history` reads it as a record named `base`.

A line for cron that runs it every Monday at 07:00:

```text
0 7 * * 1 sh /path/to/codeplan-record.sh /path/to/clone /path/to/records
```

cron starts commands with a short `PATH`. If `node` or `git` is not found,
set `PATH` at the top of the script.

`history` makes one HTML file from the records:

```sh
node docs/codeplan/codeplan.mjs history /path/to/records > /path/to/records/history.html
```

The file can stay in the records directory: `history` reads only names
that end in `.json` or `.failed`. It has a table of the parts that changed
from record to record and says in which records the plan was out of date;
see [history](history.md).

## Only the page and the summary

`update` and `summary` need no hook and no schedule. Run `update` when you
want to read the page, and `summary` when you want the plan as Markdown or
as a mermaid diagram (see [summary](summary.md)). Neither tells you that
the plan is out of date: orphans, unwatched files and warnings do not stop
`update`, and `summary` prints with contested files too. What they show is
known to match the code only as of the last time `check` exited with 0.
Run `check` first when that matters.

## A clone that does not commit the page

When the plan file is committed and the page is not, a clone has no page
or an old one, and `check` exits with 1 for that alone. Run
`check --no-page` there: it does not compare the page and counts the other
problems as before. Its output has the line `page: not compared` before the
summary line.

## When the plan cannot be committed

The four files (`docs/codeplan/codeplan.mjs`, `docs/codeplan/plan.json`,
`codeplan.json` and `docs/codeplan/codeplan.html`) can stay in your clone
alone. List them in `.git/info/exclude`, which works as `.gitignore` does
but is not committed:

```sh
printf '%s\n' docs/codeplan/ codeplan.json >> .git/info/exclude
```

- git does not track the files, so `git pull` and a change of branch leave
  them where they are. codeplan reads the disk and not git's list of files,
  so every command works as before.
- Other people do not get the plan from the repository. Send them the
  output of `summary`, or the page file, which opens from disk and loads
  nothing from outside.
- A clone made later does not have the files. Keep a copy of the plan file
  and the config file somewhere else.

## Adding check to CI later

In any CI, one step is enough: with Node 22 or later present, run

```sh
node docs/codeplan/codeplan.mjs check
```

at the repository root. The step fails when the exit code is not 0; see
[commands](commands.md) for what 1 and 2 mean. An example for GitHub
Actions, with a report on each pull request, is in [CI](ci.md).
