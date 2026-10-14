import DxfParser from "dxf-parser";

export interface DxfValidationResult {
  valid: boolean;
  entityCount: number;
  error?: string;
}

/** Parses a generated DXF string with dxf-parser to confirm it is structurally valid. */
export function validateDxfString(dxf: string): DxfValidationResult {
  try {
    const parser = new DxfParser();
    const parsed = parser.parseSync(dxf);
    const entityCount = parsed?.entities?.length ?? 0;
    if (entityCount === 0) {
      return { valid: false, entityCount: 0, error: "No entities were found in the generated DXF." };
    }
    return { valid: true, entityCount };
  } catch (err) {
    return { valid: false, entityCount: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
