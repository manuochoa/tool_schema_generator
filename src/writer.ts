import { promises as fs } from "fs";

export async function writeSchemas(
  outputPath: string,
  schemas: object[]
): Promise<void> {
  await fs.writeFile(outputPath, JSON.stringify(schemas, null, 2));
}
