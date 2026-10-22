import { readdirSync, readFileSync } from "node:fs";
import { relative, join, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const appRoot = join(process.cwd(), "app");
const publicPages = new Set(["login/page.tsx", "setup/page.tsx"]);
const publicActions = new Set(["login/actions.ts:login", "login/actions.ts:setup"]);
const providerAuthenticatedRoutes = new Set(["api/billing/webhook/route.ts"]);

type FunctionBody = { name: string; body: ts.Block };

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function relativeAppPath(file: string): string {
  return relative(appRoot, file).split(sep).join("/");
}

function hasModifier(node: ts.Node, modifier: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((item) => item.kind === modifier);
}

function functionBody(node: ts.Expression | undefined): ts.Block | undefined {
  if (node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node))) return node.body && ts.isBlock(node.body) ? node.body : undefined;
  return undefined;
}

function exportedFunctions(source: ts.SourceFile): FunctionBody[] {
  const functions: FunctionBody[] = [];
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword) && statement.body) {
      functions.push({
        name: hasModifier(statement, ts.SyntaxKind.DefaultKeyword) ? "default" : statement.name?.text ?? "",
        body: statement.body,
      });
    }
    if (!ts.isVariableStatement(statement) || !hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const body = functionBody(declaration.initializer);
      if (body) functions.push({ name: declaration.name.text, body });
    }
  }
  return functions;
}

function callsRequireUser(expression: ts.Expression): boolean {
  if (ts.isAwaitExpression(expression)) return callsRequireUser(expression.expression);
  return ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === "requireUser";
}

function startsWithUserGuard(body: ts.Block): boolean {
  const first = body.statements[0];
  if (!first) return false;
  if (ts.isExpressionStatement(first)) return callsRequireUser(first.expression);
  if (!ts.isVariableStatement(first)) return false;
  return first.declarationList.declarations.some((declaration) => declaration.initializer && callsRequireUser(declaration.initializer));
}

function readSource(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

describe("protected app authentication boundaries", () => {
  const files = filesUnder(appRoot);

  it("checks the user before each protected page, layout, or loading screen does work", () => {
    const protectedSegments = files.filter((file) => {
      const path = relativeAppPath(file);
      return path.startsWith("(app)/") && ["page.tsx", "loading.tsx", "layout.tsx"].includes(file.split(sep).at(-1) ?? "");
    });
    expect(protectedSegments.length).toBeGreaterThan(0);

    for (const file of protectedSegments) {
      if (publicPages.has(relativeAppPath(file))) continue;
      const source = readSource(file);
      const page = exportedFunctions(source).find((item) => item.name === "default");
      expect(page, file).toBeDefined();
      expect(startsWithUserGuard(page!.body), file).toBe(true);
    }
  });

  it("checks the user first in every server action and protected route handler", () => {
    const actionOrRouteFiles = files.filter((file) => {
      const source = readSource(file);
      const first = source.statements[0];
      const isServerAction = !!first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use server";
      return isServerAction || file.split(sep).at(-1) === "route.ts";
    });

    const protectedFunctions = actionOrRouteFiles.flatMap((file) => {
      if (providerAuthenticatedRoutes.has(relativeAppPath(file))) return [];
      return exportedFunctions(readSource(file))
        .filter(({ name }) => !publicActions.has(`${relativeAppPath(file)}:${name}`))
        .map((item) => ({ file, ...item }));
    });

    expect(protectedFunctions.length).toBeGreaterThan(0);
    for (const { file, name, body } of protectedFunctions) {
      expect(startsWithUserGuard(body), `${relativeAppPath(file)}:${name}`).toBe(true);
    }
  });
});
