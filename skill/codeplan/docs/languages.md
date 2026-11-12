# Languages

codeplan counts files for two sets of language rules: `js` and `java`. A
repository uses one or both. Files in other languages are not counted, are
never orphans and are never unwatched.

## How the languages are chosen

When the config file has no `languages` key, codeplan looks at the
repository root:

| File at the root | Language |
|---|---|
| `package.json` | `js` |
| `pom.xml`, `build.gradle` or `build.gradle.kts` | `java` |

Both kinds of file at the root give `["java", "js"]`. With neither, the
language is `js`. A `languages` key in the config file always wins.

## js

| Rule | Value |
|---|---|
| Code extensions | `astro`, `cjs`, `js`, `jsx`, `mjs`, `svelte`, `ts`, `tsx`, `vue` |
| Dependency directory | `node_modules` (never entered, at any depth) |
| Build-output directory names | `dist`, `build`, `.next`, `.nuxt`, `.svelte-kit`, `out`, `coverage` |
| Test patterns | `**/test/**`, `**/tests/**`, `**/__tests__/**`, `**/*.test.*`, `**/*.spec.*` |

The default watch for `js` is every file with a code extension in the
repository, except under `.git`, `node_modules` and the build-output names.
So a js-only repository needs no config file to have no unwatched files.
Config files at the root (such as `vite.config.ts`) and vendored code are
watched too; a part has to own them, or `skip` has to name them.

## java (Java and Kotlin)

| Rule | Value |
|---|---|
| Code extensions | `java`, `kt` |
| Build-output directory names | `target`, `build`, `out`, `.gradle` |
| Source roots | `**/src/main/java`, `**/src/main/kotlin` |
| Test source roots (added when `tests` is `true`) | `**/src/test/java`, `**/src/test/kotlin` |
| Test pattern | `**/src/test/**` |
| Mapper XML | `**/src/main/resources/**/mapper/**/*.xml`, `**/src/main/resources/**/*Mapper.xml` |

The default watch for `java` is the code files under the source roots, plus
the mapper XML files (MyBatis mappers). Java or Kotlin files outside the
source roots are reported as unwatched; add them to `watch` or `skip` in the
config file. Other XML files are not looked at.

A build-output name is skipped only when it comes before the source root in
a path: `src/main/java/org/sample/build/Step.java` is counted (here `build` is a
package), `build/classes/src/main/java/Gen.java` is not.

## Both languages

With both languages, the extensions, dependency directories, build-output
names, mapper patterns and source roots are the union of the two sets.
Test patterns apply only to each language's own extensions: the js pattern
`**/tests/**` does not leave out a Java package named `tests`. Mapper XML
takes only the java test pattern.

## Other languages

Python, Go, Rust, C#, Ruby and the rest are not recognised. In a repository
that has only such code, codeplan counts nothing and `draft` proposes no
parts; it is not the right tool there. In a mixed repository, the files of
other languages are ignored: they are neither in a part nor reported.
