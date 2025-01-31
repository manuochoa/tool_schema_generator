import ts from "typescript";
import { ParsedAnnotation } from "../types";

/**
 * Determine if a symbol or type is optional:
 *  - check 'SymbolFlags.Optional'
 *  - or if it's a union containing 'undefined'
 */
function isOptionalProp(prop: ts.Symbol, propType: ts.Type): boolean {
  const optionalFlag = Boolean(prop.flags & ts.SymbolFlags.Optional);
  // Check if union includes undefined
  const includesUndefined =
    propType.isUnion() &&
    propType.types.some((t) => Boolean(t.flags & ts.TypeFlags.Undefined));

  return optionalFlag || includesUndefined;
}

/**
 * Remove 'undefined' from a union (e.g. 'string | undefined' => 'string')
 * If multiple non-undefined remain, we keep it as a union (no call to getUnionType).
 */
function removeUndefinedFromUnion(
  type: ts.Type,
  checker: ts.TypeChecker
): ts.Type | null {
  if (!type.isUnion()) return type;

  // Filter out 'undefined' types
  const filtered = type.types.filter(
    (t) => !(t.flags & ts.TypeFlags.Undefined)
  );

  if (filtered.length === 0) {
    // e.g. everything was undefined => fallback
    return checker.getAnyType();
  }
  if (filtered.length === 1) {
    // e.g. string | undefined => string
    return filtered[0];
  }

  // e.g. string | number | undefined => string | number
  // We can't call checker.getUnionType in older TS, so we just build a union type
  // we’ll do a naive approach: if there's more than 1 leftover, keep it as the original union minus undefined
  // so we effectively reconstruct a new union type node if possible, or fallback to the original
  // For older TS versions, we can’t easily create a brand-new union type, so let's:
  // 1) if the count is unchanged (just removed undefined from original), 'type' is effectively that union
  // 2) or fallback to "type" minus the undefined. We'll handle it with your own "isUnion()" logic afterwards.

  // If we removed exactly one type (the undefined) from the union, we can rely on type being a union minus undefined
  // But older TS doesn't easily let us rebuild that union as a new ts.Type. So let's fallback:

  // We'll do: if the length changed, we handle the union with the 'type.types = filtered' approach
  // That also won't compile in older TS if 'types' is readonly. So simpler is to return null and let the caller handle it
  // BUT your code then can't do anything with that. We'll just keep returning null, so you can interpret that as "no rewrite."

  // Easiest approach: Return null and let the caller do normal union logic
  return null;
}

/**
 * -------------------- TS PARSER (with optional fields) --------------------
 */
export function parseTsAnnotations(filePath: string): ParsedAnnotation[] {
  const program = ts.createProgram([filePath], {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.CommonJS,
    strict: true,
  });
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(filePath);
  if (!sourceFile) throw new Error(`File not found: ${filePath}`);

  const annotations: ParsedAnnotation[] = [];

  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name && node.parameters) {
      parseFunctionDeclaration(node);
    } else if (ts.isVariableDeclaration(node)) {
      // arrow function
      if (node.initializer && ts.isArrowFunction(node.initializer)) {
        parseArrowFunctionVariable(node);
      }
    }
    ts.forEachChild(node, visit);
  }

  function parseFunctionDeclaration(node: ts.FunctionDeclaration) {
    const functionName = node.name?.text || "anonymous";
    const jsDocTags = ts.getJSDocTags(node);
    const notice = extractNotice(jsDocTags);
    const params = expandParameters(node.parameters, jsDocTags, checker);
    annotations.push({ notice, functionName, params });
  }

  function parseArrowFunctionVariable(node: ts.VariableDeclaration) {
    let functionName = "anonymous";
    if (ts.isIdentifier(node.name)) {
      functionName = node.name.text;
    }
    const jsDocTags = ts.getJSDocTags(node);
    const notice = extractNotice(jsDocTags);

    const arrowFn = node.initializer as ts.ArrowFunction;
    const params = expandParameters(arrowFn.parameters, jsDocTags, checker);
    annotations.push({ notice, functionName, params });
  }

  visit(sourceFile);
  return annotations;
}

/**
 * Expand each parameter. If destructured => multiple top-level params.
 */
function expandParameters(
  tsParams: readonly ts.ParameterDeclaration[],
  jsDocTags: readonly ts.JSDocTag[],
  checker: ts.TypeChecker
) {
  const result: Array<{
    name: string;
    description: string;
    schema: any;
  }> = [];

  tsParams.forEach((param) => {
    if (ts.isObjectBindingPattern(param.name)) {
      param.name.elements.forEach((element) => {
        if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) {
          const propName = element.name.text;
          const propType = getSubPropertyType(checker, param, propName);

          const jsDocParam = findJsDocParam(jsDocTags, propName);
          const rawComment = jsDocParam?.comment;
          let description = "";
          if (typeof rawComment === "string") {
            description = rawComment.trim();
          }

          const schema = buildJsonSchema(propType, checker);

          result.push({ name: propName, description, schema });
        }
      });
    } else {
      const built = buildParamSchema(param, jsDocTags, checker);
      result.push(built);
    }
  });

  return result;
}

/**
 * Non-destructured param
 */
function buildParamSchema(
  param: ts.ParameterDeclaration,
  jsDocTags: readonly ts.JSDocTag[],
  checker: ts.TypeChecker
): { name: string; description: string; schema: any } {
  let paramName = "anonymousParam";
  if (ts.isIdentifier(param.name)) {
    paramName = param.name.text;
  }

  const jsDocParam = findJsDocParam(jsDocTags, paramName);
  const rawComment = jsDocParam?.comment;
  let description = "";
  if (typeof rawComment === "string") {
    description = rawComment.trim();
  }

  if (!param.type) {
    return {
      name: paramName,
      description,
      schema: { type: "any" },
    };
  }

  const tsType = checker.getTypeFromTypeNode(param.type);
  const schema = buildJsonSchema(tsType, checker);

  return {
    name: paramName,
    description,
    schema,
  };
}

function getSubPropertyType(
  checker: ts.TypeChecker,
  param: ts.ParameterDeclaration,
  propName: string
): ts.Type {
  if (!param.type) {
    return checker.getAnyType();
  }
  const parentType = checker.getTypeFromTypeNode(param.type);
  const propSymbol = parentType.getProperty(propName);
  if (!propSymbol) {
    return checker.getAnyType();
  }
  const decl = propSymbol.valueDeclaration || propSymbol.declarations?.[0];
  if (!decl) {
    return checker.getAnyType();
  }
  return checker.getTypeOfSymbolAtLocation(propSymbol, decl);
}

/**
 * Recursively build a JSON schema for TS type
 * with optional fields support.
 */
function buildJsonSchema(type: ts.Type, checker: ts.TypeChecker): any {
  // Filter out undefined from union => optional
  const withoutUndef = removeUndefinedFromUnion(type, checker);
  if (withoutUndef) {
    type = withoutUndef;
  }

  // String literal => e.g. "hello"
  if (type.isStringLiteral()) {
    return { type: "string", enum: [type.value] };
  }

  // Basic flags
  if (type.flags & ts.TypeFlags.String) return { type: "string" };
  if (type.flags & ts.TypeFlags.Number) return { type: "number" };
  if (type.flags & ts.TypeFlags.Boolean) return { type: "boolean" };

  // Array
  if (checker.isArrayType && checker.isArrayType(type)) {
    const typeRef = type as ts.TypeReference;
    if (typeRef.typeArguments && typeRef.typeArguments.length > 0) {
      const [elemType] = typeRef.typeArguments;
      return {
        type: "array",
        items: buildJsonSchema(elemType, checker),
      };
    }
    return { type: "array", items: { type: "any" } };
  }

  // Object/Interface => gather properties
  if (type.isClassOrInterface() || type.getProperties().length > 0) {
    const props: Record<string, any> = {};
    const required: string[] = [];

    for (const prop of type.getProperties()) {
      const decl = prop.valueDeclaration || prop.declarations?.[0];
      if (!decl) {
        props[prop.name] = { type: "any" };
        continue;
      }
      const propType = checker.getTypeOfSymbolAtLocation(prop, decl);

      // Check if optional
      const optional = isOptionalProp(prop, propType);
      // Build schema for property
      let subSchema = buildJsonSchema(propType, checker);

      props[prop.name] = subSchema;
      if (!optional) {
        required.push(prop.name);
      }
    }

    return {
      type: "object",
      properties: props,
      required,
    };
  }

  // Union => oneOf
  if (type.isUnion()) {
    // Build sub-schemas
    const subSchemas = type.types.map((t) => {
      const sch = buildJsonSchema(t, checker);
      return sch;
    });

    // Filter out any 'any' if we have recognized other more specific sub-schemas.
    // For instance, if subSchemas is [ { type: "any" }, { type: "string" } ],
    // we might prefer just { oneOf: [ { type: "string" } ] } if we know it's purely string/number, etc.
    const nonAny = subSchemas.filter(
      (s) => !(s.type === "any" && Object.keys(s).length === 1)
    );
    if (nonAny.length === 0) {
      // everything was "any"
      return { type: "any" };
    }
    if (nonAny.length === 1) {
      // effectively a single known type
      return nonAny[0];
    }

    // Also check if all are string literals => single enum
    const allStringLits = nonAny.every((v) => v.enum && v.type === "string");
    if (allStringLits) {
      const combinedEnums = nonAny.flatMap((v) => v.enum ?? []);
      return { type: "string", enum: combinedEnums };
    }

    // If we have multiple recognized sub-schemas, do oneOf
    return { oneOf: nonAny };
  }

  // Intersection => allOf
  if (type.isIntersection()) {
    const variants = type.types.map((t) => buildJsonSchema(t, checker));
    return { allOf: variants };
  }

  // Fallback => any
  return { type: "any" };
}

/**
 * Extract @notice text
 */
function extractNotice(jsDocTags: readonly ts.JSDocTag[]): string {
  const tag = jsDocTags.find((t) => t.tagName.text === "notice");
  return typeof tag?.comment === "string" ? tag.comment.trim() : "";
}

/**
 * Find matching @param
 */
function findJsDocParam(
  jsDocTags: readonly ts.JSDocTag[],
  paramName: string
): ts.JSDocParameterTag | undefined {
  for (const tag of jsDocTags) {
    if (ts.isJSDocParameterTag(tag)) {
      if (ts.isIdentifier(tag.name) && tag.name.text === paramName) {
        return tag;
      }
    }
  }
  return undefined;
}
