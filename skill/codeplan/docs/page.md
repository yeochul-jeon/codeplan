# Page

The page is one HTML file, by default `docs/codeplan/codeplan.html`. Open it
in a browser straight from disk (`file://`); it loads nothing from the
network: no outside fonts, scripts or styles.

`update` writes the whole file, and the file is never edited by hand. The
page's first line is `<!doctype html><!-- codeplan page -->`; a file at the
page place that does not start with it is not a codeplan page, and `update`
and `check` refuse to touch it.

## What it draws

- One rectangle for each part, sized by its line count, with a label of
  three lines: the name (or the id when the name is empty), the line count
  and the file count.
- A frame for each `zone`, with its name, around the zone's parts.
- One rectangle for each external, below the parts, labelled with its name
  and the word `external`.
- A line for each use, with an arrow at the part or external that is used.
  A part's repeated use of one target is one line; a use of itself is not
  drawn. When two parts use each other, there are two lines.
- A dashed connector between two steps in a row of a scenario that are at
  different places with no use between them.
- Below the picture: the total file and line counts and the plan's name,
  then a line with the number of orphans and a line with the number of
  unwatched files when there are any.

The layout comes from the parts' ids, names, zones, counts and order alone,
so changing `uses`, externals or scenarios does not move a part. Text from
the plan file is always shown as text, never as HTML.

## Walking through a scenario

When the plan has scenarios, the page has a select box and two buttons
under the picture. The first item of the select box, `(none)`, means no
scenario is open. Choosing a scenario opens its first step:

- the place of the step (a part or external) is highlighted;
- the line from the previous step is highlighted: the use between the two
  places (both, when they use each other), or the connector when there is
  no use;
- the text of the step reads `<k>/<n> <place name>: <does>`, where each
  `{id}` in `does` is replaced by that part's or external's name.

The buttons move to the previous and next step; they cannot be used at the
first and last step. The Left and Right arrow keys do the same, and Esc
closes the walk-through, wherever the focus is except on the select box.
Keys pressed with Alt, Ctrl or Meta are left to the browser. Choosing
`(none)` again also closes it. A scenario with no steps opens with a line
saying so. Nothing moves on its own; a highlight is a colour and a thicker
line.

The address carries the place: `#scenario=<id>&step=<k>` (k starts at 1)
opens that step, and changing it later opens the new place. A `step` that
is missing or not a whole number from 1 to the number of steps opens step
1. An unknown scenario id is ignored. Choosing in the select box or moving
replaces the address fragment without adding to the browser history; Esc
removes it.

## Themes

A theme button above the picture switches between `auto`, `light` and
`dark`. `auto` follows the system setting. The choice is kept in the
browser's local storage under `codeplan-theme`, so it is per browser, not
in the page file. If the storage cannot be used, the page opens in `auto`
and the button still works for that visit.

Every colour on the page is one of these tokens:

| Token | Used for |
|---|---|
| `--cp-bg` | page and picture background |
| `--cp-text` | labels and the step text |
| `--cp-text-dim` | the lines below the picture |
| `--cp-part-fill` | part rectangles |
| `--cp-part-line` | part rectangle borders |
| `--cp-ext-fill` | external rectangles |
| `--cp-ext-line` | external rectangle borders |
| `--cp-zone-fill` | zone frames |
| `--cp-zone-line` | zone frame borders |
| `--cp-zone-title` | zone names |
| `--cp-edge` | lines for uses and their arrows |
| `--cp-connector` | connectors |
| `--cp-active` | highlighted borders and lines |
| `--cp-control-fill` | buttons and the select box |
| `--cp-control-line` | their borders |
| `--cp-control-text` | their text |

In both themes, text has a contrast of at least 4.5:1 with its background
and lines at least 3:1.

## When the page is out of date

`check` compares the page byte for byte with what `update` would write now,
and reports it as out of date when they differ or when the page is missing.
That happens when the plan file or the code changed, and also when a new
`codeplan.mjs` draws pages differently: run `update` again. The page holds
no time, absolute path, host name or repository directory name, so the same
input gives the same bytes on any machine. That is why the page is
committed and checked in CI.
