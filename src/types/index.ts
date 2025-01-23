/**
 * Whitelist of valid JS/JSON Schema base types you'd like to allow
 * in your @param lines for plain JS. (Not used for TS interfaces.)
 */
export const JSON_SCHEMA_TYPES = [
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "null",
];

export interface ParsedAnnotation {
  notice: string;
  functionName: string;
  params: Array<{
    name: string;
    description: string;
    schema: any; // JSON schema
    enum?: string[];
    isOptional?: boolean;
  }>;
}

export interface ParsedParam {
  name: string;
  description: string;
  type: string;
  enum?: string[];
}

export interface RawParam {
  isProperty: boolean;
  type: string;
  isEnum?: boolean;
  enumValues?: string[];
  unionSubTypes?: string[];
  name: string;
  description: string;
  isOptional?: boolean;
}

export interface ParsedParamSchema {
  name: string;
  description: string;
  schema: any; // nested JSON schema snippet
  enum?: string[]; // <-- add this so final object can have "enum"
  isOptional?: boolean;
}

// For top-level param objects
export interface ParamObject {
  type: string; // "object", "number", "string", etc.
  description: string;
  properties: Record<string, any>; // subfields if object
}

export interface Schema {
  type: string;
  function: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: Record<string, any>;
      required: string[];
    };
  };
}
