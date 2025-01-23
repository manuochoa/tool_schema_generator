import { parseAnnotations } from "./parser";
import { generateSchema } from "./generator";
import { writeSchemas } from "./writer";
import { sync as globSync } from "glob";
import path from "path";

const SERVICES_DIR = path.join(__dirname, "../services");
const OUTPUT_FILE = path.join(__dirname, "../schemas.json");

(async () => {
  try {
    const files = globSync(`${SERVICES_DIR}/**/*.{ts,js}`);

    let schemas: object[] = [];

    for (const file of files) {
      const annotations = parseAnnotations(file);
      schemas = schemas.concat(annotations.map(generateSchema));
    }

    await writeSchemas(OUTPUT_FILE, schemas);
    console.log(
      `Schema generation completed! ${schemas.length} schemas written to ${OUTPUT_FILE}`
    );
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error during schema generation:", error.message);
    } else {
      console.error("Error during schema generation:", error);
    }
  }
})();
