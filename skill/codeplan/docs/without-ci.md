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

A script can run `check` in a clone at fixed times and keep a record of
what it found. It stops nothing: a plan that is out of date is merged as
before, and the record shows it afterwards.

```sh
#!/bin/sh
# Usage: sh codeplan-record.sh <clone> <records>
clone=$1
records=$2
day=$(date +%Y-%m-%d)
mkdir -p "$records"
cd "$clone" || exit 2
git pull --quiet --ff-only || exit 2

node docs/codeplan/codeplan.mjs check > /dev/null 2>&1
code=$?
if [ -f "$records/base.json" ]; then
  node docs/codeplan/codeplan.mjs report --base "$records/base.json" > "$records/report-$day.md"
else
  node docs/codeplan/codeplan.mjs report > "$records/report-$day.md"
fi
printf '\ncheck exit code: %s\n' "$code" >> "$records/report-$day.md"
node docs/codeplan/codeplan.mjs snapshot > "$records/base.json.new" && mv "$records/base.json.new" "$records/base.json"
```

- `<clone>` is a clone used only for this, so that the pull has nothing to
  merge. `<records>` is a directory outside the clone. Give both as
  absolute paths.
- The script does not run `update`. It reports the plan file and the page
  as they are committed.
- Each run writes `report-<date>.md`: the state of the plan, the parts that
  changed since the run before (see [CI](ci.md) for the blocks of a
  report), and the exit code of `check` on the last line. Then it replaces
  `base.json` with a snapshot of the tree it just read. The first run has
  no `base.json` and writes the state alone.
- When the pull fails, the script ends with exit code 2 and writes no
  report.

A line for cron that runs it every Monday at 07:00:

```text
0 7 * * 1 sh /path/to/codeplan-record.sh /path/to/clone /path/to/records
```

cron starts commands with a short `PATH`. If `node` or `git` is not found,
set `PATH` at the top of the script.

## Only the page and the summary

`update` and `summary` need no hook and no schedule. Run `update` when you
want to read the page, and `summary` when you want the plan as Markdown or
as a mermaid diagram (see [summary](summary.md)). Neither tells you that
the plan is out of date: orphans, unwatched files and warnings do not stop
`update`, and `summary` prints with contested files too. What they show is
known to match the code only as of the last time `check` exited with 0.
Run `check` first when that matters.

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
