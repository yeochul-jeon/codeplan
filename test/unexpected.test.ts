// Exit code 3: an error that no rule expected. And a --repo path that
// cannot be looked at.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { main, run } from "../src/cli.js";
import { tempDir } from "./helpers.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = join(root, "skill/codeplan/codeplan.mjs");
const thrower = (value: unknown) => () => {
  throw value;
};
const cwd = () => "/nowhere";

describe("main", () => {
  test("a command that throws: exit 3, nothing on standard output, one line", () => {
    const out = main(["check"], cwd, {}, thrower(new Error("it broke")));
    expect(out).toEqual({ code: 3, stdout: "", stderr: "codeplan: unexpected error: it broke\n" });
  });

  test("with CODEPLAN_STACK, the stack follows; empty or missing, it does not", () => {
    const error = new Error("it broke");
    const out = main(["check"], cwd, { CODEPLAN_STACK: "1" }, thrower(error));
    expect(out.stderr).toBe(`codeplan: unexpected error: it broke\n${error.stack}\n`);
    expect(main(["check"], cwd, { CODEPLAN_STACK: "" }, thrower(error)).stderr).toBe("codeplan: unexpected error: it broke\n");
    expect(main(["check"], cwd, {}, thrower(error)).stderr).toBe("codeplan: unexpected error: it broke\n");
    // A value with no string stack: nothing more.
    expect(main(["check"], cwd, { CODEPLAN_STACK: "1" }, thrower("text")).stderr).toBe("codeplan: unexpected error: text\n");
    expect(main(["check"], cwd, { CODEPLAN_STACK: "1" }, thrower(null)).stderr).toBe("codeplan: unexpected error: null\n");
  });

  test("values that are not an Error, and a message that is not a string", () => {
    const text = (value: unknown) => main([], cwd, {}, thrower(value)).stderr;
    expect(text("plain")).toBe("codeplan: unexpected error: plain\n");
    expect(text(42)).toBe("codeplan: unexpected error: 42\n");
    expect(text(undefined)).toBe("codeplan: unexpected error: undefined\n");
    expect(text({ toString: () => "an object" })).toBe("codeplan: unexpected error: an object\n");
    const odd = new Error("x");
    Object.defineProperty(odd, "message", { value: 7 });
    expect(text(odd)).toBe(`codeplan: unexpected error: ${String(odd)}\n`);
    // The text cannot be made: it is empty.
    const bad = {
      toString() {
        throw new Error("no text");
      },
    };
    expect(main([], cwd, {}, thrower(bad))).toEqual({ code: 3, stdout: "", stderr: "codeplan: unexpected error: \n" });
    expect(text(Object.create(null))).toBe("codeplan: unexpected error: \n");
  });

  test("control characters become one space each", () => {
    const text = (message: string) => main([], cwd, {}, thrower(new Error(message))).stderr;
    expect(text("a\r\nb")).toBe("codeplan: unexpected error: a  b\n");
    expect(text("a\u0000b\u001fc\u007fd\u0085e f g\th")).toBe("codeplan: unexpected error: a b c d e f g h\n");
    expect(text("é ü ")).toBe("codeplan: unexpected error: é ü \n");
  });

  test("reading the working directory is inside: a throw there is exit 3", () => {
    const out = main(["help"], thrower(new Error("no cwd")), {});
    expect(out).toEqual({ code: 3, stdout: "", stderr: "codeplan: unexpected error: no cwd\n" });
  });

  test("a command that does not throw is passed through", () => {
    expect(main(["help"], () => root, {})).toEqual(run(["help"], root));
    expect(main(["nope"], () => root, {}).code).toBe(2);
  });
});

describe("the bundle", () => {
  test("in a working directory that was removed: exit 3 and one line", () => {
    const parent = tempDir();
    const out = spawnSync("sh", ["-c", 'mkdir gone && cd gone && rmdir ../gone && exec "$0" "$1" check', process.execPath, bundle], {
      cwd: parent,
      encoding: "utf8",
      env: { ...process.env, CODEPLAN_STACK: "" },
    });
    expect(out.status, out.stderr).toBe(3);
    expect(out.stdout).toBe("");
    expect(out.stderr).toMatch(/^codeplan: unexpected error: [^\n]*uv_cwd\n$/);
  });
});

describe("a --repo path that cannot be looked at", () => {
  const locked: string[] = [];
  afterEach(() => {
    while (locked.length > 0) chmodSync(locked.pop()!, 0o755);
  });

  test("a name too long: exit 2 and the repository line", () => {
    const repo = join(tempDir(), "x".repeat(300));
    expect(run(["check", "--repo", repo], root)).toEqual({ code: 2, stdout: "", stderr: `codeplan: repository not found: ${repo}\n` });
    expect(run(["stamps", "--repo", repo], root).code).toBe(2);
  });

  test("no permission to look: exit 2 and the repository line", () => {
    const dir = join(tempDir(), "closed");
    mkdirSync(join(dir, "repo"), { recursive: true });
    chmodSync(dir, 0o000);
    locked.push(dir);
    const repo = join(dir, "repo");
    expect(run(["check", "--repo", repo], root)).toEqual({ code: 2, stdout: "", stderr: `codeplan: repository not found: ${repo}\n` });
  });

  test("the records directory of history too", () => {
    const dir = join(tempDir(), "y".repeat(300));
    expect(run(["history", dir], root)).toEqual({ code: 2, stdout: "", stderr: `codeplan: records directory not found: ${dir}\n` });
  });
});
