import {
  AiError,
  createAiWorkflow,
  HOSTED_AI_CAPABILITIES,
  LOCAL_AI_CAPABILITIES,
} from "./ai-execution";
import { LocalUnavailableModelService } from "../../../composition/local-model-adapter.module";

describe("AI execution contract", () => {
  it("creates one immutable local workflow deadline and preserves a shorter caller deadline", () => {
    const before = performance.now();
    const local = createAiWorkflow(LOCAL_AI_CAPABILITIES);
    expect(local.options.deadline).toBeGreaterThanOrEqual(before + 180000);
    expect(local.options.deadline).toBeLessThanOrEqual(
      performance.now() + 180000,
    );
    expect(Object.isFrozen(local.options)).toBe(true);
    const controller = new AbortController();
    const exact = performance.now() + 1000;
    const request = createAiWorkflow(LOCAL_AI_CAPABILITIES, {
      deadline: exact,
      signal: controller.signal,
    });
    expect(request.options.deadline).toBe(exact);
    controller.abort(new Error("private reason"));
    expect(() => request.check()).toThrow("Local model cancelled");
    try {
      request.check();
    } catch (error) {
      expect(error).toBeInstanceOf(AiError);
      expect(JSON.stringify(error)).not.toContain("private");
    }
  });

  it("checks expired and invalid budgets synchronously and keeps uncontrolled hosted calls compatible", () => {
    expect(createAiWorkflow(HOSTED_AI_CAPABILITIES).options).toEqual({});
    for (const deadline of [0, -1, NaN, Infinity]) {
      expect(() =>
        createAiWorkflow(LOCAL_AI_CAPABILITIES, { deadline }),
      ).toThrow("Local model deadline");
    }
    expect(() =>
      createAiWorkflow(HOSTED_AI_CAPABILITIES, {
        deadline: performance.now() + 1000,
      }),
    ).toThrow("AI capability unsupported");
  });

  it("freezes capabilities including MIME lists and preserves truthful no-model status", async () => {
    expect(Object.isFrozen(LOCAL_AI_CAPABILITIES)).toBe(true);
    expect(Object.isFrozen(LOCAL_AI_CAPABILITIES.fileMimeTypes)).toBe(true);
    expect(LOCAL_AI_CAPABILITIES.fileMimeTypes).toContain("application/pdf");
    expect(LOCAL_AI_CAPABILITIES.fileMimeTypes).not.toContain("image/png");
    const unavailable = new LocalUnavailableModelService();
    expect(unavailable.capabilities.text).toBe(false);
    expect(await unavailable.getStatus()).toEqual({
      state: "unavailable",
      configured: false,
    });
  });


});
