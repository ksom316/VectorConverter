import { describe, expect, it } from "vitest";
import { loadImageFile, MAX_FILE_SIZE_BYTES } from "../loadImage";

function makeFile(name: string, type: string, sizeBytes: number): File {
  const content = new Uint8Array(Math.max(0, sizeBytes));
  return new File([content], name, { type });
}

describe("loadImageFile validation", () => {
  it("rejects unsupported mime types", async () => {
    const file = makeFile("drawing.gif", "image/gif", 1024);
    await expect(loadImageFile(file)).rejects.toThrow(/Unsupported file type/);
  });

  it("rejects empty files", async () => {
    const file = makeFile("empty.png", "image/png", 0);
    await expect(loadImageFile(file)).rejects.toThrow(/empty/i);
  });

  it("rejects files over the size limit", async () => {
    const file = makeFile("huge.png", "image/png", MAX_FILE_SIZE_BYTES + 1);
    await expect(loadImageFile(file)).rejects.toThrow(/exceeds/i);
  });
});
