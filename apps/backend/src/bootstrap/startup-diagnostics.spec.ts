import {
  PREFERENCE_CATALOG_INTEGRITY_MESSAGE,
  PREFERENCE_CATALOG_MISSING_MESSAGE,
  formatHostedStartupFailure,
} from "./startup-diagnostics";

describe("hosted startup diagnostics", () => {
  it.each([
    [
      new Error("Invalid PORT: expected an integer between 0 and 65535"),
      "Application failed to start: Invalid PORT: expected an integer between 0 and 65535",
    ],
    [
      new Error("CORS_ORIGIN must contain at least one origin"),
      "Application failed to start: CORS_ORIGIN must contain at least one origin",
    ],
    [
      new Error("MCP_HTTP_ALLOWED_ORIGINS must contain at least one origin"),
      "Application failed to start: MCP_HTTP_ALLOWED_ORIGINS must contain at least one origin",
    ],
    [
      Object.assign(new Error("listen failed with secret-canary"), {
        code: "EADDRINUSE",
        syscall: "listen",
      }),
      "Application failed to start: Backend listener failed (EADDRINUSE)",
    ],
    [
      Object.assign(new Error("listen failed with secret-canary"), {
        code: "EACCES",
        syscall: "listen",
      }),
      "Application failed to start: Backend listener failed (EACCES)",
    ],
    [
      new Error(PREFERENCE_CATALOG_MISSING_MESSAGE),
      `Application failed to start: ${PREFERENCE_CATALOG_MISSING_MESSAGE}`,
    ],
    [
      new Error(PREFERENCE_CATALOG_INTEGRITY_MESSAGE),
      `Application failed to start: ${PREFERENCE_CATALOG_INTEGRITY_MESSAGE}`,
    ],
  ])("reports an allowlisted operator-safe cause", (error, expected) => {
    expect(formatHostedStartupFailure(error)).toBe(expected);
    expect(formatHostedStartupFailure(error)).not.toContain("secret-canary");
  });

  it.each([
    PREFERENCE_CATALOG_MISSING_MESSAGE,
    PREFERENCE_CATALOG_INTEGRITY_MESSAGE,
  ])(
    "reports %s without inspecting or exposing its hostile cause",
    (message) => {
      const error = Object.assign(new Error(message), {
        cause: Object.assign(
          new Error(
            "/private/repository/catalog-secret-canary.json: Unexpected token catalog-content-canary",
          ),
          {
            expectedHash: "expected-hash-canary",
            actualHash: "actual-hash-canary",
          },
        ),
      });
      error.stack = `${message}\n/private/cwd/stack-secret-canary`;

      const formatted = formatHostedStartupFailure(error);

      expect(formatted).toBe(`Application failed to start: ${message}`);
      for (const canary of [
        "/private/repository",
        "catalog-secret-canary",
        "catalog-content-canary",
        "expected-hash-canary",
        "actual-hash-canary",
        "stack-secret-canary",
        "Unexpected token",
      ]) {
        expect(formatted).not.toContain(canary);
      }
    },
  );

  it("finds an allowlisted cause inside a cleanup aggregate", () => {
    const error = new AggregateError(
      [
        new Error("Invalid PORT: expected an integer between 0 and 65535"),
        new Error("cleanup secret-canary"),
      ],
      "Backend startup failed during cleanup",
    );

    expect(formatHostedStartupFailure(error)).toBe(
      "Application failed to start: Invalid PORT: expected an integer between 0 and 65535",
    );
  });

  it("redacts arbitrary messages and error codes", () => {
    const error = Object.assign(new Error("secret-canary"), {
      code: "SECRET_CANARY_CODE",
    });

    expect(formatHostedStartupFailure(error)).toBe(
      "Application failed to start",
    );
    expect(formatHostedStartupFailure(error)).not.toContain("secret-canary");
    expect(formatHostedStartupFailure(error)).not.toContain(
      "SECRET_CANARY_CODE",
    );

    expect(
      formatHostedStartupFailure(
        Object.assign(new Error("secret-canary"), {
          code: "EADDRINUSE",
          syscall: "read",
        }),
      ),
    ).toBe("Application failed to start");
  });

  it("fails closed when inspecting a hostile error object", () => {
    const error = Object.defineProperty({}, "message", {
      get: () => {
        throw new Error("secret-canary");
      },
    });

    expect(formatHostedStartupFailure(error)).toBe(
      "Application failed to start",
    );
  });

  it("snapshots inspected fields before validating or reporting them", () => {
    const safeMessage = "Invalid PORT: expected an integer between 0 and 65535";
    let messageReads = 0;
    const error = Object.defineProperty({}, "message", {
      get: () => {
        messageReads += 1;
        return messageReads < 3 ? safeMessage : "getter-secret-canary";
      },
    });

    const formatted = formatHostedStartupFailure(error);

    expect(formatted).toBe(`Application failed to start: ${safeMessage}`);
    expect(formatted).not.toContain("getter-secret-canary");
    expect(messageReads).toBe(1);

    let codeReads = 0;
    const codeError = Object.defineProperties(
      new Error("message-secret-canary"),
      {
        code: {
          get: () => {
            codeReads += 1;
            return codeReads < 3 ? "EADDRINUSE" : "code-secret-canary";
          },
        },
        syscall: { value: "listen" },
      },
    );

    const codeFormatted = formatHostedStartupFailure(codeError);

    expect(codeFormatted).toBe(
      "Application failed to start: Backend listener failed (EADDRINUSE)",
    );
    expect(codeFormatted).not.toContain("message-secret-canary");
    expect(codeFormatted).not.toContain("code-secret-canary");
    expect(codeReads).toBe(1);
  });
});
