import {
  LOCAL_MODEL_UNAVAILABLE_MESSAGE,
  LocalUnavailableModelService,
} from "./local-model-adapter.module";

describe("LocalUnavailableModelService", () => {
  it.each([
    ["generateText", ["prompt-canary"]],
    [
      "generateTextWithFile",
      [
        "prompt-canary",
        { buffer: Buffer.from("file-canary"), mimeType: "text/plain" },
      ],
    ],
    ["generateStructured", ["prompt-canary", {}]],
    [
      "generateStructuredWithFile",
      [
        "prompt-canary",
        { buffer: Buffer.from("file-canary"), mimeType: "text/plain" },
        {},
      ],
    ],
  ] as const)(
    "fails %s with one fixed non-secret result",
    async (method, args) => {
      const service = new LocalUnavailableModelService();
      const operation = (
        service[method] as (...values: unknown[]) => Promise<never>
      )(...args);

      await expect(operation).rejects.toThrow(LOCAL_MODEL_UNAVAILABLE_MESSAGE);
      const error = await operation.catch((failure: Error) => failure);
      expect(error.message).toBe(LOCAL_MODEL_UNAVAILABLE_MESSAGE);
      expect(JSON.stringify(error)).not.toContain("prompt-canary");
      expect(JSON.stringify(error)).not.toContain("file-canary");
    },
  );
});
