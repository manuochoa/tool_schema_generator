import fs from "fs";
import ts from "typescript";

/**
 * Whitelist of valid JS types you'd like to allow.
 * You can expand this list with e.g. "object", "array", "any", etc.
 */
const JSON_SCHEMA_TYPES = new Set([
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "null",
]);

/**
 * Schema interface you want to produce.
 */
export interface ParsedAnnotation {
  notice: string;
  params: {
    name: string;
    description: string;
    type: string; // "string", "number", etc. or "string" for enum
    enum?: string[]; // Only present if it's an enum type
  }[];
  functionName: string;
}

interface ParsedParam {
  name: string;
  description: string;
  type: string; // e.g. "string", "number", "boolean", "any", etc.
  enum?: string[]; // Only present if it's an enum type
}

/**
 * Entry point for parsing either TS or JS files.
 */
export function parseAnnotations(filePath: string): ParsedAnnotation[] {
  return filePath.endsWith(".ts")
    ? parseTsAnnotations(filePath)
    : parseJsAnnotations(fs.readFileSync(filePath, "utf-8"));
}

/**
/**
 * -------------------- JS PARSER (strict) --------------------
 * Plain JS files rely on "@param <type> <name> <desc>" lines.
 */
export function parseJsAnnotations(content: string): ParsedAnnotation[] {
  const annotationRegex = /\/\*\*(.*?)\*\//gs;
  let match: RegExpExecArray | null;
  const annotations: ParsedAnnotation[] = [];

  while ((match = annotationRegex.exec(content)) !== null) {
    const docBlockText = match[1].trim();

    // The end of this doc block in the file
    const docBlockEndIndex = annotationRegex.lastIndex;

    // Now parse the doc block for e.g. @notice, @param lines, etc.
    const { notice, params } = parseDocBlock(docBlockText);

    // Next, find the function name that appears *after* this doc block
    // so we slice from docBlockEndIndex onward
    const remainingContent = content.slice(docBlockEndIndex);
    const fnName = findNextFunctionName(remainingContent); // see below

    annotations.push({
      notice,
      params,
      functionName: fnName,
    });
  }

  return annotations;
}

function parseDocBlock(block: string): {
  notice: string;
  params: ParsedParam[];
} {
  // 1) Extract @notice
  const notice = /@notice (.+)/.exec(block)?.[1] || "";

  // 2) Grab lines with "@param ..." (in any form)
  //    We'll do a simpler approach: find lines containing "@param "
  const rawParamLines = [...block.matchAll(/@param\s+([^\r\n]+)/g)];

  // 3) Convert each line into a param object
  const params = rawParamLines.map(([, rest]) => {
    // Check if it matches the enum pattern first:
    //  e.g. "@param enum color [red, green, blue] This is the color"
    const enumMatch = rest.match(/^enum\s+(\w+)\s*\[([^\]]+)\]\s*(.*)$/);
    if (enumMatch) {
      const [, paramName, bracketedList, desc] = enumMatch;
      // parse bracketedList => "red, green, blue"
      const enumValues = bracketedList
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean); // remove empty entries

      // check if the enums are number, if not use type string
      const isNumber = enumValues.every((val) => !isNaN(Number(val)));
      const type = isNumber ? "number" : "string";

      // Return an object with "type": "string", plus "enum": [...]
      return {
        name: paramName,
        description: desc.trim(),
        type, // base JSON type
        enum: enumValues, // allowed string values
      };
    }

    // Otherwise, check if it's the normal pattern: "<type> <name> <description...>"
    // e.g. "string userName This is the user name param"
    const normalMatch = rest.match(/^(\w+)\s+(\w+)\s+(.+)/);
    if (normalMatch) {
      const [, type, paramName, desc] = normalMatch;

      // Validate the type
      // Check the type is in our whitelist:
      if (!JSON_SCHEMA_TYPES.has(type)) {
        throw new Error(
          `Invalid @param type '${type}' for param '${paramName}'. Allowed types: ${[
            ...JSON_SCHEMA_TYPES,
          ].join(", ")}`
        );
      }

      return {
        name: paramName,
        description: desc.trim(),
        type, // e.g. "string", "number", "boolean", etc.
      };
    }

    // If neither pattern matched => invalid line
    throw new Error(
      `Invalid @param usage:\n@param ${rest}\n` +
        `Must be either "@param enum <paramName> [val1, val2] desc" or "@param <type> <paramName> desc"`
    );
  });

  return { notice, params };
}

/**
 * Attempt to detect function name from these patterns:
 * 1) function functionName(...)
 * 2) async function functionName(...)
 * 3) const functionName = (...)
 * 4) const functionName = async (...)
 */
function findNextFunctionName(remaining: string): string {
  // We’ll run each pattern in turn; the first match wins, within `remaining`.
  const patterns = [
    // async function functionName(...) {
    /\basync\s+function\s+(\w+)\s*\(/,
    // function functionName(...) {
    /\bfunction\s+(\w+)\s*\(/,
    // const functionName = async (...) =>
    /\bconst\s+(\w+)\s*=\s*async\s*\(/,
    // const functionName = (...) =>
    /\bconst\s+(\w+)\s*=\s*\(/,
  ];

  for (const regex of patterns) {
    const match = regex.exec(remaining);
    if (match) {
      return match[1];
    }
  }
  return "unknown";
}
/**
 * -------------------- TS PARSER --------------------
 * Uses a Program + TypeChecker to get real types from the AST.
 */
function parseTsAnnotations(filePath: string): ParsedAnnotation[] {
  // Create a Program so we can get a TypeChecker
  const program = ts.createProgram([filePath], {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.CommonJS,
    strict: true,
  });
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(filePath);
  if (!sourceFile) {
    throw new Error(`File not found: ${filePath}`);
  }

  const annotations: ParsedAnnotation[] = [];

  /**
   * Recursively visit each node in the AST.
   */
  function visit(node: ts.Node) {
    // 1) Handle classic function declarations
    if (ts.isFunctionDeclaration(node) && node.name && node.parameters) {
      parseFunctionDeclaration(node);
    }
    // 2) Handle variable declarations that might be arrow functions
    else if (ts.isVariableDeclaration(node)) {
      if (node.initializer && ts.isArrowFunction(node.initializer)) {
        parseArrowFunctionVariable(node);
      }
    }

    ts.forEachChild(node, visit);
  }

  /**
   * Parse a classic function declaration (e.g. `export async function foo(...)`)
   */
  function parseFunctionDeclaration(node: ts.FunctionDeclaration) {
    const functionName = node.name?.text || "anonymous";

    // Grab the JSDoc tags for this function
    const jsDocTags = ts.getJSDocTags(node);
    // Find @notice
    const noticeTag = jsDocTags.find((tag) => tag.tagName.text === "notice");
    const notice =
      typeof noticeTag?.comment === "string" ? noticeTag.comment.trim() : "";

    // Gather params info
    const params: Array<{
      name: string;
      type: string;
      description: string;
    }> = [];

    node.parameters.forEach((param) => {
      if (ts.isObjectBindingPattern(param.name)) {
        // Destructured param
        param.name.elements.forEach((element) => {
          if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) {
            const propertyName = element.name.text;
            const propType = getPropertyType(checker, param, propertyName);
            const jsDocParam = findJsDocParam(jsDocTags, propertyName);
            const description = jsDocParam
              ? extractDescriptionFromParamTag(jsDocParam)
              : "";
            params.push({ name: propertyName, type: propType, description });
          }
        });
      } else if (ts.isIdentifier(param.name)) {
        // Standard param
        const paramName = param.name.text;
        let paramType = "any";
        if (param.type) {
          const typeObj = checker.getTypeFromTypeNode(param.type);
          paramType = checker.typeToString(typeObj);
        }
        const jsDocParam = findJsDocParam(jsDocTags, paramName);
        const description = jsDocParam
          ? extractDescriptionFromParamTag(jsDocParam)
          : "";
        params.push({ name: paramName, type: paramType, description });
      }
    });

    annotations.push({ notice, params, functionName });
  }

  /**
   * Parse a variable-declaration arrow function (e.g. `const foo = async(...) => {}`)
   */
  function parseArrowFunctionVariable(node: ts.VariableDeclaration) {
    let functionName = "anonymous";
    if (ts.isIdentifier(node.name)) {
      functionName = node.name.text;
    }

    // Gather JSDoc from the variable declaration
    const jsDocTags = ts.getJSDocTags(node);

    // Look for @notice
    const noticeTag = jsDocTags.find((tag) => tag.tagName.text === "notice");
    const notice =
      typeof noticeTag?.comment === "string" ? noticeTag.comment.trim() : "";

    const arrowFn = node.initializer as ts.ArrowFunction;
    const params: Array<{ name: string; type: string; description: string }> =
      [];

    arrowFn.parameters.forEach((param) => {
      if (ts.isObjectBindingPattern(param.name)) {
        // destructured param
        param.name.elements.forEach((element) => {
          if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) {
            const propertyName = element.name.text;
            const propType = getPropertyType(checker, param, propertyName);
            const jsDocParam = findJsDocParam(jsDocTags, propertyName);
            const description = jsDocParam
              ? extractDescriptionFromParamTag(jsDocParam)
              : "";
            params.push({ name: propertyName, type: propType, description });
          }
        });
      } else if (ts.isIdentifier(param.name)) {
        // normal param
        const paramName = param.name.text;
        let paramType = "any";
        if (param.type) {
          const typeObj = checker.getTypeFromTypeNode(param.type);
          paramType = checker.typeToString(typeObj);
        }
        const jsDocParam = findJsDocParam(jsDocTags, paramName);
        const description = jsDocParam
          ? extractDescriptionFromParamTag(jsDocParam)
          : "";
        params.push({ name: paramName, type: paramType, description });
      }
    });

    annotations.push({ notice, params, functionName });
  }

  visit(sourceFile);
  return annotations;
}

/**
 * For destructured params, e.g. function foo({ userName, token }: { userName: string; token: number })
 */
function getPropertyType(
  checker: ts.TypeChecker,
  param: ts.ParameterDeclaration,
  propertyName: string
): string {
  if (!param.type) return "any";
  const objType = checker.getTypeFromTypeNode(param.type);
  const propSymbol = objType.getProperty(propertyName);
  if (!propSymbol) return "any";

  const decl = propSymbol.valueDeclaration || propSymbol.declarations?.[0];
  if (!decl) return "any";

  const propType = checker.getTypeOfSymbolAtLocation(propSymbol, decl);
  return checker.typeToString(propType);
}

/**
 * Looks for a matching @param tag (which is a ts.JSDocParameterTag).
 */
function findJsDocParam(
  jsDocTags: readonly ts.JSDocTag[],
  paramName: string
): ts.JSDocParameterTag | undefined {
  for (const tag of jsDocTags) {
    if (ts.isJSDocParameterTag(tag)) {
      // e.g. tag.name.text === 'token', tag.comment = 'The token desc...'
      if (ts.isIdentifier(tag.name) && tag.name.text === paramName) {
        return tag;
      }
    }
  }
  return undefined;
}

/**
 * The description is the full tag.comment, e.g. "The token to search for..."
 */
function extractDescriptionFromParamTag(tag: ts.JSDocParameterTag): string {
  if (typeof tag.comment === "string") {
    return tag.comment.trim();
  }
  return "";
}
