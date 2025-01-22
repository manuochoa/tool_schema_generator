import { ParsedAnnotation } from "./parser";

export interface Schema {
  type: string;
  function: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: Record<
        string,
        {
          type: string;
          description: string;
          enum?: string[];
        }
      >;
      required: string[];
    };
  };
}

/**
 * Generate an OpenAI "function calling" style schema
 * from our parsed annotation data.
 */
export function generateSchema({
  notice,
  params,
  functionName,
}: ParsedAnnotation): Schema {
  const properties: Record<
    string,
    {
      type: string;
      description: string;
      enum?: string[];
    }
  > = {};

  const required: string[] = [];

  params.forEach(({ name, description, type, enum: enumValues }) => {
    // If `enum` is present, add it to the schema property
    if (enumValues && enumValues.length > 0) {
      properties[name] = {
        type,
        description,
        enum: enumValues,
      };
    } else {
      // Normal (non-enum) property
      properties[name] = {
        type,
        description,
      };
    }
    required.push(name);
  });

  return {
    type: "function",
    function: {
      name: functionName,
      description: notice,
      parameters: {
        type: "object",
        properties,
        required,
      },
    },
  };
}
