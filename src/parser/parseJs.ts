import {
  ParsedAnnotation,
  RawParam,
  ParsedParamSchema,
  JSON_SCHEMA_TYPES,
} from "../types";

/**
 * -------------------- JS PARSER --------------------
 *
 * Supports:
 * - Leading doc text vs @description
 * - Union types "{string|number}"
 * - Optional params via "[paramName]"
 * - @enum with bracketed [val1,val2]
 * - Nesting via @property user.age
 */
export function parseJsAnnotations(content: string): ParsedAnnotation[] {
  const annotationRegex = /\/\*\*(.*?)\*\//gs;
  let match: RegExpExecArray | null;
  const annotations: ParsedAnnotation[] = [];

  while ((match = annotationRegex.exec(content)) !== null) {
    const docBlockText = match[1].trim();
    const docBlockEndIndex = annotationRegex.lastIndex;

    // Check if the doc block or subsequent function is commented out
    const remainingContent = content.slice(docBlockEndIndex).trim();
    const isCommentedOut = /^\s*\/\/.*$/m.test(
      content.slice(docBlockEndIndex - match[0].length, docBlockEndIndex)
    );
    if (isCommentedOut) {
      continue;
    }

    // Parse doc block => docDescription, param lines
    const { finalDescription, rawParams } = parseDocBlock(docBlockText);

    // Find function name in remainder
    const fnName = findNextFunctionName(remainingContent);

    if (fnName === "unknown") {
      continue; // Skip if function name is unknown
    }

    // Convert raw param lines => final param schemas
    const paramSchemas = buildParamSchemas(rawParams);

    annotations.push({
      notice: finalDescription,
      functionName: fnName,
      params: paramSchemas,
    });
  }

  return annotations;
}

/**
 * parseDocBlock:
 *  - Extract leading text for docDescription or find @description
 *  - Parse @param, @property lines
 */
function parseDocBlock(doc: string): {
  finalDescription: string;
  rawParams: RawParam[];
} {
  // 1) Leading text lines => docDescription
  let leadingDescription = extractLeadingDescription(doc);

  // 2) If there's an explicit @description, it might override or merge
  const descMatch = /@description\s+([^\r\n]+)/.exec(doc);
  let explicitDescription = "";
  if (descMatch) {
    explicitDescription = descMatch[1].trim();
  }

  // Decide how to unify them (take explicit if present, else leading)
  const finalDescription = explicitDescription || leadingDescription;

  // 3) parse param/property lines
  const rawParams = parseParamAndPropertyLines(doc);

  return { finalDescription, rawParams };
}

function extractLeadingDescription(doc: string): string {
  const lines = doc.split("\n");
  let desc = "";

  for (let line of lines) {
    // Remove leading "*" and surrounding space: e.g. " * something" => "something"
    line = line.replace(/^\s*\*\s?/, "").trim();

    // If the stripped line now starts with "@", we've hit the first tag => stop
    if (line.startsWith("@")) {
      break;
    }
    if (!line) continue;

    if (desc) desc += " ";
    desc += line;
  }
  return desc;
}

/**
 * parseParamAndPropertyLines:
 * - Detect @param {type} [paramName] ...
 * - union types => e.g. {number|boolean}
 * - enum => e.g. {enum} [status] [val1,val2]
 * - @property {type} user.age
 */
function parseParamAndPropertyLines(doc: string): RawParam[] {
  const params: RawParam[] = [];

  // e.g. @param {object} [user] - desc
  // or @param {string|number} param - desc
  // or @param {enum} [status] [active,inactive] - desc
  // or @property {string} user.name
  const paramRegex = /@param\s*\{([^}]+)\}\s+(\[?[^\s]+\]?)\s*(.*)/g;
  const propertyRegex = /@property\s*\{([^}]+)\}\s+(\[?[^\s]+\]?)\s*(.*)/g;

  let m: RegExpExecArray | null;

  // parse @param
  while ((m = paramRegex.exec(doc)) !== null) {
    const rawType = m[1].trim(); // e.g. "object", "enum", "string|number"
    const bracketedName = m[2].trim(); // e.g. "[user]", "param", "[status]"
    let rest = (m[3] || "").trim(); // e.g. "[active,inactive] - desc"

    const { isOptional, actualName } = extractOptionalName(bracketedName);

    // handle union or single type => build final type info
    const typeInfo = parseType(rawType);

    // if it's an enum, parse bracketed [val1,val2]
    if (typeInfo.isEnum) {
      const bracketMatch = /^\[\s*([^\]]+)\]\s*(.*)$/.exec(rest);
      if (bracketMatch) {
        const listStr = bracketMatch[1];
        rest = bracketMatch[2].trim();
        const enumer = listStr.split(",").map((s) => s.trim());
        // if all numeric => "number"
        if (enumer.every((x) => !isNaN(Number(x)))) {
          typeInfo.finalType = "number";
        } else {
          typeInfo.finalType = "string";
        }
        typeInfo.enumValues = enumer;
      }
    }

    // remove leading dash from desc
    rest = rest.replace(/^[-\s]+/, "");

    const rp: RawParam = {
      isProperty: false,
      isEnum: typeInfo.isEnum,
      type: typeInfo.finalType,
      name: actualName,
      description: rest,
      isOptional,
    };
    if (typeInfo.enumValues) {
      rp.enumValues = typeInfo.enumValues;
    }
    if (typeInfo.unionSubTypes) {
      rp.unionSubTypes = typeInfo.unionSubTypes;
    }

    params.push(rp);
  }

  // parse @property
  while ((m = propertyRegex.exec(doc)) !== null) {
    const rawType = m[1].trim();
    const bracketedName = m[2].trim();
    let rest = (m[3] || "").trim();

    const { isOptional, actualName } = extractOptionalName(bracketedName);
    const typeInfo = parseType(rawType);

    rest = rest.replace(/^[-\s]+/, "");

    const rp: RawParam = {
      isProperty: true,
      isEnum: typeInfo.isEnum,
      type: typeInfo.finalType,
      name: actualName,
      description: rest,
      isOptional,
    };
    if (typeInfo.enumValues) {
      rp.enumValues = typeInfo.enumValues;
    }
    if (typeInfo.unionSubTypes) {
      rp.unionSubTypes = typeInfo.unionSubTypes;
    }

    params.push(rp);
  }

  return params;
}

/**
 * Detect optional by brackets, e.g. "[username]" => isOptional=true, actualName="username"
 */
function extractOptionalName(bracketed: string): {
  isOptional: boolean;
  actualName: string;
} {
  let isOptional = false;
  let actualName = bracketed;
  if (actualName.startsWith("[") && actualName.endsWith("]")) {
    isOptional = true;
    actualName = actualName.slice(1, -1).trim(); // remove outer [ ]
  }
  return { isOptional, actualName };
}

/**
 * parseType: detect union "string|number", or "enum", or normal
 * returns finalType, isEnum, unionSubTypes, etc.
 */
function parseType(rawType: string) {
  // e.g. "string|number", "enum", "object"
  let isEnum = false;
  let finalType = rawType.toLowerCase();
  let enumValues: string[] | undefined;
  let unionSubTypes: string[] | undefined;

  // union => e.g. "string|number"
  if (finalType.includes("|")) {
    const subs = finalType.split("|").map((s) => s.trim());
    unionSubTypes = subs;

    // Check if all subtypes are valid
    const invalidSubTypes = subs.filter(
      (subType) => !JSON_SCHEMA_TYPES.includes(subType)
    );
    if (invalidSubTypes.length > 0) {
      throw new Error(
        `Invalid type(s) in union: ${invalidSubTypes.join(
          ", "
        )}. Valid types are: ${JSON_SCHEMA_TYPES.join(", ")}.`
      );
    }

    finalType = "union"; // we'll build "oneOf" later
  } else if (finalType === "enum") {
    isEnum = true;
    finalType = "any"; // refine later if bracket found
  } else {
    // Normal type => validate against JSON_SCHEMA_TYPES
    if (!JSON_SCHEMA_TYPES.includes(finalType)) {
      throw new Error(
        `Invalid type: ${rawType}. Valid types are: ${JSON_SCHEMA_TYPES.join(
          ", "
        )}.`
      );
    }
  }

  return { isEnum, finalType, enumValues, unionSubTypes };
}

/**
 * buildParamSchemas => final array of { name, description, schema, enum? }
 * merges sub-fields if type=object, or union => oneOf
 */
function buildParamSchemas(rawParams: RawParam[]): ParsedParamSchema[] {
  // separate top-level vs property lines
  const topLevel: Record<string, RawParam> = {};
  const propertyMap: RawParam[] = [];

  for (const rp of rawParams) {
    if (!rp.isProperty) {
      topLevel[rp.name] = rp;
    } else {
      propertyMap.push(rp);
    }
  }

  const result: ParsedParamSchema[] = [];

  for (const rp of Object.values(topLevel)) {
    // create a base schema
    let base: any = createBaseSchema(rp);

    // if object => attach sub properties
    if (base.type === "object") {
      const subProps = propertyMap.filter((p) =>
        p.name.startsWith(rp.name + ".")
      );
      if (subProps.length > 0) {
        const { properties, required } = buildSubProperties(rp.name, subProps);
        base.properties = properties;
        if (required.length > 0) base.required = required;
      }
    }

    result.push({
      name: rp.name,
      description: rp.description,
      schema: base,
      enum: rp.enumValues,
      isOptional: rp.isOptional,
    });
  }

  return result;
}

/**
 * createBaseSchema => handle union => oneOf, enum => { enum: [] }, normal
 */
function createBaseSchema(rp: RawParam): any {
  // if union => string|number => { oneOf: [ {type:"string"}, {type:"number"} ], ... }
  if (rp.unionSubTypes && rp.unionSubTypes.length > 0) {
    const variants = rp.unionSubTypes.map((st) => {
      const lc = st.toLowerCase();
      return JSON_SCHEMA_TYPES.includes(lc) ? { type: lc } : { type: "any" };
    });
    return {
      oneOf: variants,
      description: rp.description,
    };
  }

  // if enum => type= "number" or "string" + enum
  if (rp.isEnum && rp.enumValues) {
    return {
      type: rp.type,
      enum: rp.enumValues,
      description: rp.description,
    };
  }

  // else normal single type
  return {
    type: rp.type,
    description: rp.description,
  };
}

/**
 * For an object param => gather property lines => user.name => field= name
 * skip from required if property is optional
 */
function buildSubProperties(
  parentName: string,
  subProps: RawParam[]
): { properties: Record<string, any>; required: string[] } {
  const props: Record<string, any> = {};
  const required: string[] = [];

  for (const sp of subProps) {
    const field = sp.name.slice(parentName.length + 1); // e.g. user.name => "name"
    let fieldSchema = createBaseSchema(sp);
    props[field] = fieldSchema;

    if (!sp.isOptional) {
      required.push(field);
    }
  }

  return { properties: props, required };
}

/**
 * findNextFunctionName:
 *  - Extracts the function name from the remaining content using regex patterns.
 */
function findNextFunctionName(remaining: string): string {
  const patterns = [
    // Arrow function patterns first
    /\bconst\s+(\w+)\s*=\s*async\s*\(\s*\{[^}]*\}\s*\)\s*=>\s*\{/,
    /\bconst\s+(\w+)\s*=\s*async\s*\([^)]*\)\s*=>\s*\{/,
    /\bconst\s+(\w+)\s*=\s*async\s*=>\s*\{/,
    /\bconst\s+(\w+)\s*=\s*\(\s*[^)]*\)\s*=>\s*\{/,
    /\bexport\s+const\s+(\w+)\s*=\s*async\s*\(\s*\{[^}]*\}\s*\)\s*=>\s*\{/,
    /\bexport\s+const\s+(\w+)\s*=\s*async\s*\([^)]*\)\s*=>\s*\{/,
    /\bexport\s+const\s+(\w+)\s*=\s*async\s*=>\s*\{/,
    /\bexport\s+const\s+(\w+)\s*=\s*\(\s*[^)]*\)\s*=>\s*\{/,
    // Traditional function patterns
    /\bexport\s+async\s+function\s+(\w+)\s*\(/,
    /\bexport\s+function\s+(\w+)\s*\(/,
    /\basync\s+function\s+(\w+)\s*\(/,
    /\bfunction\s+(\w+)\s*\(/,
  ];

  // Split the input into lines and process each line
  const lines = remaining.split(/\r?\n/);

  for (const line of lines) {
    // Skip lines that are comments or empty
    if (/^\s*\/\//.test(line) || line.trim() === "") {
      continue;
    }

    for (const regex of patterns) {
      const match = regex.exec(line);
      if (match) {
        return match[1];
      }
    }
  }

  return "unknown";
}
