// Reading <home>/plan.json. Its fields are checked in validate.ts.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface PlanPart {
  id: string;
  paths: string[];
}

export type PlanFile =
  | { kind: "missing" }
  | { kind: "not-json"; message: string }
  | { kind: "json"; value: unknown };

export function planPath(home: string): string {
  return `${home}/plan.json`;
}

export function readPlanFile(repo: string, home: string): PlanFile {
  const relative = planPath(home);
  const file = join(repo, relative);
  if (!existsSync(file)) return { kind: "missing" };
  try {
    return { kind: "json", value: JSON.parse(readFileSync(file, "utf8")) };
  } catch (e) {
    return { kind: "not-json", message: `${relative} is not valid JSON: ${(e as Error).message}` };
  }
}
