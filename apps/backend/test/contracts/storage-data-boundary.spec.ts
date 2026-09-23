import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as data from "../../src/domains/shared/storage/storage-types";

describe("application-owned storage data", () => {
  it("owns plain runtime enums without generated/client/driver imports", () => {
    const text = readFileSync(
      resolve(__dirname, "../../src/domains/shared/storage/storage-types.ts"),
      "utf8",
    );
    expect(text).not.toMatch(
      /(?:from|import\s*\()[\s\S]{0,8}["'][^"']*(?:prisma|generated|\bpg\b)/i,
    );
    expect(data.PreferenceStatus).toEqual({
      ACTIVE: "ACTIVE",
      SUGGESTED: "SUGGESTED",
      REJECTED: "REJECTED",
    });
    expect(Object.values(data.GrantAction)).toEqual([
      "READ",
      "SUGGEST",
      "WRITE",
      "DEFINE",
    ]);
  });
});
