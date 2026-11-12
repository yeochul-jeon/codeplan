# Diagnostics

`check` checks the plan file and prints one line for each finding, on
standard error:

```text
parts[1].uses[0].to: unknown-target [error] part "cart": "pay" is not a part or external
```

The line is `<at>: <code> [<severity>] <message>`. `at` is the place in the
plan file, with array elements always written by index: `format`,
`parts[2].paths`, `parts[2].paths[0]`, `parts[0].uses[1].to`,
`scenarios[1].steps[0].at`, `externals[3]`, or `plan` for the file as a
whole. The message names the nearest enclosing part, external, scenario or
task by its id. After the lines comes one `fix:` line for each code that appeared.

An `error` makes `check` and `update` exit with 2; `update` then writes no
page. A `warning` makes `check` exit with 1 and does not stop `update`. An
`info` finding only tells: it changes no exit code, it is not counted in the
last line of `check`, and with nothing else to report that line is
`check: ok`. `check` and `summary` print info lines like the others;
`update` prints none.

## Codes

| Code | Severity | Where | When | How to fix it |
|---|---|---|---|---|
| `bad-shape` | error | the field, or the place of a missing field or unknown key | A value has the wrong type or form, a required field is missing, or a key is unknown. | Give the field the type and form in [plan file](plan-file.md), or remove the key. |
| `repeated-id` | error | `id` of the second and later item with the same id | Two parts, externals, scenarios or tasks share an id. | Give each item its own id. |
| `no-paths` | error | `parts[i].paths` | A part has no `paths` or an empty array. | Add at least one glob. |
| `unknown-target` | error | `uses[i].to`, `steps[i].at` or `tasks[i].parts[j]` | The id names no part or external. In a task's `parts`, the id names no part. | Name an existing part or external, or add it. |
| `empty-part` | warning | `parts[i].paths` | The part owns no watched file. Not reported for a planned part (`planned: true`). | Correct its `paths`, or remove the part. |
| `planned-has-files` | warning | `parts[i].planned` | A planned part has one or more watched files counted in it, contested files counted there included. | Remove `planned` now that the part has code. If the files are not its code, correct its `paths`. |
| `start-missing` | warning | `parts[i].start` | The `start` file does not exist, or is not a file (a directory, a symbolic link). Not reported for a planned part. | Point `start` at a file. |
| `start-elsewhere` | warning | `parts[i].start` | The `start` file is in the watch set but another part owns it (or it is an orphan). Files outside the watch set are not checked. | Point `start` at a file this part owns. |
| `self-use` | warning | `uses[i].to` | A part uses itself. | Remove that use. |
| `repeated-use` | warning | `uses[i].to` of the second and later use | One part uses the same target twice. | Keep one. |
| `unused-external` | warning | `externals[i]` | No use and no step names the external. A `{id}` in text does not count. | Name it in a use or a step, or remove it. |
| `short-scenario` | warning | `scenarios[i].steps` | A scenario has fewer than two steps. | Give it two steps or more. |
| `gap-in-scenario` | warning | `steps[i].at` of the later step | Two steps in a row are at different places, and neither uses the other. | Add a use between the two, or a step between them. |
| `unknown-reference` | warning | the text field | A `{id}` in `about`, `why` or `does` names no part or external. One line for each different id, in order. | Write the id of an existing part or external. |
| `no-plan` | warning | `plan` | There is no plan file. Every watched file is an orphan; nothing else is checked. | Create the plan file, for example from `draft`. |
| `task-done-missing` | info | `tasks[i].status` | The task is `done` and one or more files in its `makes` are not in the repository. The message gives the count, such as `1 of 2`. | Make the files, take them out of `makes`, or write the status the task has now. |
| `task-todo-has-files` | info | `tasks[i].status` | The task is `todo` and one or more files in its `makes` are already in the repository. | Nothing has to change. If the files are not what the task makes, correct `makes`. |
| `task-path-unowned` | info | `tasks[i].makes[j]`, where the path is first written | A path in `makes` is not a file yet, and the file would be in the watch set and match no part's `paths`: once made it would be an orphan. Not reported while a part is left out of counting. | Add a pattern for the path to a part's `paths`, or correct the path. |

## Order

The lines follow the order of the plan file format, not the order of keys
in the file: `format`, `name`, `about`, `parts`, `externals`, `scenarios`,
`tasks`;
inside an object, its fields in the order of [plan file](plan-file.md), then
`note`, then unknown keys by name. Array elements go by index. A finding on
an item (such as `externals[3]`) comes before those on its fields, and a
finding on an array (such as `scenarios[0].steps`) before those on its
elements. Findings at the same place go by code name.

## Broken items do not cause more findings

Only the checks that depend on a broken field are skipped:

- An item with a well-formed `id` keeps that id even when other fields are
  broken, so references to it still resolve.
- Inside an item with a `repeated-id`, only `bad-shape` is reported (so no
  `planned-has-files` either). That
  item is left out of counting. While any `repeated-id` exists,
  `unused-external` is not reported, and steps at a repeated part's id are
  not checked for gaps.
- A task with a `repeated-id` is left out of the task lists of the page,
  `summary` and `snapshot`. A task whose `status` is broken gets no
  `task-done-missing` or `task-todo-has-files`; a task whose `makes` is not
  an array gets none of the three task findings.
- A part whose `paths` is missing or broken, or that has no well-formed id,
  is left out of counting and gets no `empty-part`, `start-elsewhere` or
  `planned-has-files`.
- A part whose `uses` is not an array gets no use checks, and steps at that
  part are not checked for gaps. A use that is not an object, or has a
  missing or malformed `to`, gets no use checks. A `to` that is an
  `unknown-target` is still checked for `repeated-use`.
- A scenario whose `steps` is not an array gets no `short-scenario` or
  `gap-in-scenario`. A pair of steps where either `at` is broken or unknown
  is not checked for a gap.
- `unused-external` is not reported while any `uses` or `steps` is not an
  array, or any use or step is broken. Errors in `why`, `does`,
  `evidence` or `note`, and unknown keys, do not count as broken here.

## Incomplete counting

When any part is left out of counting, `check` does not list orphans (they
would be wrong); it prints one line saying that counting is incomplete
instead. Contested and unwatched files are still listed.

## A plan file that is not JSON

A plan file that cannot be read as JSON gives one error line and exit code 2,
with no counts. A plan file whose top level is not an object gives one
`bad-shape` at `plan`; no part is counted, so every watched file is an
orphan.
