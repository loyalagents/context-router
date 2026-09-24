import ts from "typescript";

/** Walk imports/re-exports as syntax, including type-only edges and literal import()/require(). */
export function storageDependencyViolations(
  roots: string[],
  read: (file: string) => string | undefined,
  resolve: (specifier: string, from: string) => string | undefined,
  internalPathPatterns: readonly string[] = [],
): string[] {
  const failures: string[] = [];
  const visited = new Set<string>();
  const isInternal = (specifier: string) =>
    /^(?:\.{1,2}(?:[/\\]|$)|[/\\]|[A-Za-z]:[/\\])/.test(specifier) ||
    internalPathPatterns.some((pattern) => {
      const star = pattern.indexOf("*");
      if (star === -1) return specifier === pattern;
      const prefix = pattern.slice(0, star);
      const suffix = pattern.slice(star + 1);
      return (
        specifier.length >= prefix.length + suffix.length &&
        specifier.startsWith(prefix) &&
        specifier.endsWith(suffix)
      );
    });
  const capability = (specifier: string): string | undefined =>
    specifier === "module" || specifier === "node:module"
      ? "createRequire"
      : specifier === "process" || specifier === "node:process"
        ? "getBuiltinModule"
        : undefined;
  const isLoader = (node: ts.Expression) =>
    node.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(node) && node.text === "require") ||
    (ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "module" &&
      node.name.text === "require");
  const forbidden = (value: string) =>
    /(?:^node:sqlite$|^pg(?:-|\/|$)|^@prisma\/|\/node_modules\/(?:pg(?:-|\/|$)|@types\/pg(?:\/|$)|@prisma\/)|(?:^|\/)generated\/prisma(?:\/|$)|(?:^|\/)infrastructure\/(?:prisma|storage)(?:\/|$))/.test(
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
    const fail = (reason: string) =>
      failures.push([...trail, file, reason].join(" -> "));
    const moduleBindings = new Map<string, string>([
      ["process", "getBuiltinModule"],
    ]);
    const isModuleLoad = (node: ts.Expression): string | undefined | false => {
      if (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node))
        return isModuleLoad(node.expression);
      return (
        ts.isCallExpression(node) &&
        isLoader(node.expression) &&
        node.arguments.length === 1 &&
        ts.isStringLiteralLike(node.arguments[0]) &&
        capability(node.arguments[0].text)
      );
    };
    const isModuleObject = (
      node: ts.Expression,
    ): string | undefined | false => {
      if (ts.isParenthesizedExpression(node))
        return isModuleObject(node.expression);
      return (
        (ts.isIdentifier(node) && moduleBindings.get(node.text)) ||
        isModuleLoad(node)
      );
    };
    // Bound syntax only: prohibit obtaining loader capabilities, not arbitrary returned-function dataflow.
    const bindings = (node: ts.Node) => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        capability((node.moduleSpecifier as ts.StringLiteral).text)
      ) {
        const clause = node.importClause;
        if (clause?.name)
          moduleBindings.set(
            clause.name.text,
            capability((node.moduleSpecifier as ts.StringLiteral).text),
          );
        if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings))
          moduleBindings.set(
            clause.namedBindings.name.text,
            capability((node.moduleSpecifier as ts.StringLiteral).text),
          );
      }
      if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression &&
        ts.isStringLiteral(node.moduleReference.expression) &&
        capability(node.moduleReference.expression.text)
      )
        moduleBindings.set(
          node.name.text,
          capability(node.moduleReference.expression.text),
        );
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        isModuleLoad(node.initializer)
      )
        moduleBindings.set(
          node.name.text,
          isModuleLoad(node.initializer) as string,
        );
      ts.forEachChild(node, bindings);
    };
    bindings(source);
    const edge = (specifier: string) => {
      const target = resolve(specifier, file);
      if (forbidden(specifier) || (target && forbidden(target))) {
        fail(specifier);
      } else if (!target && isInternal(specifier)) {
        fail(`unresolved internal import: ${specifier}`);
      } else if (target && !target.includes("/node_modules/")) {
        visit(target, [...trail, file]);
      }
    };
    const walk = (node: ts.Node) => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        capability((node.moduleSpecifier as ts.StringLiteral).text)
      ) {
        const named = node.importClause?.namedBindings;
        if (
          named &&
          ts.isNamedImports(named) &&
          named.elements.some(
            (item) =>
              (item.propertyName ?? item.name).text ===
              capability((node.moduleSpecifier as ts.StringLiteral).text),
          )
        )
          fail(
            `${capability((node.moduleSpecifier as ts.StringLiteral).text)} capability`,
          );
      }
      if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        capability((node.moduleSpecifier as ts.StringLiteral).text)
      ) {
        const clause = node.exportClause;
        if (
          !clause ||
          ts.isNamespaceExport(clause) ||
          clause.elements.some(
            (item) =>
              (item.propertyName ?? item.name).text ===
              capability((node.moduleSpecifier as ts.StringLiteral).text),
          )
        )
          fail(
            `${capability((node.moduleSpecifier as ts.StringLiteral).text)} capability`,
          );
      }
      if (
        (ts.isPropertyAccessExpression(node) ||
          ts.isElementAccessExpression(node)) &&
        isModuleObject(node.expression)
      ) {
        const name = ts.isPropertyAccessExpression(node)
          ? node.name.text
          : node.argumentExpression &&
              ts.isStringLiteralLike(node.argumentExpression)
            ? node.argumentExpression.text
            : undefined;
        if (name === isModuleObject(node.expression))
          fail(`${name} capability`);
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isObjectBindingPattern(node.name) &&
        node.initializer &&
        isModuleObject(node.initializer) &&
        node.name.elements.some((item) => {
          const name = item.propertyName ?? item.name;
          return (
            (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) &&
            name.text === isModuleObject(node.initializer)
          );
        })
      )
        fail(`${isModuleObject(node.initializer)} capability`);
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
      if (ts.isCallExpression(node) && isLoader(node.expression)) {
        if (
          node.arguments.length === 1 &&
          ts.isStringLiteralLike(node.arguments[0])
        )
          edge(node.arguments[0].text);
        else fail("uninspectable module loader");
      }
      ts.forEachChild(node, walk);
    };
    walk(source);
  };
  roots.forEach((root) => visit(root, []));
  return failures;
}
