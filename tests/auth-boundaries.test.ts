import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

const protectedApp = join(process.cwd(), "app", "(app)");
const publicAuthActions = join(process.cwd(), "app", "login", "actions.ts");

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function firstStatementAfter(source: string, start: number): string {
  const parameterOpen = source.indexOf("(", start);
  if (parameterOpen < 0) return "";
  let depth = 0;
  let parameterClose = -1;
  for (let index = parameterOpen; index < source.length; index += 1) {
    if (source[index] === "(") depth += 1;
    if (source[index] === ")") depth -= 1;
    if (depth === 0) {
      parameterClose = index;
      break;
    }
  }
  if (parameterClose < 0) return "";
  const open = source.indexOf("{", parameterClose + 1);
  if (open < 0) return "";
  return source.slice(open + 1).trimStart();
}

function startsWithUserGuard(source: string, start: number): boolean {
  return /^(?:const\s+\w+\s*=\s*)?await\s+requireUser\(\)\s*;/.test(
    firstStatementAfter(source, start),
  );
}

describe("protected app authentication boundaries", () => {
  const files = filesUnder(protectedApp);

  it("checks the user before each protected page or loading screen does work", () => {
    const pages = files.filter((file) => ["page.tsx", "loading.tsx"].includes(basename(file)));
    expect(pages.length).toBeGreaterThan(0);

    for (const file of pages) {
      const source = readFileSync(file, "utf8");
      const declaration = source.indexOf("export default async function");
      expect(declaration, file).toBeGreaterThanOrEqual(0);
      expect(startsWithUserGuard(source, declaration), file).toBe(true);
    }
  });

  it("checks the user first in every server action and protected route handler", () => {
    const actionAndRouteFiles = [...files, publicAuthActions];
    const protectedFunctions = actionAndRouteFiles.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const isActionFile = source.startsWith('"use server"') || source.startsWith("'use server'");
      const isRouteFile = basename(file) === "route.ts";
      if (!isActionFile && !isRouteFile) return [];

      const declarations = [...source.matchAll(/export\s+async\s+function\s+(\w+)/g)];
      return declarations.flatMap((match) => {
        // Login and one-time setup are public by design; logout and all other actions are protected.
        if (match[1] === "login" || match[1] === "setup") return [];
        return [{ file, source, index: match.index ?? -1 }];
      });
    });

    expect(protectedFunctions.length).toBeGreaterThan(0);
    for (const { file, source, index } of protectedFunctions) {
      expect(startsWithUserGuard(source, index), file).toBe(true);
    }
  });
});
