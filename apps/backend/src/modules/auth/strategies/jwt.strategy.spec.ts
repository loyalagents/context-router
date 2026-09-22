import { Logger, UnauthorizedException } from "@nestjs/common";
import passport from "passport";
import { HUMAN_AUTH_STRATEGY } from "../../../domains/shared/ports/human-auth.constants";
import { JwtStrategy } from "./jwt.strategy";

describe("JwtStrategy diagnostics", () => {
  function createStrategy() {
    const values: Record<string, string> = {
      "auth.auth0.domain": "tenant.auth0.test",
      "auth.auth0.audience": "https://context-router.test",
      "auth.auth0.issuer": "https://tenant.auth0.test/",
    };
    const authService = {
      validateAndSyncUser: jest.fn(),
      findOrCreateM2MUser: jest.fn(),
    };
    const strategy = new JwtStrategy(
      { get: jest.fn((key: string) => values[key]) } as never,
      authService as never,
    );
    return { strategy, authService };
  }

  afterEach(() => {
    passport.unuse(HUMAN_AUTH_STRATEGY);
    jest.restoreAllMocks();
  });

  it("does not log raw audience claims", async () => {
    const error = jest.spyOn(Logger.prototype, "error");
    const { strategy } = createStrategy();

    await expect(
      strategy.validate({ sub: "auth0|subject-canary", aud: "audience-canary" }),
    ).rejects.toEqual(new UnauthorizedException("Invalid audience"));

    expect(error).toHaveBeenCalledWith("JWT audience validation failed");
    expect(JSON.stringify(error.mock.calls)).not.toContain("audience-canary");
    expect(JSON.stringify(error.mock.calls)).not.toContain("subject-canary");
  });

  it("does not log the service error cause or token subject", async () => {
    const error = jest.spyOn(Logger.prototype, "error");
    const { strategy, authService } = createStrategy();
    authService.validateAndSyncUser.mockRejectedValue(
      new Error("service-cause-canary"),
    );

    await expect(
      strategy.validate({
        sub: "auth0|subject-canary",
        aud: "https://context-router.test",
      }),
    ).rejects.toEqual(new UnauthorizedException("Invalid token"));

    expect(error).toHaveBeenCalledWith("JWT human validation failed");
    expect(JSON.stringify(error.mock.calls)).not.toContain(
      "service-cause-canary",
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain("subject-canary");
  });
});
