import { ParsedAnnotation, Schema } from "./types";

/**
 * Generate an OpenAI "function calling" style schema
 * from our parsed annotation data.
 */
export function generateSchema({
  notice,
  params,
  functionName,
}: ParsedAnnotation): Schema {
  // We'll allow any shape under "properties" because
  // a param might be an object, array, union, etc.
  const properties: Record<string, any> = {};
  const required: string[] = [];

  params.forEach(
    ({ name, description, schema, enum: enumValues, isOptional }) => {
      // 1) Start with the entire schema from the parser
      //    (e.g. { type: "object", properties: {...}, required: [...] }).
      // 2) Add/override the "description" from JSDoc.
      const finalSchema = {
        ...schema, // Keep everything (type, properties, etc.)
        description, // Overwrite/merge with JSDoc description
      };

      // If we also have an `enum`, attach it
      if (enumValues && enumValues.length > 0) {
        finalSchema.enum = enumValues;
      }

      properties[name] = finalSchema;
      if (!isOptional) {
        required.push(name);
      }
    }
  );

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
