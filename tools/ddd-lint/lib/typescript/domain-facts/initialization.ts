/** Construction guards and the trusted parse wrapper, read from syntax rather than source text. */
import type ts from "typescript";
import type { CompilerApi } from "../compiler/settings.ts";
import type { InitializationFact, Span } from "./contract.ts";

export function constructorInputField(
  api: CompilerApi,
  node: ts.ConstructorDeclaration,
): string | undefined {
  if (
    !node.body ||
    node.body.statements.length !== 1 ||
    node.parameters.length !== 1 ||
    !api.isIdentifier(node.parameters[0].name)
  )
    return undefined;
  const statement = node.body.statements[0];
  if (
    !api.isExpressionStatement(statement) ||
    !api.isBinaryExpression(statement.expression)
  )
    return undefined;
  const { left, right, operatorToken } = statement.expression;
  if (
    operatorToken.kind !== api.SyntaxKind.EqualsToken ||
    !api.isPropertyAccessExpression(left) ||
    left.expression.kind !== api.SyntaxKind.ThisKeyword ||
    !api.isIdentifier(right) ||
    right.text !== node.parameters[0].name.text
  )
    return undefined;
  return left.name.getText();
}

export function initializationFacts(
  api: CompilerApi,
  node: ts.MethodDeclaration,
  file: ts.SourceFile,
  spanOf: (node: ts.Node) => Span,
): InitializationFact | undefined {
  if (!node.body) return undefined;
  const creations: InitializationFact["creations"][number][] = [];
  const input =
    node.parameters.length === 1 && api.isIdentifier(node.parameters[0].name)
      ? node.parameters[0].name.text
      : undefined;
  let guarded = false;
  let modified = false;
  const statements = node.body.statements;
  const unwrap = (expression: ts.Expression): ts.Expression =>
    api.isParenthesizedExpression(expression)
      ? unwrap(expression.expression)
      : expression;
  const objectProperty = (
    expression: ts.Expression,
    name: string,
  ): ts.Expression | undefined => {
    const object = unwrap(expression);
    if (!api.isObjectLiteralExpression(object)) return undefined;
    const property = object.properties.find(
      (entry) =>
        api.isPropertyAssignment(entry) && entry.name.getText(file) === name,
    );
    return property && api.isPropertyAssignment(property)
      ? property.initializer
      : undefined;
  };
  const rejects = (statement: ts.Statement): boolean => {
    if (api.isBlock(statement))
      return (
        statement.statements.length === 1 && rejects(statement.statements[0])
      );
    if (!api.isReturnStatement(statement) || !statement.expression)
      return false;
    return (
      objectProperty(statement.expression, "ok")?.kind ===
      api.SyntaxKind.FalseKeyword
    );
  };
  const mentionsInput = (condition: ts.Expression): boolean => {
    const names = new Set(
      node.parameters.map((parameter) => parameter.name.getText(file)),
    );
    // A local derived from input (e.g. an extracted ID prefix) is still the input being validated.
    for (const statement of statements) {
      if (!api.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!declaration.initializer || !api.isIdentifier(declaration.name))
          continue;
        if (references(declaration.initializer, names))
          names.add(declaration.name.text);
      }
    }
    return references(condition, names, true);
  };
  function references(
    node: ts.Node,
    names: ReadonlySet<string>,
    skipCallbacks = false,
  ): boolean {
    if (
      skipCallbacks &&
      (api.isArrowFunction(node) || api.isFunctionExpression(node))
    )
      return false;
    if (api.isIdentifier(node) && names.has(node.text)) {
      const parent = node.parent;
      if (
        (api.isPropertyAccessExpression(parent) ||
          api.isPropertyAssignment(parent)) &&
        parent.name === node
      )
        return false;
      return true;
    }
    return (
      api.forEachChild(
        node,
        (child) => references(child, names, skipCallbacks) || undefined,
      ) === true
    );
  }
  for (const statement of statements) {
    const visit = (current: ts.Node): void => {
      if (api.isNewExpression(current)) {
        const argument =
          current.arguments?.length === 1
            ? unwrap(current.arguments[0])
            : undefined;
        const sameInput =
          argument && api.isIdentifier(argument) && argument.text === input;
        creations.push({
          type_text: current.expression.getText(file),
          guarded: guarded && !!sameInput,
          span: spanOf(current),
        });
      } else if (api.isObjectLiteralExpression(current)) {
        const parent = current.parent;
        const type = api.isVariableDeclaration(parent)
          ? parent.type
          : api.isAsExpression(parent) ||
              api.isTypeAssertionExpression(parent) ||
              api.isSatisfiesExpression(parent)
            ? parent.type
            : undefined;
        const storage = statements.some(
          (statement) =>
            statement.getEnd() < current.getStart(file) &&
            api.isVariableStatement(statement) &&
            !!(statement.declarationList.flags & api.NodeFlags.Const) &&
            statement.declarationList.declarations.some((declaration) => {
              if (
                !declaration.initializer ||
                !api.isObjectLiteralExpression(declaration.initializer) ||
                declaration.initializer.properties.length !== 1
              )
                return false;
              const property = declaration.initializer.properties[0];
              return (
                api.isIdentifier(declaration.name) &&
                references(current, new Set([declaration.name.text])) &&
                api.isShorthandPropertyAssignment(property) &&
                property.name.text === input
              );
            }),
        );
        if (type)
          creations.push({
            type_text: type.getText(file),
            guarded: guarded && storage,
            span: spanOf(current),
          });
      }
      if (
        api.isBinaryExpression(current) &&
        current.operatorToken.kind >= api.SyntaxKind.FirstAssignment &&
        current.operatorToken.kind <= api.SyntaxKind.LastAssignment
      )
        modified = true;
      if (
        (api.isPrefixUnaryExpression(current) ||
          api.isPostfixUnaryExpression(current)) &&
        [api.SyntaxKind.PlusPlusToken, api.SyntaxKind.MinusMinusToken].includes(
          current.operator,
        )
      )
        modified = true;
      // A later callback does not execute in the factory's validated construction path.
      if (
        api.isFunctionExpression(current) ||
        api.isArrowFunction(current) ||
        api.isMethodDeclaration(current)
      )
        return;
      api.forEachChild(current, visit);
    };
    visit(statement);
    if (
      api.isIfStatement(statement) &&
      !statement.elseStatement &&
      rejects(statement.thenStatement) &&
      mentionsInput(statement.expression)
    )
      guarded = true;
  }
  // of consists of: const parsed = Type.parse(input); if (!parsed.ok) throw …; return parsed.value.
  let parseDelegate: string | undefined;
  if (statements.length === 3 && node.parameters.length === 1) {
    const [binding, rejection, returned] = statements;
    if (
      api.isVariableStatement(binding) &&
      binding.declarationList.flags & api.NodeFlags.Const &&
      binding.declarationList.declarations.length === 1
    ) {
      const declaration = binding.declarationList.declarations[0];
      const call = declaration.initializer && unwrap(declaration.initializer);
      if (
        api.isIdentifier(declaration.name) &&
        call &&
        api.isCallExpression(call) &&
        api.isPropertyAccessExpression(call.expression) &&
        call.expression.name.text === "parse" &&
        call.arguments.length === 1 &&
        call.arguments[0].getText(file) ===
          node.parameters[0].name.getText(file)
      ) {
        const name = declaration.name.text;
        const condition = api.isIfStatement(rejection)
          ? unwrap(rejection.expression)
          : undefined;
        const body = api.isIfStatement(rejection)
          ? rejection.thenStatement
          : undefined;
        const throws =
          body &&
          (api.isThrowStatement(body) ||
            (api.isBlock(body) &&
              body.statements.length === 1 &&
              api.isThrowStatement(body.statements[0])));
        const value =
          api.isReturnStatement(returned) && returned.expression
            ? unwrap(returned.expression)
            : undefined;
        if (
          api.isIfStatement(rejection) &&
          !rejection.elseStatement &&
          condition &&
          api.isPrefixUnaryExpression(condition) &&
          condition.operator === api.SyntaxKind.ExclamationToken &&
          api.isPropertyAccessExpression(condition.operand) &&
          condition.operand.expression.getText(file) === name &&
          condition.operand.name.text === "ok" &&
          throws &&
          value &&
          api.isPropertyAccessExpression(value) &&
          value.expression.getText(file) === name &&
          value.name.text === "value"
        ) {
          parseDelegate = call.expression.expression.getText(file);
        }
      }
    }
  }
  return {
    creations: creations.map((creation) => ({
      ...creation,
      guarded: creation.guarded && !modified,
    })),
    ...(parseDelegate ? { parse_delegate: parseDelegate } : {}),
  };
}
