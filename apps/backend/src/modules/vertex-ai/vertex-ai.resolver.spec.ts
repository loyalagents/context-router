import { HOSTED_AI_CAPABILITIES } from "../../domains/shared/ports/ai-execution";
import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { readFileSync } from "fs";
import { join } from "path";
import { AiTextGeneratorPort } from "../../domains/shared/ports/ai-text-generator.port";
import { AI_TEXT_GENERATOR_PORT } from "../../domains/shared/ports/ai.tokens";
import { VertexAiResolver } from "./vertex-ai.resolver";

describe("VertexAiResolver", () => {
  let port: jest.Mocked<AiTextGeneratorPort>;

  beforeEach(() => {
    port = {
      capabilities: HOSTED_AI_CAPABILITIES,
      getStatus: jest
        .fn()
        .mockResolvedValue({ state: "unsupported", configured: true }),
      generateText: jest.fn(),
      generateTextWithFile: jest.fn(),
    };
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function compileResolver(): Promise<VertexAiResolver> {
    const module = await Test.createTestingModule({
      providers: [
        VertexAiResolver,
        { provide: AI_TEXT_GENERATOR_PORT, useValue: port },
      ],
    }).compile();

    return module.get(VertexAiResolver);
  }

  it("injects the text-generator port rather than a concrete adapter", async () => {
    await expect(compileResolver()).resolves.toBeInstanceOf(VertexAiResolver);
    const source = readFileSync(
      join(__dirname, "vertex-ai.resolver.ts"),
      "utf8",
    );
    const tokenName = ["AI", "TEXT", "GENERATOR", "PORT"].join("_");

    expect(source).toContain(`@Inject(${tokenName})`);
    expect(source).not.toContain("VertexAiService");
  });

  it("delegates the legacy askVertexAI query to the text-generator port", async () => {
    const resolver = await compileResolver();
    port.generateText.mockResolvedValue("generated response");

    await expect(resolver.askVertexAI("prompt-secret-canary")).resolves.toBe(
      "generated response",
    );
    expect(port.generateText).toHaveBeenCalledTimes(1);
    expect(port.generateText).toHaveBeenCalledWith("prompt-secret-canary");
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      "Processing authenticated text-generation request",
    );
    expect(
      JSON.stringify((Logger.prototype.log as jest.Mock).mock.calls),
    ).not.toContain("prompt-secret-canary");
  });

  it("preserves the sanitized public error when the port fails", async () => {
    const resolver = await compileResolver();
    port.generateText.mockRejectedValue(new Error("provider-secret-canary"));

    await expect(resolver.askVertexAI("hello")).rejects.toThrow(
      "Failed to generate response from Vertex AI. Please try again later.",
    );
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      "Text generation request failed",
    );
    expect(
      JSON.stringify((Logger.prototype.error as jest.Mock).mock.calls),
    ).not.toContain("provider-secret-canary");
  });
});
