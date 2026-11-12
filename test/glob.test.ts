import { describe, expect, test } from "vitest";
import { compileGlob, fixedHead, strength } from "../src/glob.js";
import { lineTotal } from "../src/lines.js";

const match = (pattern: string, path: string) => compileGlob(pattern).test(path);

describe("glob matching", () => {
  test("* and ? stay inside one segment", () => {
    expect(match("src/*.ts", "src/a.ts")).toBe(true);
    expect(match("src/*.ts", "src/x/a.ts")).toBe(false);
    expect(match("src/?.ts", "src/a.ts")).toBe(true);
    expect(match("src/?.ts", "src/ab.ts")).toBe(false);
  });

  test("** matches zero or more segments", () => {
    expect(match("**/*.ts", "a.ts")).toBe(true);
    expect(match("**/*.ts", "x/y/a.ts")).toBe(true);
    expect(match("src/**", "src/a/b.ts")).toBe(true);
    expect(match("src/**", "srcx/a.ts")).toBe(false);
    expect(match("a/**/b.ts", "a/b.ts")).toBe(true);
    expect(match("a/**/b.ts", "a/x/y/b.ts")).toBe(true);
  });

  test("wildcards do not match names that start with a dot", () => {
    expect(match("**", ".eslintrc.cjs")).toBe(false);
    expect(match("*.cjs", ".eslintrc.cjs")).toBe(false);
    expect(match("?eslintrc.cjs", ".eslintrc.cjs")).toBe(false);
    expect(match("**/*.ts", ".config/a.ts")).toBe(false);
    expect(match("**/*.ts", "a/.config/b.ts")).toBe(false);
    expect(match("src/**", "src/.hidden/a.ts")).toBe(false);
    expect(match("**", "a/b.ts")).toBe(true);
  });

  test("a dot written in the pattern reaches a dot-name", () => {
    expect(match(".storybook/**/*.ts", ".storybook/x/a.ts")).toBe(true);
    expect(match("**/.eslintrc.cjs", "a/.eslintrc.cjs")).toBe(true);
    expect(match("{.config,src}/*.ts", ".config/a.ts")).toBe(true);
    expect(match("a*.ts", "a.b.ts")).toBe(true);
  });

  test("braces pick one alternative", () => {
    expect(match("**/*.{ts,tsx}", "a/b.tsx")).toBe(true);
    expect(match("**/*.{ts,tsx}", "a/b.js")).toBe(false);
    expect(match("{src,lib}/**", "lib/a.ts")).toBe(true);
  });

  test("character sets", () => {
    expect(match("[ab].ts", "a.ts")).toBe(true);
    expect(match("[ab].ts", "c.ts")).toBe(false);
    expect(match("[!ab].ts", "c.ts")).toBe(true);
    expect(match("[a-c].ts", "b.ts")).toBe(true);
  });

  test("a one-character set is that character", () => {
    expect(match("views/[[]slug]/**", "views/[slug]/show.tsx")).toBe(true);
    expect(match("views/[slug]/**", "views/[slug]/show.tsx")).toBe(false);
    expect(match("views/[slug]/**", "views/s/show.tsx")).toBe(true);
    expect(match("x/[(]group)/*", "x/(group)/a.ts")).toBe(true);
    expect(match("[*].ts", "*.ts")).toBe(true);
    expect(match("[*].ts", "a.ts")).toBe(false);
  });

  test("regex metacharacters in literals are plain text", () => {
    expect(match("a+b(c)|d$.ts", "a+b(c)|d$.ts")).toBe(true);
    expect(match("a.ts", "abts")).toBe(false);
  });

  test("case-sensitive", () => {
    expect(match("src/A.ts", "src/a.ts")).toBe(false);
  });
});

describe("pattern strength", () => {
  test("a pattern is as strong as its wildcard-free start is long", () => {
    expect(strength("**")).toBe(0);
    expect(strength("src/**")).toBe(4);
    expect(strength("src/a.ts")).toBe(8);
    expect(strength("src/?.ts")).toBe(4);
    expect(strength("src/{a,b}.ts")).toBe(4);
    expect(strength("src/[ab].ts")).toBe(4);
  });

  test("a one-character set counts as one character", () => {
    expect(fixedHead("views/[[]slug]/**")).toBe("views/[slug]/");
    expect(strength("views/[[]slug]/**")).toBe(13);
    expect(strength("x/[(]group)/*")).toBe(10);
  });
});

describe("line count", () => {
  const lines = (text: string) => lineTotal(Buffer.from(text, "utf8"));
  test("rules", () => {
    expect(lines("")).toBe(0);
    expect(lines("hm")).toBe(1);
    expect(lines("hm\n")).toBe(1);
    expect(lines("up\ndown")).toBe(2);
    expect(lines("up\r\ndown\r\n")).toBe(2);
    expect(lines("\n")).toBe(1);
    expect(lines("\n\n")).toBe(2);
  });
});
