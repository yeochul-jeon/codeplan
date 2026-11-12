// Glob patterns over repository-relative paths joined with "/".
// Dialect: `*` and `?` stay inside one path segment, `**` as a whole segment
// matches zero or more segments, `[...]` is a character set, `{a,b}` picks one
// alternative. `*`, `?` and `**` do not match a name (file or directory) that
// starts with a dot; write the dot in the pattern (`.storybook/**`) to reach
// one. There is no backslash escape: a set holding one character (`[[]`, `[*]`) is that
// character taken literally. Matching is case-sensitive.

const REGEX_SPECIAL = /[\\^$.|+()[\]{}*?]/g;

function escapeRegex(text: string): string {
  return text.replace(REGEX_SPECIAL, "\\$&");
}

// Index of the `]` that closes the set opened at `start`, or -1.
function closeOfSet(pattern: string, start: number): number {
  return pattern.indexOf("]", start + 2);
}

// Index of the `}` that closes the brace opened at `start`, or -1.
function closeOfBrace(pattern: string, start: number): number {
  let depth = 0;
  for (let i = start; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "[") {
      const end = closeOfSet(pattern, i);
      if (end !== -1) i = end;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitAlternatives(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "[") {
      const end = closeOfSet(body, i);
      if (end !== -1) i = end;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
    } else if (c === "," && depth === 0) {
      parts.push(body.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(body.slice(from));
  return parts;
}

function setToRegex(content: string): string {
  if (content.length === 1) return escapeRegex(content);
  let negate = false;
  let body = content;
  if (body[0] === "!" || body[0] === "^") {
    negate = true;
    body = body.slice(1);
  }
  const inner = body.replace(/[\\\]\[^]/g, "\\$&");
  return negate ? `[^/${inner}]` : `[${inner}]`;
}

// One path segment that does not start with a dot.
const SEGMENT = "(?!\\.)[^/]*";

// `startsSegment`: whether position 0 of `pattern` is the start of a segment.
function toRegexSource(pattern: string, startsSegment = true): string {
  let out = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i]!;
    const atSegmentStart = i === 0 ? startsSegment : pattern[i - 1] === "/";
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        const next = pattern[i + 2];
        if (atSegmentStart && next === "/") {
          out += `(?:${SEGMENT}/)*`;
          i += 3;
          continue;
        }
        if (atSegmentStart && next === undefined) {
          out += `${SEGMENT}(?:/${SEGMENT})*`;
          i += 2;
          continue;
        }
        out += atSegmentStart ? SEGMENT : "[^/]*";
        i += 2;
        continue;
      }
      out += atSegmentStart ? SEGMENT : "[^/]*";
      i++;
    } else if (c === "?") {
      out += atSegmentStart ? "[^/.]" : "[^/]";
      i++;
    } else if (c === "[") {
      const end = closeOfSet(pattern, i);
      if (end === -1) {
        out += escapeRegex(c);
        i++;
      } else {
        out += setToRegex(pattern.slice(i + 1, end));
        i = end + 1;
      }
    } else if (c === "{") {
      const end = closeOfBrace(pattern, i);
      if (end === -1) {
        out += escapeRegex(c);
        i++;
      } else {
        const alternatives = splitAlternatives(pattern.slice(i + 1, end));
        const inner = alternatives.map((a) => toRegexSource(a, atSegmentStart));
        out += `(?:${inner.join("|")})`;
        i = end + 1;
      }
    } else {
      out += escapeRegex(c);
      i++;
    }
  }
  return out;
}

export function compileGlob(pattern: string): RegExp {
  return new RegExp(`^${toRegexSource(pattern)}$`);
}

// The fixed text before the first wildcard (`*`, `?`, `{`, or a `[` that opens
// a set). A set holding one character contributes that character.
export function fixedHead(pattern: string): string {
  let out = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i]!;
    if (c === "*" || c === "?") return out;
    if (c === "{") {
      if (closeOfBrace(pattern, i) !== -1) return out;
    } else if (c === "[") {
      const end = closeOfSet(pattern, i);
      if (end !== -1) {
        if (end !== i + 2) return out;
        out += pattern[i + 1];
        i = end + 1;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

// Ownership ranks patterns by this number: the count of leading characters that are plain text.
export function strength(pattern: string): number {
  return fixedHead(pattern).length;
}

export class GlobSet {
  private readonly regexes: RegExp[];
  constructor(patterns: readonly string[]) {
    this.regexes = patterns.map(compileGlob);
  }
  matches(path: string): boolean {
    return this.regexes.some((r) => r.test(path));
  }
}
