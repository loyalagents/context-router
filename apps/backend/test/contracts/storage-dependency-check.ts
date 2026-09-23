import ts from "typescript";

/** Walk imports/re-exports as syntax, including type-only edges and literal import()/require(). */
export function storageDependencyViolations(
  roots: string[],
  read: (file: string) => string | undefined,
  resolve: (specifier: string, from: string) => string | undefined,
): string[] {
  const failures: string[] = [];
  const visited = new Set<string>();
  const forbidden = (value: string) =>
    /(?:^pg(?:-|\/|$)|^@prisma\/|\/node_modules\/(?:pg(?:-|\/|$)|@types\/pg(?:\/|$)|@prisma\/)|(?:^|\/)generated\/prisma(?:\/|$)|(?:^|\/)infrastructure\/(?:prisma|storage)(?:\/|$))/.test(
      value,
    );
  const visit = (file: string, trail: string[]) => {
    if (visited.has(file)) return;
    visited.add(file);
    const text = read(file);
    if (text === undefined) return;
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
    );
    const edge = (specifier: string) => {
      const target = resolve(specifier, file);
      if (forbidden(specifier) || (target && forbidden(target))) {
        failures.push([...trail, file, specifier].join(" -> "));
      } else if (target && !target.includes("/node_modules/")) {
        visit(target, [...trail, file]);
      }
    };
    const walk = (node: ts.Node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        edge(node.moduleSpecifier.text);
      if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression &&
        ts.isStringLiteral(node.moduleReference.expression)
      )
        edge(node.moduleReference.expression.text);
      if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal)
      )
        edge(node.argument.literal.text);
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require") ||
          (ts.isPropertyAccessExpression(node.expression) &&
            ts.isIdentifier(node.expression.expression) &&
            node.expression.expression.text === "module" &&
            node.expression.name.text === "require"))
      ) {
        if (
          node.arguments.length === 1 &&
          ts.isStringLiteralLike(node.arguments[0])
        )
          edge(node.arguments[0].text);
        else
          failures.push(
            [...trail, file, "uninspectable module loader"].join(" -> "),
          );
      }
      ts.forEachChild(node, walk);
    };
    walk(source);
  };
  roots.forEach((root) => visit(root, []));
  return failures;
}
