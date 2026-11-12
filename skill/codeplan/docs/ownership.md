# Which part owns a file

Every file in the watch set (see [config](config.md)) is given to at most
one part. The parts own files through the globs in their `paths`.

## Pattern strength

The strength of a glob is the number of characters before its first
wildcard (`*`, `?`, `{`, or a `[` that opens a set). A set with one
character counts as that one character. `src/**` has strength 4;
`src/pay/**` has strength 8.

## The owner of a file

For each watched file, codeplan collects every (part, pattern) that matches
it.

- No match: the file is an **orphan**.
- The strongest matches all belong to one part: that part owns the file. Its
  file count goes up by one and its line count by the file's lines.
- The strongest matches belong to two or more parts: the file is
  **contested**. So that counts are always the same, it is counted in the
  part whose `id` comes first in code-unit order.

Two patterns of the same part never contest each other.

## Unwatched files

codeplan also looks at the whole repository for files with a code
extension and for mapper XML files. `.git` and the dependency directories
are not entered, and build-output names are skipped outside the source
roots. Such a file that is not in the watch set, and not left out by
`skip`, `home` or (with `tests` off) a test pattern, is **unwatched**: code
that the plan cannot see. XML files that are not mapper XML are not looked
at.

## Line counts

The line count of a file is the number of line feeds in it, plus one when
the last line does not end with a line feed. An empty file has 0 lines. A
CRLF line end counts once.

## What is read

codeplan reads the files on disk, not the list git tracks. Symbolic links
are not followed (neither to files nor to directories). Names that start
with a dot are left out of the default watch and of the search for
unwatched files.

## Orphan, contested and unwatched in `check`

Each of the three lists makes `check` exit with 1. Each list comes with a
line saying how to fix it:

- orphans: add a pattern to a part's `paths`, or name the files in `skip`;
- contested: give one part a pattern with a longer fixed prefix, or remove
  the overlap;
- unwatched: add a pattern for them to `watch`, or to `skip`.

A list longer than 30 shows the first 30 and the number of the rest.
