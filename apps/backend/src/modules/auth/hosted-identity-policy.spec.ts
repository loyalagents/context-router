import {
  assertLegacyIssuerAdmission,
  canonicalizeIdentityLinkEmail,
  computeIdentityLinkIdentityDigest,
  computeIdentityLinkRowDigest,
  createSyntheticPrincipalEmail,
  isReservedIdentityLinkEmail,
  parseHostedIssuerConfiguration,
  parseIdentityLinkClaimMarker,
  parseIdentityLinkClaims,
  reconcileVerifiedEmailAssertions,
} from "./hosted-identity-policy";

const ROW_DIGEST = "EfixakuicFP1z1imx-WNHGoS9_Z-m80g3-btSygmNBA";
const OTHER_ROW_DIGEST = "hZn7vuS92Yv8gStqKxt2kVwGaU45Jge_zwyKa4XQdKI";
const IDENTITY_DIGEST = "Ya8FFq2SER4yxv1R9T1oOGnXBDutlBChYiTB_9OaHtU";
const OTHER_IDENTITY_DIGEST = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("hosted identity policy", () => {
  describe("issuer configuration", () => {
    it("accepts an explicit canonical HTTPS issuer whose host matches the domain", () => {
      expect(
        parseHostedIssuerConfiguration({
          issuer: "https://tenant.auth0.com/",
          domain: "tenant.auth0.com",
          legacyIssuer: "https://tenant.auth0.com/",
        }),
      ).toEqual({
        issuer: "https://tenant.auth0.com/",
        domain: "tenant.auth0.com",
        legacyIssuer: "https://tenant.auth0.com/",
      });

      expect(
        parseHostedIssuerConfiguration({
          issuer: "https://127.0.0.1:8443/",
          domain: "127.0.0.1:8443",
        }),
      ).toEqual({
        issuer: "https://127.0.0.1:8443/",
        domain: "127.0.0.1:8443",
        legacyIssuer: undefined,
      });
    });

    it.each([
      [undefined, "tenant.auth0.com"],
      ["", "tenant.auth0.com"],
      ["http://tenant.auth0.com/", "tenant.auth0.com"],
      ["https://TENANT.auth0.com/", "tenant.auth0.com"],
      ["https://user@tenant.auth0.com/", "tenant.auth0.com"],
      ["https://tenant.auth0.com/path", "tenant.auth0.com"],
      ["https://tenant.auth0.com/?query=1", "tenant.auth0.com"],
      ["https://tenant.auth0.com/#fragment", "tenant.auth0.com"],
      ["https://tenant.auth0.com:443/", "tenant.auth0.com"],
      ["https://tenant.auth0.com/", "other.auth0.com"],
      ["https://tenant.auth0.com/", "https://tenant.auth0.com"],
    ])("rejects a non-canonical or mismatched issuer %#", (issuer, domain) => {
      expect(() => parseHostedIssuerConfiguration({ issuer, domain })).toThrow(
        "Invalid hosted issuer configuration",
      );
    });

    it.each(["", "https://other.auth0.com/", "HTTP://tenant.auth0.com/"])(
      "rejects invalid legacy issuer value %p",
      (legacyIssuer) => {
        expect(() =>
          parseHostedIssuerConfiguration({
            issuer: "https://tenant.auth0.com/",
            domain: "tenant.auth0.com",
            legacyIssuer,
          }),
        ).toThrow("Invalid hosted legacy issuer configuration");
      },
    );

    it("requires an equal configured legacy issuer only while sentinel rows exist", () => {
      const withoutLegacy = parseHostedIssuerConfiguration({
        issuer: "https://tenant.auth0.com/",
        domain: "tenant.auth0.com",
      });
      expect(() => assertLegacyIssuerAdmission(withoutLegacy, 0)).not.toThrow();
      expect(() => assertLegacyIssuerAdmission(withoutLegacy, 1)).toThrow(
        "Hosted legacy issuer configuration is required",
      );

      const withLegacy = parseHostedIssuerConfiguration({
        issuer: "https://tenant.auth0.com/",
        domain: "tenant.auth0.com",
        legacyIssuer: "https://tenant.auth0.com/",
      });
      expect(() => assertLegacyIssuerAdmission(withLegacy, 0)).not.toThrow();
      expect(() => assertLegacyIssuerAdmission(withLegacy, 3)).not.toThrow();

      for (const legacyIssuer of ["", "https://other.auth0.com/"]) {
        expect(() =>
          assertLegacyIssuerAdmission({ ...withLegacy, legacyIssuer }, 0),
        ).toThrow("Hosted legacy issuer configuration is required");
      }
    });
  });

  describe("frozen link claims", () => {
    it("accepts and preserves the exact canonical empty manifest", () => {
      expect(
        parseIdentityLinkClaims('{"version":1,"dispositions":[]}'),
      ).toEqual({
        version: 1,
        dispositions: [],
        canonical: '{"version":1,"dispositions":[]}',
        digest: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      });
    });

    it("accepts canonical sorted deny and link entries", () => {
      const canonical = JSON.stringify({
        version: 1,
        dispositions: [
          [ROW_DIGEST, "link", IDENTITY_DIGEST],
          [IDENTITY_DIGEST, "deny"],
        ],
      });

      expect(parseIdentityLinkClaims(canonical)).toEqual({
        version: 1,
        dispositions: [
          {
            rowDigest: ROW_DIGEST,
            decision: "link",
            identityDigest: IDENTITY_DIGEST,
          },
          { rowDigest: IDENTITY_DIGEST, decision: "deny" },
        ],
        canonical,
        digest: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      });
    });

    it.each([
      undefined,
      "",
      '{ "version":1,"dispositions":[]}',
      '{"dispositions":[],"version":1}',
      '{"version":1,"version":1,"dispositions":[]}',
      '{"version":2,"dispositions":[]}',
      '{"version":1,"dispositions":[],"extra":true}',
      `{"version":1,"dispositions":[["short","deny"]]}`,
      `{"version":1,"dispositions":[["${ROW_DIGEST}=","deny"]]}`,
      `{"version":1,"dispositions":[["${ROW_DIGEST}","allow"]]}`,
      `{"version":1,"dispositions":[["${ROW_DIGEST}","deny","${IDENTITY_DIGEST}"]]}`,
      `{"version":1,"dispositions":[["${ROW_DIGEST}","link"]]}`,
      `{"version":1,"dispositions":[["${ROW_DIGEST}","link","${IDENTITY_DIGEST}","extra"]]}`,
      `{"version":1,"dispositions":[["${ROW_DIGEST}","deny"],["${ROW_DIGEST}","deny"]]}`,
      `{"version":1,"dispositions":[["${IDENTITY_DIGEST}","deny"],["${ROW_DIGEST}","deny"]]}`,
      `{"version":1,"dispositions":[["${ROW_DIGEST}","link","${OTHER_IDENTITY_DIGEST}"],["${IDENTITY_DIGEST}","link","${OTHER_IDENTITY_DIGEST}"]]}`,
      '{"version":1,"dispositions":[["é","deny"]]}',
    ])("rejects malformed or non-canonical claim input %#", (value) => {
      expect(() => parseIdentityLinkClaims(value)).toThrow(
        "Invalid identity link claims",
      );
    });

    it("enforces entry and byte limits", () => {
      const entries = Array.from({ length: 257 }, (_, index) =>
        computeIdentityLinkRowDigest(
          `limit-user-${index.toString().padStart(3, "0")}`,
          `limit-${index}@example.test`,
        ),
      )
        .sort()
        .map((digest) => [digest, "deny"]);
      expect(() =>
        parseIdentityLinkClaims(
          JSON.stringify({ version: 1, dispositions: entries }),
        ),
      ).toThrow("Invalid identity link claims");

      const parse = jest.spyOn(JSON, "parse");
      try {
        expect(() =>
          parseIdentityLinkClaims("x".repeat(30 * 1024 + 1)),
        ).toThrow("Invalid identity link claims");
        expect(parse).not.toHaveBeenCalled();
      } finally {
        parse.mockRestore();
      }
    });

    it("accepts only the exact semantic JSON marker shape", () => {
      expect(
        parseIdentityLinkClaimMarker({
          contextRouterIdentityLinkClaim: {
            version: 1,
            rowDigest: ROW_DIGEST,
            identityDigest: IDENTITY_DIGEST,
          },
        }),
      ).toEqual({
        version: 1,
        rowDigest: ROW_DIGEST,
        identityDigest: IDENTITY_DIGEST,
      });

      for (const metadata of [
        null,
        {},
        { contextRouterIdentityLinkClaim: { version: 1 } },
        {
          contextRouterIdentityLinkClaim: {
            version: 1,
            rowDigest: ROW_DIGEST,
            identityDigest: IDENTITY_DIGEST,
            extra: true,
          },
        },
        {
          contextRouterIdentityLinkClaim: {
            version: 1,
            rowDigest: ROW_DIGEST,
            identityDigest: IDENTITY_DIGEST,
          },
          extra: true,
        },
      ]) {
        expect(() => parseIdentityLinkClaimMarker(metadata)).toThrow(
          "Invalid identity link claim marker",
        );
      }
    });
  });

  describe("length-framed digests", () => {
    it("matches independent row and identity digest vectors", () => {
      expect(
        computeIdentityLinkRowDigest(
          "00000000-0000-4000-8000-000000000001",
          "Alice@example.com",
        ),
      ).toBe(ROW_DIGEST);
      expect(
        computeIdentityLinkIdentityDigest(
          "https://tenant.auth0.com/",
          "auth0|abc123",
        ),
      ).toBe(IDENTITY_DIGEST);
      expect(computeIdentityLinkRowDigest("user-ü", "local@example.com")).toBe(
        OTHER_ROW_DIGEST,
      );
    });
  });

  describe("verified email evidence", () => {
    it("trims only ASCII boundary whitespace, preserves local bytes, and lowercases the domain", () => {
      expect(canonicalizeIdentityLinkEmail("\tAlice@EXAMPLE.COM\r")).toBe(
        "Alice@example.com",
      );
      expect(canonicalizeIdentityLinkEmail("o'hara+tag@EXAMPLE.COM")).toBe(
        "o'hara+tag@example.com",
      );
    });

    it.each([
      "",
      " alice@example.com\u00a0",
      '"alice"@example.com',
      "alice(comment)@example.com",
      "alice@[127.0.0.1]",
      "álîçé@example.com",
      "alice\u0000@example.com",
      "alice@@example.com",
      ".alice@example.com",
      "alice.@example.com",
      "alice..admin@example.com",
      "alice@example..com",
      "alice@-example.com",
      "alice@example-.com",
      "alice@example_com",
    ])("rejects invalid identity-link email %p", (email) => {
      expect(() => canonicalizeIdentityLinkEmail(email)).toThrow(
        "Invalid identity email assertion",
      );
    });

    it.each([
      [{ emailVerified: true }, undefined],
      [{ email: "alice@example.com", emailVerified: "true" }, undefined],
      [{ email: 42, emailVerified: true }, undefined],
    ])("rejects malformed email source pairs %#", (jwt, management) => {
      expect(() => reconcileVerifiedEmailAssertions(jwt, management)).toThrow(
        "Invalid identity email assertion",
      );
    });

    it.each([
      "unknown@example.com",
      "john.doe@example.com",
      "jane.smith@example.com",
      "client@m2m.local",
      "principal@principal.invalid",
      "missing-00000000-0000-4000-8000-000000000001@unknown.local",
    ])("marks reserved or synthetic address %p as ineligible", (email) => {
      expect(isReservedIdentityLinkEmail(email)).toBe(true);
    });

    it("accepts a verified assertion from either source and matching verified assertions", () => {
      expect(
        reconcileVerifiedEmailAssertions(
          { email: "Alice@EXAMPLE.COM", emailVerified: true },
          undefined,
        ),
      ).toBe("Alice@example.com");
      expect(
        reconcileVerifiedEmailAssertions(undefined, {
          email: "Alice@EXAMPLE.COM",
          emailVerified: true,
        }),
      ).toBe("Alice@example.com");
      expect(
        reconcileVerifiedEmailAssertions(
          { email: "Alice@EXAMPLE.COM", emailVerified: true },
          { email: "Alice@example.com", emailVerified: true },
        ),
      ).toBe("Alice@example.com");
    });

    it("treats one or two matching unverified assertions as ineligible", () => {
      expect(
        reconcileVerifiedEmailAssertions(
          { email: "alice@example.com", emailVerified: false },
          undefined,
        ),
      ).toBeNull();
      expect(
        reconcileVerifiedEmailAssertions(
          { email: "alice@example.com" },
          { email: "alice@example.com" },
        ),
      ).toBeNull();
    });

    it.each([
      [
        { email: "Alice@example.com", emailVerified: true },
        { email: "alice@example.com", emailVerified: true },
      ],
      [
        { email: "alice@example.com", emailVerified: true },
        { email: "other@example.com", emailVerified: true },
      ],
      [
        { email: "alice@example.com", emailVerified: true },
        { email: "alice@example.com", emailVerified: false },
      ],
    ])("rejects conflicting source assertions %#", (jwt, management) => {
      expect(() => reconcileVerifiedEmailAssertions(jwt, management)).toThrow(
        "Conflicting identity email assertions",
      );
    });

    it("creates the deterministic non-routable compatibility email", () => {
      expect(createSyntheticPrincipalEmail("principal-1")).toBe(
        "88038462db8b272bf1af383d1a7b3c68b693d7ea455940d7d98c84c9c1f9eb94@principal.invalid",
      );
    });
  });
});
