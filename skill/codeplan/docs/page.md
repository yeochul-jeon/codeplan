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
  and the file count. A planned part has a dashed border, and its third
  line is the word `planned`. The name is in bold. The line count, the
  file count and `planned` are in the dim text colour, and so is the second
  line of an external's label. A name too wide for the
  label takes two lines, split after a space, `-`, `_`, `/` or `.` where
  one fits; that part's label has four lines and its rectangle is one line
  higher. A name wider than two lines is cut at the end of the second.
- A frame for each `zone`, with its name, around the zone's parts. Each
  frame has a pale colour of its own: the zones take six colours in the
  order they first come in the plan's parts, and the seventh zone takes the
  first colour again. A list under the picture shows each zone's colour and
  name. The colours tell zones apart and nothing else; a highlight is a
  border.
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

The size of a part's rectangle comes from the part's id, name, zone and
counts alone. Where the rectangles are also comes from the order of the
parts and, when the plan draws lines, from its `uses`, externals and
scenarios: the gaps between the rectangles open to make room for the lines,
and the zone frames grow with them. So changing `uses`, externals or
scenarios can move a part but does not change its size; changing tasks
moves nothing. Text from the plan file is always shown as text, never as
HTML.

## Lines

The lines keep these rules, so that each one can be followed from its start
to its finish:

- Every line starts and finishes on the bottom side of a rectangle. The
  one exception: when the rectangle at one end of a line is in the row right
  below the rectangle at its other end, that end can be on the top side of
  the lower rectangle. A line does not go through a rectangle or along a
  side of one. It may cross a zone frame.
- Two lines run together only when both are use lines or both are
  connectors, and they start at the same rectangle or finish at the same
  rectangle. Lines that start at one rectangle run together from their
  first point until they separate. Lines that finish at one rectangle run
  together from the point where they meet to their last point. One line can
  run together with a line at its start and with another line at its
  finish.
- After two lines separate they do not run together again.
- A use line and a connector never run together. The two lines of parts
  that use each other never run together. Two connectors between the same
  two places, in the same direction, have the same points.
- Where two lines that do not run together go the same way, they are 8 or
  more apart. They may cross or touch at one point.
- On a rectangle, the ends of lines are 8 or more apart, except the ends of
  lines that run together there.

## Tasks

When the plan has tasks, the page lists them under the picture, above the
scenario controls. Tasks that are `todo` or `doing` come first, in plan file
order. The `done` tasks follow in one list that starts closed, titled
`Done (<k>)` with their number.

A task is one row, read from the left: its name (or the id when the name is
empty), its status as written (`todo`, `doing` or `done`), and, when the
task has paths in `makes`, `<n> of <m> files` with a bar. The bar is filled
in proportion to n out of m: the share of the task's files that are in the
repository. A status has no colour of its own; the word says it.

A row is a button. Choosing it highlights the task's parts: the parts named
in its `parts`, and the parts that own a file of its `makes`. Other parts
stay as they are, and no line or external is highlighted. The files of `makes`
that are not in the repository are listed under the rows. When the task is
in the `done` list, that list opens. Choosing the same row again, or Esc,
ends it.

A chosen task and a scenario walk-through end each other: choosing a task
sets the select box back to `(none)`, and choosing a scenario ends the task.

The address carries the task: `#task=<id>`. When the fragment has a
`scenario` key, the scenario opens and `task` is not read. An unknown task
id is ignored.

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
line. When the rectangle of the step is outside the frame of the picture,
the frame scrolls to it at once (see [Zooming and moving](#zooming-and-moving)).

The address carries the place: `#scenario=<id>&step=<k>` (k starts at 1)
opens that step, and changing it later opens the new place. A `step` that
is missing or not a whole number from 1 to the number of steps opens step
1. An unknown scenario id is ignored. Choosing in the select box or moving
replaces the address fragment without adding to the browser history; Esc
removes it.

## The raised picture

The page holds two pictures of the same plan: the plane picture described
above and the raised picture. A picture button above the picture shows one
or the other. Its text is the name of the picture that is not showing:
`raised` or `plane`. The page opens with the plane picture.

In the raised picture each part is a raised rectangle:

- It stands on a rectangle of the same size as the part's rectangle in the
  plane picture.
- Its height comes from the part's line count: the more lines, the higher.
  A planned part and a part with no lines have the lowest height.
- You see its top and two of its sides. The label is on the top and has the
  same lines as in the plane picture, a long name on two lines too. A
  planned part has dashed lines.

An external is a flat rectangle with its label. A zone is a line around the
rectangles its parts stand on, filled with the zone's colour from the plane
picture, with the zone's name inside the line. No raised rectangle covers
another one or a label.

The raised picture has no lines for uses, no connectors and no highlight.
Where its shapes are comes from the parts, their counts and the externals
alone, so changing `uses`, scenarios or tasks does not change it. The places
are not the places of the plane picture.

Showing the raised picture ends an open walk-through and a chosen task.
Choosing a scenario or a task while the raised picture shows goes to the
plane picture and opens it there. No shape in the raised picture reacts to
the pointer or a key, and Esc does nothing while it shows. Zooming and
moving work as in the plane picture. The list of zones stays under the
picture.

The address carries the picture: `#picture=raised` opens the page with the
raised picture. A fragment with a `scenario` or `task` key opens the plane
picture, whatever `picture` says. The button replaces the fragment without
adding to the browser history, and going to the plane picture removes it.

## Zooming and moving

The picture sits in a frame as wide as the page. It opens as wide as the
frame, at most twice its drawn size, with its top left corner in view. The
frame is as high as the picture, at most 80% of the window; the rest of a
tall picture is below and comes into view by scrolling the frame.

Four buttons above the picture change what the frame shows:

- `+` and `−` zoom in and out by 1.25 around the middle of the frame, from
  the size that shows the whole picture up to four times the drawn size;
- `fit` shows the whole picture;
- `width` goes back to the size the page opened with.

The keys `+` (or `=`), `-` and `0` do what `+`, `−` and `fit` do, wherever
the focus is except on the scenario select box. With Alt, Ctrl or Meta they
are left to the browser, so Ctrl and `+` still zoom the whole page.

Ctrl or Cmd with the mouse wheel zooms around the pointer, and so does a
pinch on a trackpad; the page itself does not zoom then. Safari may not
pass a pinch to the page this way; there a pinch zooms the whole page.

The wheel alone and a swipe on a trackpad scroll the frame; when the frame
cannot go further that way, the page scrolls. A drag with the mouse moves
the picture once the pointer has moved 4 pixels. Text in the picture cannot
be selected.

Showing the other picture, and a change of the window width, open the
picture as it opened at first; a change of the window height alone does
not. When a step of a walk-through is outside the frame, the frame scrolls
once: by the least that brings the step's rectangle 16 pixels inside, or,
when the rectangle is too large for that, to put it in the middle, or its
left and top sides at the left and top of the frame. The view is not kept:
the address, the browser history and the page file do not change, and the
page opens afresh each time.

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
| `--cp-text` | the names in labels and the step text |
| `--cp-text-dim` | the lines of counts in labels, the word `external` in labels, the lines below the picture, the filled length of a task's bar, the list of a task's files that are not there |
| `--cp-part-fill` | part rectangles, the tops of raised rectangles |
| `--cp-part-line` | part rectangle borders |
| `--cp-ext-fill` | external rectangles |
| `--cp-ext-line` | external rectangle borders |
| `--cp-zone-fill` | nothing on the page; it is still defined |
| `--cp-zone-line` | zone frame borders |
| `--cp-zone-title` | zone names |
| `--cp-part-side` | the sides of raised rectangles |
| `--cp-edge` | lines for uses and their arrows |
| `--cp-connector` | connectors |
| `--cp-active` | highlighted borders and lines, the border of a chosen task |
| `--cp-control-fill` | buttons and the select box |
| `--cp-control-line` | their borders, the box of a task's bar |
| `--cp-control-text` | their text |
| `--cp-zone-1` | zone frames and their marks in the list of zones, first colour |
| `--cp-zone-2` | second zone colour |
| `--cp-zone-3` | third zone colour |
| `--cp-zone-4` | fourth zone colour |
| `--cp-zone-5` | fifth zone colour |
| `--cp-zone-6` | sixth zone colour |

In both themes, text has a contrast of at least 4.5:1 with its background
and lines at least 3:1, also on each zone colour. The zone colours are at
least 40 degrees apart in hue.

## When the page is out of date

`check` compares the page byte for byte with what `update` would write now,
and reports it as out of date when they differ or when the page is missing.
That happens when the plan file or the code changed, and also when a new
`codeplan.mjs` draws pages differently: run `update` again. The page holds
no time, absolute path, host name or repository directory name, so the same
input gives the same bytes on any machine. That is why the page is
committed and checked in CI.
