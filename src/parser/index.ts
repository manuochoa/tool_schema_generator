import fs from "fs";
import { parseTsAnnotations } from "./parseTs";
import { parseJsAnnotations } from "./parseJs";
import { ParsedAnnotation } from "../types";

export function parseAnnotations(filePath: string): ParsedAnnotation[] {
  return filePath.endsWith(".ts")
    ? parseTsAnnotations(filePath)
    : parseJsAnnotations(fs.readFileSync(filePath, "utf-8"));
}
