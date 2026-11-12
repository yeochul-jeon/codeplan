---
name: codeplan
description: Use when a repository needs a plan of its code that stays true over time, or already has one under docs/codeplan. codeplan splits a JavaScript/TypeScript or Java/Kotlin repository into parts, counts the files and lines each part owns, draws a page with the parts, what uses what, and scenarios a reader can step through, and fails a CI check when the plan file is out of date with the code. Use it to make a first plan with draft, to refine part names, descriptions, uses and scenarios, to fix check failures, and to read or update the page. Not for repositories whose code is only in other languages.
license: MIT
---

# codeplan

codeplan keeps a plan of a repository next to its code. The plan file
(`docs/codeplan/plan.json`) holds what people write: parts with names and
descriptions, what each part uses, externals, and scenarios. The tool counts
the files and lines each part owns from its `paths`, writes a page that draws
it all (`docs/codeplan/codeplan.html`), and `check` fails when the plan file,
the code and the page no longer agree.

The tool is one file, `codeplan.mjs`, run with Node 22 or later. The
reference for every field, rule and code is in the [docs](docs/) folder next
to this file:

- [languages](docs/languages.md): what is counted for js and java
- [config](docs/config.md): `codeplan.json` keys, path values and globs
- [ownership](docs/ownership.md): how a file finds its part; orphans,
  contested and unwatched files
- [plan file](docs/plan-file.md): every field of `plan.json`
- [diagnostics](docs/diagnostics.md): every finding of `check` and its fix
- [commands](docs/commands.md): commands, options and exit codes
- [page](docs/page.md): what the page draws, the walk-through and themes
- [draft](docs/draft.md): how `draft` proposes parts

## When codeplan fits

It fits a repository with JavaScript or TypeScript (`js`), or Java and
Kotlin with optional MyBatis mapper XML (`java`), or both. In a repository
where all code is in other languages, codeplan counts nothing; say so and do
not install it. In a mixed repository, it covers only the js and java code.

## The repository has no plan yet

Look at `codeplan.json` first. If it is there and has `languages`, `watch`
or `roots`, the `node -e` command below replaces those three keys without
asking. In that case run the lines up to `draft`, show the person the old
values next to the `config` values in `codeplan-draft.json`, and run the
rest only after they agree.

Copy the tool into the repository and make a first plan with `draft`:

```sh
mkdir -p docs/codeplan
cp "${CLAUDE_SKILL_DIR}/codeplan.mjs" docs/codeplan/codeplan.mjs
node docs/codeplan/codeplan.mjs draft > codeplan-draft.json
node -e '
const fs = require("fs");
const draft = JSON.parse(fs.readFileSync("codeplan-draft.json", "utf8"));
const config = fs.existsSync("codeplan.json") ? JSON.parse(fs.readFileSync("codeplan.json", "utf8")) : {};
for (const key of ["languages", "watch", "roots"]) delete config[key];
fs.writeFileSync("docs/codeplan/plan.json", JSON.stringify(draft.plan, null, 2) + "\n");
fs.writeFileSync("codeplan.json", JSON.stringify({ ...config, ...draft.config }, null, 2) + "\n");
'
rm codeplan-draft.json
```

`${CLAUDE_SKILL_DIR}` is the folder of this skill; it is filled in when the
skill is loaded. If it is empty (you are reading this file directly), use
the folder this SKILL.md is in.

The draft is one JSON document; the `node -e` command writes its `plan` to
`docs/codeplan/plan.json` and its `config` to `codeplan.json` at the root,
and the draft file is removed again. When `codeplan.json` is already there,
the command takes `languages`, `watch` and `roots` out of it, puts the
draft's values in their place, and leaves every other key as it was. It
writes the whole file again, so the order of the keys and the line breaks
can change. Read the draft's `notes`: they say when parts could not be folded down to
the maximum, when files outside modules are listed one by one in `watch`,
and when the code looks layered. `--max-parts <n>` asks for fewer or more
parts (default 16); `--language` and `--root` override what `draft` finds.

The draft's parts follow directories (and Java packages within modules).
Its names are the ids, its descriptions are empty, and it has no `uses`,
externals or scenarios. Those are for people to write, with your help, as
below.

Then write the page and check:

```sh
node docs/codeplan/codeplan.mjs update
node docs/codeplan/codeplan.mjs check
```

Commit four files: `docs/codeplan/codeplan.mjs`, `docs/codeplan/plan.json`,
`codeplan.json` and `docs/codeplan/codeplan.html`. The page is generated, but
`check` compares it byte for byte, so it belongs in the commit.

## Refining the plan file

Each field is described in [plan file](docs/plan-file.md). What to put in
each:

- Part `name`: what the people working on the code call this part. The page
  shows the id when it is empty.
- Part `about`: what the part is and why it is separate from its neighbours,
  in a sentence or two. Write `{id}` to point at another part or an external.
- `zone`: a name shared by parts that belong together (a layer, a product
  area). Parts with the same zone are drawn in one frame.
- `start`: one file to start reading the part from, as a path from the
  repository root.
- `paths`: the globs of the files the part owns. The strongest pattern (the
  longest fixed text before a wildcard) wins, so a narrower part can take a
  subdirectory out of a wider one. See [ownership](docs/ownership.md).
- `uses`: the parts and externals this part calls or depends on. `why` says
  what for; `evidence` lists `file:line` places in the code that show the use.
- `externals`: things outside the repository that parts use: databases,
  outside APIs, other repositories. Give each an `id`, `name` and `about`.
- `scenarios`: one request's path through parts and externals. Each step has
  `at` (a part or external id) and `does` (what happens there). Two steps in
  a row at different places should be joined by a use, or `check` warns
  with `gap-in-scenario`.
- `planned`: `true` on a part whose code does not exist yet. Give it the
  `paths` the code will have; `check` then does not report `empty-part`,
  and the page draws it with a dashed border. When the first file arrives,
  `check` warns with `planned-has-files`: remove `planned` then.
- `note`: a note for people anywhere; the tool keeps it and does not read it.

Write a use only when the code shows it: an import, a call, a client, a
query. Put the place in `evidence`. A relation you cannot find in the code
does not go into the plan; ask the person instead. The plan does not have to
list every use for `check` to pass: missing uses are not an error. Two
steps in a row of a scenario at different places do want a use between
them, though; without one `check` warns with `gap-in-scenario`, and writing
the use (when the code shows it) removes the warning.

A part that nearly every other part uses (settings, shared helpers) follows
the same rule: a use from each part is allowed, not needed. Write the ones a
scenario passes through, and say in that part's `about` that the others use
it too.

An `evidence` entry points at the line that shows the use, such as the
import line or the call line, as `file:line`. `check` wants `evidence` to be
a list of strings and nothing more: it does not open the file or look at
the line.

## What to decide yourself and what to ask

You can decide on your own: names and `about` texts drawn from the code and
its README, `start` files, `uses` with `evidence` you found, `zone` names
that follow an existing structure, scenarios that follow a request through
code you read, and the fixes for findings that have one clear fix.

Ask the person before you:

- keep the draft's parts as they are or split and merge them differently
  (the draft follows directories; the people may think of the code in other
  units);
- write a use, an external or a scenario step you could not confirm in the
  code;
- move files between parts in a way that changes what a part means;
- add files to `skip` (that hides them from the plan);
- change `languages`, `roots` or `watch` away from what `draft` proposed.

## Writing the page and checking

`update` writes the page; `check` writes nothing and exits with 0 when all is
in order. Run `update` after any change to the plan file or the code, then
`check`. The order matters: `check` right after an edit of the plan file,
with no `update` in between, reports `page outdated` and exits with 1.
Exit codes: 0 ok; 1 a problem or warning (orphans, contested or
unwatched files, an out of date page, a warning finding); 2 a config or plan
file that cannot be used or an error finding. See
[commands](docs/commands.md).

## The plan exists and check fails

Read the lists on standard error; each comes with a `fix:` line.

- Orphan files: no part owns them. Add a glob to the part they belong to, or
  a new part. If they are generated or vendored, ask before adding them to
  `skip`.
- Contested files: the strongest patterns that match them tie, and those
  patterns sit in different parts. In the part that should win, lengthen
  the fixed text at the start of its pattern; or narrow one part's globs
  until only one part matches.
- Unwatched files: code outside the watch set, such as a Java file outside
  the source roots. Add a pattern to `watch` (or, after asking, to `skip`).
- `page outdated`: run `update` and commit the page.
- Findings in the plan file, as `<at>: <code> [<severity>] <message>`: the
  `at` names the place, such as `parts[2].uses[0].to`. Each code and its fix
  is in [diagnostics](docs/diagnostics.md). Fix errors first: while a part's
  `paths` is broken, orphans are not listed and counting is incomplete.
- `empty-part`: the part's `paths` match nothing. Correct the globs, or ask
  whether the part should go. If the code is still to be written, ask
  whether the part is planned, and set `planned` to `true` when it is.
- `planned-has-files`: a planned part now has files. Remove `planned`; if
  the files are not that part's code, correct its `paths`.

A config error (unknown key, wrong type, a path with a backslash, `..`, `./`
or a trailing `/`) stops every command with exit code 2 and one line naming
the key.

## Reading the page

Open `docs/codeplan/codeplan.html` in a browser from disk. Parts are
rectangles sized by their lines, inside zone frames; externals sit below.
Lines with arrows are uses; dashed lines join scenario steps that have no
use between them.

To follow a scenario, choose it in the select box under the picture, then
use the buttons or the Left and Right arrow keys; Esc closes it. The address
fragment `#scenario=<id>&step=<k>` opens a step directly, which is useful
for links. The theme button switches between `auto`, `light` and `dark`.
See [page](docs/page.md).

The page is generated. Never edit it by hand; change the plan file and run
`update`.

## Checking in CI

Run `check` in CI after installing Node 22:

```yaml
- name: Set up Node
  uses: actions/setup-node@v4
  with:
    node-version: 22
- name: Check the plan
  run: node docs/codeplan/codeplan.mjs check
```

Exit code 1 means the plan file or page is out of date with the code: run
`update`, fix the lists, and commit. Exit code 2 means the config or plan
file cannot be used, or the plan file has an error; read the error lines.

## Moving to a new version of codeplan.mjs

Copy the new `codeplan.mjs` over `docs/codeplan/codeplan.mjs`, run `update`,
then `check`, and commit both the tool and the page. A new version may draw
the page differently, so until `update` runs, `check` reports the page as out
of date even when the plan file and the code did not change.

```sh
cp "${CLAUDE_SKILL_DIR}/codeplan.mjs" docs/codeplan/codeplan.mjs
node docs/codeplan/codeplan.mjs update
node docs/codeplan/codeplan.mjs check
```
