import { createAuthConfiguration } from "./auth.config";

describe("hosted auth configuration", () => {
  const environment = {
    AUTH0_DOMAIN: "tenant.auth0.com",
    AUTH0_ISSUER: "https://tenant.auth0.com/",
    AUTH0_LEGACY_ISSUER: "https://tenant.auth0.com/",
    AUTH0_IDENTITY_LINK_CLAIMS: '{"version":1,"dispositions":[]}',
    AUTH0_AUDIENCE: "https://context-router.test",
    AUTH0_CLIENT_ID: "client-id",
    AUTH0_CLIENT_SECRET: "client-secret",
    AUTH0_SYNC_STRATEGY: "ON_LOGIN",
    JWT_SECRET: "jwt-secret",
  } satisfies NodeJS.ProcessEnv;

  it("builds a strict snapshot from the explicitly supplied environment", () => {
    expect(createAuthConfiguration(environment)).toEqual({
      auth0: {
        domain: "tenant.auth0.com",
        audience: "https://context-router.test",
        issuer: "https://tenant.auth0.com/",
        legacyIssuer: "https://tenant.auth0.com/",
        clientId: "client-id",
        clientSecret: "client-secret",
        managementApiAudience: "https://tenant.auth0.com/api/v2/",
        identityLinkClaims: {
          version: 1,
          dispositions: [],
          canonical: '{"version":1,"dispositions":[]}',
          digest: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        },
      },
      jwt: {
        secret: "jwt-secret",
        expiresIn: "1h",
      },
      syncStrategy: "ON_LOGIN",
    });
  });

  it("does not derive an issuer or claims manifest from other values", () => {
    expect(() =>
      createAuthConfiguration({
        ...environment,
        AUTH0_ISSUER: undefined,
      }),
    ).toThrow("Invalid hosted issuer configuration");
    expect(() =>
      createAuthConfiguration({
        ...environment,
        AUTH0_IDENTITY_LINK_CLAIMS: undefined,
      }),
    ).toThrow("Invalid identity link claims");
    for (const audience of [undefined, ""]) {
      expect(() =>
        createAuthConfiguration({
          ...environment,
          AUTH0_AUDIENCE: audience,
        }),
      ).toThrow("Invalid hosted audience configuration");
    }
  });

  it("accepts an omitted legacy issuer for a later zero-sentinel admission check", () => {
    expect(
      createAuthConfiguration({
        ...environment,
        AUTH0_LEGACY_ISSUER: undefined,
      }).auth0.legacyIssuer,
    ).toBeUndefined();
  });

  it("uses the provided snapshot instead of ambient process values", () => {
    const originalIssuer = process.env.AUTH0_ISSUER;
    const originalClaims = process.env.AUTH0_IDENTITY_LINK_CLAIMS;
    process.env.AUTH0_ISSUER = "https://ambient.invalid/";
    process.env.AUTH0_IDENTITY_LINK_CLAIMS = "invalid";
    try {
      expect(createAuthConfiguration(environment).auth0.issuer).toBe(
        "https://tenant.auth0.com/",
      );
    } finally {
      if (originalIssuer === undefined) delete process.env.AUTH0_ISSUER;
      else process.env.AUTH0_ISSUER = originalIssuer;
      if (originalClaims === undefined)
        delete process.env.AUTH0_IDENTITY_LINK_CLAIMS;
      else process.env.AUTH0_IDENTITY_LINK_CLAIMS = originalClaims;
    }
  });
});
